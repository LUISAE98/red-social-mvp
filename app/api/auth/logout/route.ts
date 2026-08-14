import { NextRequest, NextResponse } from "next/server";
import { BRAND_DOMAIN } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cerrar sesión no destruye datos, pero sí es una acción con efecto: sin
// comprobar el origen, un formulario en otro sitio podía hacer POST aquí y
// sacar al usuario de su sesión sin que él hiciera nada.
function sameOrigin(req: NextRequest): boolean {
  // Los navegadores modernos mandan Sec-Fetch-Site; es la señal más fiable.
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";

  // Respaldo para clientes que no la mandan.
  const origin = req.headers.get("origin");
  if (!origin) return true; // petición sin origen (no es un navegador cruzado)

  try {
    const host = new URL(origin).host;
    return host === req.nextUrl.host || host === BRAND_DOMAIN || host === `www.${BRAND_DOMAIN}`;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });

  response.cookies.set({
    name: "__session",
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
