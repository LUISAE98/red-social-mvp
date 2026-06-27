import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const text = (request.nextUrl.searchParams.get("text") ?? "").slice(0, 1000);
  const voice = request.nextUrl.searchParams.get("voice") ?? "es-MX-DaliaNeural";

  if (!text.trim()) {
    return new Response(null, { status: 204 });
  }

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const chunks: Buffer[] = [];
    const { audioStream } = tts.toStream(text);

    await new Promise<void>((resolve, reject) => {
      audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      audioStream.on("end", resolve);
      audioStream.on("error", reject);
    });

    const buffer = Buffer.concat(chunks);
    return new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[TTS API]", err);
    return new Response(null, { status: 500 });
  }
}
