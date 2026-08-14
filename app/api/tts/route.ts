import { createHash } from "crypto";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { NextRequest } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Este endpoint NO puede exigir token: sus tres llamadores lo consumen con
// `new Audio(url)` (espectadores de un live y el Browser Source de OBS), que no
// manda cabeceras, y muchos de esos espectadores son invitados sin sesión. Se
// acota por otras vías: voz de una lista fija, texto topado, ritmo por IP y
// caché para que las repeticiones ni lleguen al servidor.

// Solo las voces que el producto usa de verdad. Antes se aceptaba cualquier
// cadena y se pasaba tal cual al motor.
const ALLOWED_VOICES = new Set([
  "es-MX-DaliaNeural",
  "es-MX-JorgeNeural",
  "es-ES-ElviraNeural",
  "en-US-AriaNeural",
  "en-US-GuyNeural",
  "pt-BR-FranciscaNeural",
]);
const DEFAULT_VOICE = "es-MX-DaliaNeural";

const MAX_CHARS = 1000;

// Generoso a propósito: varios espectadores pueden compartir IP tras un NAT, y
// un live movido encadena supercomentarios. Aun así acota un abuso ilimitado.
const RATE_LIMIT_MAX = 300;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function clientKey(request: NextRequest): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "desconocida";
  // Se guarda el hash, no la IP: para contar basta y no crea un registro de
  // direcciones de espectadores.
  return createHash("sha256").update(`tts:${ip}`).digest("hex").slice(0, 32);
}

async function withinRateLimit(request: NextRequest): Promise<boolean> {
  try {
    const db = getAdminFirestore();
    const ref = db.collection("ttsLimits").doc(clientKey(request));
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const windowStart = (snap.data()?.windowStart as number | undefined) ?? 0;
      const count = (snap.data()?.count as number | undefined) ?? 0;

      if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
        tx.set(ref, {
          windowStart: now,
          count: 1,
          expiresAt: new Date(now + 2 * RATE_LIMIT_WINDOW_MS),
        });
        return true;
      }
      if (count >= RATE_LIMIT_MAX) return false;
      tx.set(ref, { windowStart, count: count + 1 }, { merge: true });
      return true;
    });
  } catch {
    // Si el contador falla, no se corta el audio de un live en marcha.
    return true;
  }
}

export async function GET(request: NextRequest) {
  const text = (request.nextUrl.searchParams.get("text") ?? "").slice(0, MAX_CHARS);
  const requestedVoice = request.nextUrl.searchParams.get("voice") ?? DEFAULT_VOICE;
  const voice = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : DEFAULT_VOICE;

  if (!text.trim()) {
    return new Response(null, { status: 204 });
  }

  if (!(await withinRateLimit(request))) {
    return new Response(null, { status: 429 });
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
        "Content-Length": buffer.byteLength.toString(),
        // La salida es determinista para (texto, voz) y el texto ya viaja en la
        // URL, así que cachear no revela nada nuevo y evita regenerar el mismo
        // audio cuando varios espectadores oyen el mismo supercomentario.
        "Cache-Control": "public, max-age=3600, immutable",
      },
    });
  } catch (err) {
    console.error("[TTS API]", err);
    return new Response(null, { status: 500 });
  }
}
