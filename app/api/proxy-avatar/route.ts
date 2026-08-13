import { NextRequest, NextResponse } from "next/server";

// Este proxy sirve contenido REMOTO bajo el origen de Vibra. Si se limita a
// comprobar el host de origen, un atacante puede subir un objeto público a
// Google Cloud Storage con `Content-Type: text/html` y hacer que vibraon.com
// sirva su HTML/JS: XSS de origen, con acceso a la sesión del usuario. Por eso
// el tipo de contenido se valida contra una lista, no se copia del remoto.
const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

// Los avatares son imágenes de perfil; 10 MB es holgado. El tope se aplica
// leyendo por partes, no confiando en `content-length`, que el remoto puede
// omitir o mentir.
const MAX_BYTES = 10 * 1024 * 1024;

function isAllowedHost(hostname: string): boolean {
  return (
    hostname.endsWith(".googleapis.com") ||
    hostname.endsWith(".googleusercontent.com") ||
    hostname === "googleapis.com" ||
    hostname === "googleusercontent.com"
  );
}

function isAllowedUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  return isAllowedHost(parsed.hostname);
}

// Lee el cuerpo con tope duro. Devuelve null si se pasa del límite.
async function readCapped(res: Response, max: number): Promise<ArrayBuffer | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  // El buffer se reservó aquí con el tamaño exacto, así que se puede entregar
  // tal cual como cuerpo de la respuesta.
  return out.buffer as ArrayBuffer;
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) return new NextResponse("Missing url", { status: 400 });

  if (!isAllowedUrl(rawUrl)) return new NextResponse("Forbidden", { status: 403 });

  try {
    const upstream = await fetch(rawUrl, { signal: AbortSignal.timeout(8000) });

    // fetch sigue las redirecciones, así que el destino FINAL puede no ser el
    // que autorizamos. Revalidarlo cierra el salto fuera de la lista.
    if (!isAllowedUrl(upstream.url || rawUrl)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    if (!upstream.ok) return new NextResponse("Upstream error", { status: upstream.status });

    // El tipo llega con parámetros ("image/jpeg; charset=..."): quedarse con el
    // MIME a secas antes de comparar.
    const contentType = (upstream.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return new NextResponse("Unsupported media type", { status: 415 });
    }

    const body = await readCapped(upstream, MAX_BYTES);
    if (!body) return new NextResponse("Payload too large", { status: 413 });

    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        // Cinturón y tirantes por si algún día se ensancha la lista de tipos:
        // el navegador no debe adivinar el tipo ni ejecutar nada de aquí.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return new NextResponse("Fetch error", { status: 500 });
  }
}
