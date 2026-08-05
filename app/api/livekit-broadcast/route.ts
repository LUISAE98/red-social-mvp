import { NextRequest, NextResponse } from "next/server";
import { AccessToken, EgressClient, EncodingOptionsPreset, RoomServiceClient, StreamOutput, StreamProtocol } from "livekit-server-sdk";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? "";
const MUX_RTMP_BASE = "rtmps://global-live.mux.com:443/app";

function livekitMissing() {
  return !LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET;
}

async function verifyAndGetUid(req: NextRequest): Promise<string | null> {
  try {
    const auth = req.headers.get("Authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return null;
    const decoded = await getAdminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

// POST /api/livekit-broadcast — start broadcast
export async function POST(req: NextRequest) {
  if (livekitMissing()) {
    return NextResponse.json({ error: "LiveKit no configurado" }, { status: 500 });
  }

  const uid = await verifyAndGetUid(req);
  if (!uid) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const postId = body?.postId as string | undefined;
  if (!postId) {
    return NextResponse.json({ error: "postId requerido" }, { status: 400 });
  }

  const db = getAdminFirestore();

  // Verify post ownership
  const postSnap = await db.collection("posts").doc(postId).get();
  if (!postSnap.exists) {
    return NextResponse.json({ error: "Post no encontrado" }, { status: 404 });
  }
  if (postSnap.data()?.authorId !== uid) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // Read Mux stream key
  const credSnap = await db
    .collection("posts")
    .doc(postId)
    .collection("liveStream")
    .doc("credentials")
    .get();

  if (!credSnap.exists) {
    return NextResponse.json(
      { error: "Credenciales Mux no encontradas. Asegúrate de haber activado la transmisión en vivo." },
      { status: 404 },
    );
  }

  const streamKey = credSnap.data()?.streamKey as string | undefined;
  if (!streamKey) {
    return NextResponse.json({ error: "Stream key de Mux no disponible" }, { status: 500 });
  }

  const isPortrait = body?.isPortrait === true;
  const roomName = `live-${postId}`;
  const rtmpUrl = `${MUX_RTMP_BASE}/${streamKey}`;

  // Create the room first — Egress requires the room to exist.
  // Ignore "already exists" so retries work cleanly.
  const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  try {
    // emptyTimeout: 600s gives a 10-minute buffer for the creator to reconnect
    // if they lose connection (e.g., iOS background, network switch)
    await roomService.createRoom({ name: roomName, emptyTimeout: 600 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAlreadyExists = msg.toLowerCase().includes("already exist") || msg.includes("409");
    if (!isAlreadyExists) {
      console.error("[livekit-broadcast] Room create error:", msg);
      return NextResponse.json({ error: `Error creando sala LiveKit: ${msg}` }, { status: 502 });
    }
  }

  // Start LiveKit Egress → Mux RTMP
  const egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  let egressId: string;
  try {
    const egress = await egressClient.startRoomCompositeEgress(
      roomName,
      new StreamOutput({
        protocol: StreamProtocol.RTMP,
        urls: [rtmpUrl],
      }),
      {
        layout: "speaker",
        encodingOptions: isPortrait
          ? EncodingOptionsPreset.PORTRAIT_H264_720P_30
          : EncodingOptionsPreset.H264_720P_30,
      },
    );
    egressId = egress.egressId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[livekit-broadcast] Egress error:", msg);
    return NextResponse.json({ error: `Error iniciando Egress: ${msg}` }, { status: 502 });
  }

  // Set activeLivePostId immediately so the live ring shows without waiting for the Mux webhook
  const postData = postSnap.data();
  const liveGroupId = typeof postData?.groupId === "string" && postData.groupId ? postData.groupId : null;
  const broadcastGroupIds: string[] = Array.isArray(postData?.liveData?.broadcastGroupIds)
    ? (postData.liveData.broadcastGroupIds as string[]).filter((id) => typeof id === "string" && id && id !== liveGroupId)
    : [];
  const setLiveUpdates: Promise<unknown>[] = [
    db.collection("users").doc(uid).update({ activeLivePostId: postId }),
  ];
  if (liveGroupId) {
    setLiveUpdates.push(db.collection("groups").doc(liveGroupId).update({ activeLivePostId: postId }));
  }
  for (const gid of broadcastGroupIds) {
    setLiveUpdates.push(db.collection("groups").doc(gid).update({ activeLivePostId: postId }));
  }
  await Promise.all(setLiveUpdates).catch((err) => {
    console.error("[livekit-broadcast] Failed to set activeLivePostId:", err);
  });

  // Generate publisher token
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: uid,
    name: uid,
    ttl: 4 * 60 * 60, // 4 hours
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    roomCreate: true,
    canPublish: true,
    canSubscribe: false,
    canPublishData: false,
  });
  const jwt = await token.toJwt();

  return NextResponse.json({
    token: jwt,
    roomName,
    egressId,
    livekitUrl: LIVEKIT_URL,
  });
}

// DELETE /api/livekit-broadcast?egressId=xxx&postId=xxx — stop broadcast
export async function DELETE(req: NextRequest) {
  if (livekitMissing()) {
    return NextResponse.json({ error: "LiveKit no configurado" }, { status: 500 });
  }

  const uid = await verifyAndGetUid(req);
  if (!uid) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const egressId = req.nextUrl.searchParams.get("egressId");
  if (!egressId) {
    return new NextResponse(null, { status: 204 });
  }

  // Verify ownership and read groupId + broadcastGroupIds for live ring cleanup
  const postId = req.nextUrl.searchParams.get("postId");
  let stopGroupId: string | null = null;
  let stopBroadcastGroupIds: string[] = [];
  if (postId) {
    const db = getAdminFirestore();
    const postSnap = await db.collection("posts").doc(postId).get();
    if (postSnap.exists && postSnap.data()?.authorId !== uid) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    if (postSnap.exists) {
      const g = postSnap.data()?.groupId;
      if (typeof g === "string" && g) stopGroupId = g;
      stopBroadcastGroupIds = Array.isArray(postSnap.data()?.liveData?.broadcastGroupIds)
        ? (postSnap.data()!.liveData.broadcastGroupIds as string[]).filter(
            (id) => typeof id === "string" && id && id !== stopGroupId
          )
        : [];
    }
  }

  // 1. Stop egress — severs the LiveKit → Mux RTMP feed
  try {
    const egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    await egressClient.stopEgress(egressId);
  } catch (err) {
    console.error("[livekit-broadcast] Stop egress error:", err instanceof Error ? err.message : err);
  }

  // 2. Delete the LiveKit room immediately so it closes now instead of after emptyTimeout (600s).
  // Prevents the egress compositor from billing as a phantom participant while the room drains.
  if (postId) {
    try {
      const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
      await roomService.deleteRoom(`live-${postId}`);
    } catch (err) {
      console.error("[livekit-broadcast] Delete room error:", err instanceof Error ? err.message : err);
    }
  }

  // 3. Update Firestore: mark live as ended and clear live ring badges.
  // Direct write avoids the 120s delay from Mux's reconnect_window before live_stream.idle fires.
  // The muxWebhook handler is a no-op when liveData.status is already "ended".
  if (postId) {
    const db = getAdminFirestore();
    const now = FieldValue.serverTimestamp();
    const clearUpdates: Promise<unknown>[] = [
      db.collection("users").doc(uid).update({ activeLivePostId: FieldValue.delete() }),
      db.collection("posts").doc(postId).update({
        "liveData.status": "ended",
        "liveData.endedAt": now,
        updatedAt: now,
      }),
    ];
    if (stopGroupId) {
      clearUpdates.push(db.collection("groups").doc(stopGroupId).update({ activeLivePostId: FieldValue.delete() }));
    }
    for (const gid of stopBroadcastGroupIds) {
      clearUpdates.push(db.collection("groups").doc(gid).update({ activeLivePostId: FieldValue.delete() }));
    }
    await Promise.all(clearUpdates).catch((err) => {
      console.error("[livekit-broadcast] Failed to clear live state:", err);
    });
  }

  return new NextResponse(null, { status: 204 });
}
