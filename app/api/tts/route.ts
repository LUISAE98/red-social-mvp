import { createHash } from "crypto";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { NextRequest } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { VOCES_PERMITIDAS, VOZ_RESERVA } from "@/lib/tts/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Este endpoint NO puede exigir token: sus tres llamadores lo consumen con
// `new Audio(url)` (espectadores de un live y el Browser Source de OBS), que no
// manda cabeceras, y muchos de esos espectadores son invitados sin sesión. Se
// acota por otras vías: voz de una lista fija, texto topado, ritmo por IP y
// caché para que las repeticiones ni lleguen al servidor.

// La lista blanca sigue siendo obligatoria —antes se aceptaba cualquier cadena
// y se pasaba tal cual al motor— pero ya no se escribe aquí: se deriva del mapa
// de idiomas. Escribirla a mano significaba que añadir un idioma dejaba su voz
// fuera de la lista, y el endpoint la cambiaba en silencio por la de reserva:
// el fallo se habría visto como "el japonés suena en español", no como un error.
const ALLOWED_VOICES = VOCES_PERMITIDAS;
const DEFAULT_VOICE = VOZ_RESERVA;

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

/**
 * Respaldo en memoria del proceso, por si el contador de Firestore falla.
 *
 * ⚠️ El `catch` de abajo deja pasar la petición a propósito —no se corta el audio
 * de un directo en marcha porque la base parpadee—, pero eso significaba que
 * mientras Firestore estuviera caído el endpoint se quedaba SIN NINGÚN tope, y es
 * público. Este contador no sustituye al de Firestore: no se comparte entre
 * instancias y se pierde al reciclarse. Solo pone un techo por instancia para que
 * "fallo del contador" no equivalga a "barra libre".
 */
const RESPALDO_MAX = 600;
const respaldoEnMemoria = new Map<string, { inicio: number; conteo: number }>();

function dentroDelRespaldo(clave: string): boolean {
  const ahora = Date.now();
  const actual = respaldoEnMemoria.get(clave);

  if (!actual || ahora - actual.inicio > RATE_LIMIT_WINDOW_MS) {
    // Poda perezosa: sin esto el mapa crece sin límite en una instancia longeva.
    if (respaldoEnMemoria.size > 5000) respaldoEnMemoria.clear();
    respaldoEnMemoria.set(clave, { inicio: ahora, conteo: 1 });
    return true;
  }

  if (actual.conteo >= RESPALDO_MAX) return false;
  actual.conteo += 1;
  return true;
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
    // Si el contador falla, no se corta el audio de un live en marcha — pero
    // tampoco se queda sin ningún tope: manda el respaldo en memoria.
    return dentroDelRespaldo(clientKey(request));
  }
}

/**
 * Cada petición abre su propia conexión a Microsoft.
 *
 * Se intentó reutilizarla por voz para ahorrar el saludo (~1 s), pero la
 * librería no lo admite entre peticiones: el `end` de la síntesis anterior
 * cerraba el stream de la siguiente y la respuesta salía VACÍA. Medido: una de
 * cada dos llamadas devolvía 0 bytes. Si algún día se quiere ese ahorro, hay
 * que serializar por conexión, no compartirla.
 */

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
    const { audioStream } = tts.toStream(text);

    /**
     * Se transmite según llega, en vez de juntar el audio entero y mandarlo al
     * final. Antes un texto de 600 caracteres tardaba 13 s en empezar a sonar
     * porque el servidor esperaba a la última sílaba; ahora suena en cuanto
     * Microsoft manda el primer trozo.
     *
     * El precio es que se va el `Content-Length` —no se sabe el tamaño hasta
     * terminar—, así que la respuesta viaja troceada. La caché de una hora
     * sigue funcionando: HTTP no necesita el tamaño para guardar la respuesta.
     */
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        audioStream.on("data", (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        audioStream.on("end", () => controller.close());
        audioStream.on("error", (err: unknown) => controller.error(err));
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "audio/mpeg",
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
