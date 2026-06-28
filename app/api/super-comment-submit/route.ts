import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { postId, guestId, username, text, tierId, tierName, color, displaySeconds, amount } = body;

    if (!postId || !guestId || !tierId) {
      return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
    }
    if (typeof username !== "string" || username.trim().length < 2 || username.trim().length > 30) {
      return NextResponse.json({ error: "Apodo inválido (2–30 caracteres)" }, { status: 400 });
    }
    if (typeof text !== "string" || text.trim().length === 0 || text.length > 500) {
      return NextResponse.json({ error: "Mensaje inválido" }, { status: 400 });
    }
    if (typeof guestId !== "string" || !guestId.startsWith("guest_")) {
      return NextResponse.json({ error: "Identidad de invitado inválida" }, { status: 400 });
    }

    const db = getAdminFirestore();
    const ref = await db
      .collection("posts")
      .doc(postId)
      .collection("superComments")
      .add({
        userId: guestId,
        username: username.trim(),
        avatarUrl: null,
        text: text.trim(),
        tierId,
        tierName: tierName ?? "",
        color: color ?? "#a855f7",
        displaySeconds: typeof displaySeconds === "number" ? displaySeconds : 10,
        amount: typeof amount === "number" ? amount : 0,
        currency: "MXN",
        status: "paid",
        hidden: false,
        isDeleted: false,
        played: false,
        isGuest: true,
        createdAt: FieldValue.serverTimestamp(),
      });

    return NextResponse.json({ id: ref.id });
  } catch (err) {
    console.error("[super-comment-submit]", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
