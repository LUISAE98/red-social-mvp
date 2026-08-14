import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { isCloudflareStreamUrl } from "@/lib/live/cfStreamUrls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAccount(
  req: NextRequest
): Promise<{ uid: string; anonymous: boolean } | null> {
  try {
    const auth = req.headers.get("Authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return null;
    const decoded = await getAdminAuth().verifyIdToken(token);
    // Un INVITADO (auth anónima) NO cuenta como "cuenta real".
    const anonymous = (decoded.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider === "anonymous";
    return { uid: decoded.uid, anonymous };
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
 * Alcances del live (`liveData.visibilityMode`):
 *  · "everyone"        → acceso libre (incl. invitados), como hasta ahora.
 *  · "logged_in_only"  → exige CUENTA REAL (no invitado/anónimo); cualquiera basta.
 *  · "members_only" (o comunidad OCULTA) → exige cuenta real + membresía del grupo.
 */
async function viewerMayWatch(
  db: FirebaseFirestore.Firestore,
  post: FirebaseFirestore.DocumentData,
  req: NextRequest
): Promise<boolean> {
  const groupId = typeof post.groupId === "string" && post.groupId ? post.groupId : null;
  const liveData = post.liveData as Record<string, unknown> | undefined;
  const visibilityMode = typeof liveData?.visibilityMode === "string" ? liveData.visibilityMode : null;

  const groupSnap = groupId ? await db.collection("groups").doc(groupId).get() : null;
  const groupVisibility = groupSnap?.data()?.visibility;

  const membersOnly = groupVisibility === "hidden" || visibilityMode === "members_only";
  const loggedInOnly = visibilityMode === "logged_in_only";

  // "Todos": libre.
  if (!membersOnly && !loggedInOnly) return true;

  // Restringido → exige CUENTA REAL (bloquea sin-sesión Y sesión anónima de invitado).
  const acct = await verifyAccount(req);
  if (!acct || acct.anonymous) return false;
  const uid = acct.uid;

  // "Solo personas con cuenta": cualquier cuenta real basta.
  if (loggedInOnly && !membersOnly) return true;

  // "Solo miembros" / comunidad oculta: además exige membresía (o autor/dueño).
  if (post.authorId === uid) return true;
  if (groupSnap?.data()?.ownerId === uid) return true;
  if (!groupId) return false;

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

  // `liveData` la escribe el AUTOR desde el cliente (canEditLivePost en las
  // reglas), así que `hlsUrl` es entrada no confiable aunque viva en Firestore.
  // Sin esta allowlist, un creador podía apuntar el fetch del servidor a la red
  // interna y recibir de vuelta la respuesta en el cuerpo de este endpoint.
  if (!isCloudflareStreamUrl(storedHlsUrl)) {
    console.error("[cf-viewer-proxy] hlsUrl fuera de la allowlist de Cloudflare, post:", postId);
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
      // Sin timeout explícito la petición colgada se comía el de la plataforma.
      signal: AbortSignal.timeout(10_000),
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
    // El detalle del proveedor se queda en los logs: devolverlo al cliente
    // filtra interioridades de la infraestructura sin ayudar a quien mira.
    console.error("[cf-viewer-proxy] CF error", cfResp.status, "body:", sdpAnswer.slice(0, 300));
    return NextResponse.json(
      { error: "No se pudo conectar con la transmisión" },
      { status: cfResp.status >= 400 && cfResp.status < 600 ? cfResp.status : 502 }
    );
  }

  return new NextResponse(sdpAnswer, {
    status: cfResp.status,
    headers: { "Content-Type": "application/sdp" },
  });
}
