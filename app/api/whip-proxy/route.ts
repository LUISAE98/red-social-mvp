import { NextRequest, NextResponse } from "next/server";

// Mux REST API — WHIP endpoint requires Basic auth (tokenId:tokenSecret)
const MUX_API_BASE = "https://api.mux.com";

function muxAuthHeader(): string | null {
  const id = process.env.MUX_TOKEN_ID;
  const secret = process.env.MUX_TOKEN_SECRET;
  if (!id || !secret) return null;
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

function errorDetails(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
  const causeStr = cause ? ` (cause: ${cause.code ?? cause.message ?? JSON.stringify(cause)})` : "";
  return `${err.message}${causeStr}`;
}

export async function POST(req: NextRequest) {
  const liveStreamId = req.nextUrl.searchParams.get("id");
  if (!liveStreamId) {
    return NextResponse.json({ error: "Missing liveStreamId" }, { status: 400 });
  }

  const auth = muxAuthHeader();
  if (!auth) {
    return NextResponse.json(
      { error: "MUX_TOKEN_ID / MUX_TOKEN_SECRET no configurados en .env.local" },
      { status: 500 },
    );
  }

  const sdpOffer = await req.text();
  const whipUrl = `${MUX_API_BASE}/video/v1/live-streams/${liveStreamId}/whip`;

  let muxResp: Response;
  try {
    muxResp = await fetch(whipUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp",
        "Authorization": auth,
      },
      body: sdpOffer,
    });
  } catch (err) {
    const detail = errorDetails(err);
    console.error("[whip-proxy] fetch error →", whipUrl, detail);
    return NextResponse.json(
      { error: `Error connecting to Mux: ${detail}`, url: whipUrl },
      { status: 502 },
    );
  }

  const body = await muxResp.text();
  console.info("[whip-proxy] Mux responded", muxResp.status, body.slice(0, 200));

  if (!muxResp.ok) {
    return NextResponse.json(
      { error: `Mux error ${muxResp.status}`, body },
      { status: muxResp.status >= 400 && muxResp.status < 600 ? muxResp.status : 502 },
    );
  }

  const location = muxResp.headers.get("Location");
  const headers: Record<string, string> = { "Content-Type": "application/sdp" };
  if (location) headers["X-Whip-Resource"] = location;

  return new NextResponse(body, { status: muxResp.status, headers });
}

export async function DELETE(req: NextRequest) {
  const resource = req.nextUrl.searchParams.get("r");
  const auth = muxAuthHeader();
  if (resource && auth) {
    try {
      await fetch(resource, { method: "DELETE", headers: { "Authorization": auth } });
    } catch { /* best effort */ }
  }
  return new NextResponse(null, { status: 204 });
}
