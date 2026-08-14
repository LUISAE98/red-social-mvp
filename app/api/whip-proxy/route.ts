import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { isCloudflareStreamUrl, resolveCloudflareStreamUrl } from "@/lib/live/cfStreamUrls";

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

// POST — browser sends SDP offer; server reads the private WHIP URL from Firestore
// and proxies the request to Cloudflare Stream so the stream key is never exposed to the client.
export async function POST(req: NextRequest) {
  const uid = await verifyAndGetUid(req);
  if (!uid) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const postId = req.nextUrl.searchParams.get("postId");
  if (!postId) return NextResponse.json({ error: "postId requerido" }, { status: 400 });

  const db = getAdminFirestore();

  const postSnap = await db.collection("posts").doc(postId).get();
  if (!postSnap.exists) return NextResponse.json({ error: "Post no encontrado" }, { status: 404 });
  if (postSnap.data()?.authorId !== uid) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const credSnap = await db
    .collection("posts")
    .doc(postId)
    .collection("liveStream")
    .doc("credentials")
    .get();

  if (!credSnap.exists) {
    return NextResponse.json({ error: "Credenciales no encontradas. Configura la transmisión en vivo primero." }, { status: 404 });
  }

  const whipUrl = credSnap.data()?.whipUrl as string | undefined;
  if (!whipUrl) {
    return NextResponse.json({ error: "WHIP URL no disponible" }, { status: 500 });
  }
  // Solo el Admin SDK escribe este doc (`allow write: if false` en las reglas),
  // pero el destino de un fetch server-side se valida siempre.
  if (!isCloudflareStreamUrl(whipUrl)) {
    console.error("[whip-proxy] whipUrl fuera de la allowlist de Cloudflare:", postId);
    return NextResponse.json({ error: "WHIP URL inválida" }, { status: 500 });
  }

  const sdpOffer = await req.text();
  console.info("[whip-proxy] SDP offer directions:", sdpOffer.match(/a=(sendrecv|sendonly|recvonly|inactive)/g));

  let cfResp: Response;
  try {
    cfResp = await fetch(whipUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: sdpOffer,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error("[whip-proxy] fetch error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error conectando con Cloudflare Stream" }, { status: 502 });
  }

  const sdpAnswer = await cfResp.text();
  console.info("[whip-proxy] CF status:", cfResp.status);
  console.info("[whip-proxy] CF SDP answer directions:", sdpAnswer.match(/a=(sendrecv|sendonly|recvonly|inactive)/g));

  if (!cfResp.ok) {
    // El cuerpo del error de Cloudflare se queda en el log, no en la respuesta.
    console.error("[whip-proxy] CF error", cfResp.status, "body:", sdpAnswer.slice(0, 300));
    return NextResponse.json(
      { error: "No se pudo iniciar la transmisión" },
      { status: cfResp.status >= 400 && cfResp.status < 600 ? cfResp.status : 502 }
    );
  }

  // El recurso WHIP se guarda del lado del servidor: el DELETE lo lee de aquí en
  // vez de aceptar una URL del cliente (eso era un SSRF con verbo destructivo).
  const location = resolveCloudflareStreamUrl(cfResp.headers.get("Location"), whipUrl);
  if (location) {
    await credSnap.ref.set({ whipResourceUrl: location }, { merge: true });
  }

  const headers: Record<string, string> = { "Content-Type": "application/sdp" };
  if (location) headers["X-Whip-Resource"] = location;

  return new NextResponse(sdpAnswer, { status: cfResp.status, headers });
}

// DELETE — cierra el recurso WHIP que Cloudflare devolvió al abrir la sesión.
// La URL NUNCA viene del cliente: se lee de las credenciales del post, que solo
// escribe el POST de arriba. El cliente únicamente dice de qué live se trata.
export async function DELETE(req: NextRequest) {
  const uid = await verifyAndGetUid(req);
  if (!uid) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const postId = req.nextUrl.searchParams.get("postId");
  if (!postId) return NextResponse.json({ error: "postId requerido" }, { status: 400 });

  const db = getAdminFirestore();

  const postSnap = await db.collection("posts").doc(postId).get();
  if (!postSnap.exists) return NextResponse.json({ error: "Post no encontrado" }, { status: 404 });
  if (postSnap.data()?.authorId !== uid) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const credRef = db.collection("posts").doc(postId).collection("liveStream").doc("credentials");
  const credSnap = await credRef.get();
  const resource = credSnap.data()?.whipResourceUrl as string | undefined;

  // Sin recurso guardado no hay nada que cerrar (sesión ya cerrada, o transmisión
  // que nunca llegó a abrirse). Doble validación por si el doc trae basura vieja.
  if (resource && isCloudflareStreamUrl(resource)) {
    try {
      await fetch(resource, { method: "DELETE", signal: AbortSignal.timeout(8000) });
    } catch { /* best effort */ }
  } else if (resource) {
    console.warn("[whip-proxy] whipResourceUrl fuera de la allowlist, ignorado:", postId);
  }

  if (credSnap.exists) {
    await credRef.set({ whipResourceUrl: null }, { merge: true });
  }

  return new NextResponse(null, { status: 204 });
}
