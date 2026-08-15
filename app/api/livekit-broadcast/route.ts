import { NextRequest, NextResponse } from "next/server";
import { AccessToken, EgressClient, EncodingOptionsPreset, RoomServiceClient, StreamOutput, StreamProtocol } from "livekit-server-sdk";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { canBroadcastToGroup, filterOwnedBroadcastGroupIds } from "@/lib/live/broadcastTargets";

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
  // Solo comunidades PROPIAS del creador (ver filterOwnedBroadcastGroupIds).
  const broadcastGroupIds = (
    await filterOwnedBroadcastGroupIds(db, uid, postData?.liveData?.broadcastGroupIds)
  ).filter((id) => id !== liveGroupId);
  const setLiveUpdates: Promise<unknown>[] = [
    db.collection("users").doc(uid).update({ activeLivePostId: postId }),
  ];
  // Reautorizar ANTES de escribir en la comunidad: ser autor del post no basta
  // (ver canBroadcastToGroup). Si ya no puede publicar ahí, el live sigue — solo
  // no se le planta el anillo a esa comunidad.
  if (liveGroupId && (await canBroadcastToGroup(db, uid, liveGroupId))) {
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

// DELETE /api/livekit-broadcast?postId=xxx — stop broadcast
//
// `postId` es OBLIGATORIO y su autoría se verifica: el egress a detener se
// deriva de la sala del post, nunca del `egressId` que mande el cliente. Antes
// bastaba con estar autenticado y conocer un egressId ajeno para cortarle la
// transmisión a cualquiera, y omitir `postId` saltaba la verificación entera.
export async function DELETE(req: NextRequest) {
  if (livekitMissing()) {
    return NextResponse.json({ error: "LiveKit no configurado" }, { status: 500 });
  }

  const uid = await verifyAndGetUid(req);
  if (!uid) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const postId = req.nextUrl.searchParams.get("postId");
  if (!postId) {
    return NextResponse.json({ error: "postId requerido" }, { status: 400 });
  }

  const db = getAdminFirestore();
  const postSnap = await db.collection("posts").doc(postId).get();
  if (!postSnap.exists) {
    return NextResponse.json({ error: "Post no encontrado" }, { status: 404 });
  }
  if (postSnap.data()?.authorId !== uid) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // groupId + broadcastGroupIds para limpiar los aros de "en vivo"
  const g = postSnap.data()?.groupId;
  const stopGroupId: string | null = typeof g === "string" && g ? g : null;
  // Solo comunidades PROPIAS y que sigan apuntando a ESTE live (Admin SDK se
  // salta las reglas y la lista la escribe el cliente).
  const stopBroadcastGroupIds = (
    await filterOwnedBroadcastGroupIds(db, uid, postSnap.data()?.liveData?.broadcastGroupIds, {
      mustPointTo: postId,
    })
  ).filter((id) => id !== stopGroupId);

  const roomName = `live-${postId}`;

  // 1. Detener los egress ACTIVOS de esta sala — corta el feed LiveKit → Mux RTMP.
  // Se consultan por sala en vez de aceptar el id del cliente, así el permiso
  // sobre el post es lo único que decide qué se puede detener.
  try {
    const egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const active = await egressClient.listEgress({ roomName, active: true });
    await Promise.all(
      active.map((info) =>
        egressClient.stopEgress(info.egressId).catch((err) => {
          console.error("[livekit-broadcast] Stop egress error:", err instanceof Error ? err.message : err);
        })
      )
    );
  } catch (err) {
    console.error("[livekit-broadcast] List egress error:", err instanceof Error ? err.message : err);
    // Si el listado falla, borrar la sala (paso 2) también termina el egress.
  }

  // 2. Delete the LiveKit room immediately so it closes now instead of after emptyTimeout (600s).
  // Prevents the egress compositor from billing as a phantom participant while the room drains.
  try {
    const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    await roomService.deleteRoom(roomName);
  } catch (err) {
    console.error("[livekit-broadcast] Delete room error:", err instanceof Error ? err.message : err);
  }

  // 3. Update Firestore: mark live as ended and clear live ring badges.
  // Direct write avoids the 120s delay from Mux's reconnect_window before live_stream.idle fires.
  // The muxWebhook handler is a no-op when liveData.status is already "ended".
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

  return new NextResponse(null, { status: 204 });
}
