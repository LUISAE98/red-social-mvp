import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// Alternativa por sondeo al listener de Firestore del Browser Source de OBS.
// Exige el mismo token que `/api/live-overlay-ready`, o sea que solo lo usa
// quien tiene la URL que el autor del live copió de su panel.
//
// ⚠️ RESIDUAL CONOCIDO: `liveOverlays/{postId}` sigue siendo de LECTURA PÚBLICA
// en las reglas (`allow get: if true`), porque la página de OBS lee por
// `onSnapshot` sin sesión de Firebase y necesita funcionar en comunidades
// privadas. Cerrar ese hueco del todo obliga a mover OBS de tiempo real a
// sondeo, con la latencia que eso añade al supercomentario. Es una decisión de
// producto, no técnica. Este gate es defensa en profundidad, no el cierre.
function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(req: NextRequest) {
  const postId = req.nextUrl.searchParams.get("postId");
  const token = req.nextUrl.searchParams.get("t");
  if (!postId || !token) return NextResponse.json({ activeSuper: null }, { status: 400 });

  try {
    const db = getAdminFirestore();

    const credSnap = await db
      .collection("posts")
      .doc(postId)
      .collection("liveStream")
      .doc("credentials")
      .get();

    const expected = credSnap.data()?.overlayToken as string | undefined;
    if (!expected || !tokensMatch(expected, token)) {
      return NextResponse.json({ activeSuper: null }, { status: 403 });
    }

    const snap = await db.collection("liveOverlays").doc(postId).get();
    if (!snap.exists) return NextResponse.json({ activeSuper: null });
    const data = snap.data();
    return NextResponse.json(
      { activeSuper: data?.activeSuper ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ activeSuper: null });
  }
}
