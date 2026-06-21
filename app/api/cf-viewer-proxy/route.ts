import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const liveData = postSnap.data()?.liveData as Record<string, unknown> | undefined;

  if (liveData?.streamProvider !== "cloudflare") {
    console.warn("[cf-viewer-proxy] Not a Cloudflare live, streamProvider:", liveData?.streamProvider);
    return NextResponse.json({ error: "Este live no usa Cloudflare Stream" }, { status: 400 });
  }

  if (liveData?.status !== "live") {
    console.warn("[cf-viewer-proxy] Live not active, status:", liveData?.status);
    return NextResponse.json({ error: "El live no está activo actualmente" }, { status: 400 });
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
