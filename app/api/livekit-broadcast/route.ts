import { NextRequest, NextResponse } from "next/server";
import { AccessToken, EgressClient, EncodingOptionsPreset, RoomServiceClient, StreamOutput, StreamProtocol } from "livekit-server-sdk";
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
      { error: "Credenciales Mux no encontradas. Asegúrate de haber activado el live." },
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
    await roomService.createRoom({ name: roomName, emptyTimeout: 300 });
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

// DELETE /api/livekit-broadcast?egressId=xxx — stop broadcast
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

  try {
    const egressClient = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    await egressClient.stopEgress(egressId);
  } catch (err) {
    console.error("[livekit-broadcast] Stop egress error:", err instanceof Error ? err.message : err);
  }

  return new NextResponse(null, { status: 204 });
}
