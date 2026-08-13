import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// OBS llama aquí cuando ya está mostrando el supercomentario, para que el panel
// del creador sincronice su propio overlay.
//
// La página que llama (`public/live-overlay.html`) corre dentro de OBS y NO
// tiene sesión de Firebase, así que no puede autenticarse como el creador. La
// prueba de identidad es el token de la URL del Browser Source, que solo el
// autor del live puede obtener (ver `/api/live-overlay-url`). Sin él, cualquiera
// que conociera el postId podía escribir `obsReady` con el Admin SDK.
function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest) {
  try {
    const { postId, scheduledAt, token } = await req.json();

    if (typeof postId !== "string" || !postId) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (typeof token !== "string" || !token) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    // `scheduledAt` termina en Firestore: solo se acepta un número finito.
    const readyAt =
      typeof scheduledAt === "number" && Number.isFinite(scheduledAt) ? scheduledAt : Date.now();

    const db = getAdminFirestore();

    const credSnap = await db
      .collection("posts")
      .doc(postId)
      .collection("liveStream")
      .doc("credentials")
      .get();

    const expected = credSnap.data()?.overlayToken as string | undefined;
    if (!expected || !tokensMatch(expected, token)) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    await db.collection("liveOverlays").doc(postId).update({ obsReady: readyAt });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
