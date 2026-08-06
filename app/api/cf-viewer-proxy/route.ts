import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * ¿Puede este espectador ver el stream? Este proxy es la única puerta hacia el
 * WebRTC de Cloudflare, así que las Firestore Rules NO lo cubren: sin esta
 * comprobación bastaba con conocer el postId (que se filtra, p. ej., por
 * `users/{uid}.activeLivePostId`, legible por cualquiera) para ver en directo un
 * live alojado en una comunidad OCULTA.
 *
 * Se exige membresía cuando el live no es para "todos": comunidad oculta, o
 * alcance "solo miembros". El resto (perfil y comunidades públicas/privadas con
 * alcance abierto) sigue siendo accesible sin sesión, como hasta ahora.
 */
async function viewerMayWatch(
  db: FirebaseFirestore.Firestore,
  post: FirebaseFirestore.DocumentData,
  req: NextRequest
): Promise<boolean> {
  const groupId = typeof post.groupId === "string" && post.groupId ? post.groupId : null;
  const liveData = post.liveData as Record<string, unknown> | undefined;

  const groupSnap = groupId ? await db.collection("groups").doc(groupId).get() : null;
  const groupVisibility = groupSnap?.data()?.visibility;

  const membersOnly =
    groupVisibility === "hidden" || liveData?.visibilityMode === "members_only";

  if (!groupId || !membersOnly) return true;

  const uid = await verifyAndGetUid(req);
  if (!uid) return false;

  if (post.authorId === uid) return true;
  if (groupSnap?.data()?.ownerId === uid) return true;

  const memberSnap = await db
    .collection("groups")
    .doc(groupId)
    .collection("members")
    .doc(uid)
    .get();

  if (!memberSnap.exists) return false;

  // Mismo criterio que `isReadableMemberStatus` en firestore.rules: los
  // sancionados (banned/removed/kicked/expelled) pierden el acceso al contenido.
  const status = memberSnap.data()?.status;
  return status === undefined || ["active", "subscribed", "muted"].includes(String(status));
}

// Proxies the viewer SDP offer to Cloudflare Stream /webRTC/play.
// The browser cannot POST directly to cloudflarestream.com because the endpoint
// does not include CORS headers for cross-origin requests.
// This proxy forwards the SDP offer server-side (no CORS restriction) and returns
// the SDP answer. All WebRTC media (ICE/DTLS/SRTP) flows directly between the
// viewer browser and Cloudflare — this proxy only handles the signaling exchange.
export async function POST(req: NextRequest) {
  const postId = req.nextUrl.searchParams.get("postId");
  if (!postId) {
    return NextResponse.json({ error: "postId requerido" }, { status: 400 });
  }

  const db = getAdminFirestore();
  const postSnap = await db.collection("posts").doc(postId).get();
  if (!postSnap.exists) {
    console.warn("[cf-viewer-proxy] Post not found:", postId);
    return NextResponse.json({ error: "Post no encontrado" }, { status: 404 });
  }

  const postData = postSnap.data() ?? {};

  if (!(await viewerMayWatch(db, postData, req))) {
    return NextResponse.json(
      { error: "No tienes acceso a esta transmisión" },
      { status: 403 }
    );
  }

  const liveData = postData.liveData as Record<string, unknown> | undefined;

  if (liveData?.streamProvider !== "cloudflare") {
    console.warn("[cf-viewer-proxy] Not a Cloudflare live, streamProvider:", liveData?.streamProvider);
    return NextResponse.json({ error: "Esta transmisión en vivo no usa Cloudflare Stream" }, { status: 400 });
  }

  if (liveData?.status !== "live") {
    console.warn("[cf-viewer-proxy] Live not active, status:", liveData?.status);
    return NextResponse.json({ error: "La transmisión en vivo no está activa actualmente" }, { status: 400 });
  }

  const storedHlsUrl = (liveData?.hlsUrl as string | undefined)?.split("?")[0];
  if (!storedHlsUrl || !storedHlsUrl.includes("/manifest/video.m3u8")) {
    console.error("[cf-viewer-proxy] hlsUrl missing or unexpected format:", storedHlsUrl);
    return NextResponse.json({ error: "URL de stream no disponible" }, { status: 404 });
  }

  const cfWebRTCPlayUrl = storedHlsUrl.replace("/manifest/video.m3u8", "/webRTC/play");

  // Log the destination without exposing any secrets (URL is the public live input URL)
  const urlPreview = cfWebRTCPlayUrl.replace(/https:\/\/[^/]+/, "https://[cf-customer-domain]");
  console.info("[cf-viewer-proxy] Forwarding SDP offer → CF WebRTC play:", urlPreview);

  const sdpOffer = await req.text();
  if (!sdpOffer || !sdpOffer.includes("v=0")) {
    console.warn("[cf-viewer-proxy] Missing or invalid SDP offer (length:", sdpOffer?.length, ")");
    return NextResponse.json({ error: "SDP offer inválido o ausente" }, { status: 400 });
  }

  let cfResp: Response;
  try {
    cfResp = await fetch(cfWebRTCPlayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: sdpOffer,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cf-viewer-proxy] Fetch to Cloudflare failed:", msg);
    return NextResponse.json({ error: "Error de red al conectar con Cloudflare Stream" }, { status: 502 });
  }

  console.info("[cf-viewer-proxy] CF responded with status:", cfResp.status);

  const sdpAnswer = await cfResp.text();

  if (sdpAnswer) {
    const directions = sdpAnswer.match(/a=(sendrecv|sendonly|recvonly|inactive)/g);
    console.info("[cf-viewer-proxy] SDP answer received — length:", sdpAnswer.length, "directions:", directions);
  } else {
    console.warn("[cf-viewer-proxy] CF returned empty response body, status:", cfResp.status);
  }

  if (!cfResp.ok) {
    console.error("[cf-viewer-proxy] CF error", cfResp.status, "body:", sdpAnswer.slice(0, 300));
    return NextResponse.json(
      { error: `Cloudflare Stream error ${cfResp.status}`, detail: sdpAnswer.slice(0, 200) },
      { status: cfResp.status >= 400 && cfResp.status < 600 ? cfResp.status : 502 }
    );
  }

  return new NextResponse(sdpAnswer, {
    status: cfResp.status,
    headers: { "Content-Type": "application/sdp" },
  });
}
