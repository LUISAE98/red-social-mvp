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

  const sdpOffer = await req.text();
  console.info("[whip-proxy] SDP offer directions:", sdpOffer.match(/a=(sendrecv|sendonly|recvonly|inactive)/g));

  let cfResp: Response;
  try {
    cfResp = await fetch(whipUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: sdpOffer,
    });
  } catch (err) {
    console.error("[whip-proxy] fetch error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error conectando con Cloudflare Stream" }, { status: 502 });
  }

  const sdpAnswer = await cfResp.text();
  console.info("[whip-proxy] CF status:", cfResp.status);
  console.info("[whip-proxy] CF SDP answer directions:", sdpAnswer.match(/a=(sendrecv|sendonly|recvonly|inactive)/g));

  if (!cfResp.ok) {
    return NextResponse.json(
      { error: `Cloudflare error ${cfResp.status}`, body: sdpAnswer },
      { status: cfResp.status >= 400 && cfResp.status < 600 ? cfResp.status : 502 }
    );
  }

  const location = cfResp.headers.get("Location");
  const headers: Record<string, string> = { "Content-Type": "application/sdp" };
  if (location) headers["X-Whip-Resource"] = location;

  return new NextResponse(sdpAnswer, { status: cfResp.status, headers });
}

// DELETE — closes the WHIP resource URL returned by Cloudflare at session start
export async function DELETE(req: NextRequest) {
  const resource = req.nextUrl.searchParams.get("r");
  if (resource) {
    try {
      await fetch(resource, { method: "DELETE" });
    } catch { /* best effort */ }
  }
  return new NextResponse(null, { status: 204 });
}
