import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Devuelve al creador la URL del Browser Source de OBS, con su token.
//
// El token NO puede vivir en `liveOverlays/{postId}`, que es de lectura pública
// (`allow get: if true`, necesario para que OBS lea el overlay en comunidades
// privadas). Vive en las credenciales privadas del live, que solo lee el autor
// y que ningún cliente puede escribir.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("Authorization");
  const idToken = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!idToken) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let uid: string;
  try {
    uid = (await getAdminAuth().verifyIdToken(idToken)).uid;
  } catch {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const postId = req.nextUrl.searchParams.get("postId");
  if (!postId) return NextResponse.json({ error: "postId requerido" }, { status: 400 });

  const db = getAdminFirestore();

  const postSnap = await db.collection("posts").doc(postId).get();
  if (!postSnap.exists) return NextResponse.json({ error: "Post no encontrado" }, { status: 404 });
  if (postSnap.data()?.authorId !== uid) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const credRef = db.collection("posts").doc(postId).collection("liveStream").doc("credentials");
  const credSnap = await credRef.get();

  let token = credSnap.data()?.overlayToken as string | undefined;
  if (!token) {
    token = randomBytes(24).toString("hex");
    await credRef.set({ overlayToken: token }, { merge: true });
  }

  return NextResponse.json({ postId, token });
}
