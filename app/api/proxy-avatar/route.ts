import { NextRequest, NextResponse } from "next/server";

function isAllowedHost(hostname: string): boolean {
  return (
    hostname.endsWith(".googleapis.com") ||
    hostname.endsWith(".googleusercontent.com") ||
    hostname === "googleapis.com" ||
    hostname === "googleusercontent.com"
  );
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) return new NextResponse("Missing url", { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return new NextResponse("Invalid url", { status: 400 });
  }

  if (parsed.protocol !== "https:") return new NextResponse("Forbidden", { status: 403 });
  if (!isAllowedHost(parsed.hostname)) return new NextResponse("Forbidden", { status: 403 });

  try {
    const upstream = await fetch(rawUrl, { signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return new NextResponse("Upstream error", { status: upstream.status });
    const buffer = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Fetch error", { status: 500 });
  }
}
