import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { postId, scheduledAt } = await req.json();
    if (!postId) return NextResponse.json({ ok: false });
    const db = getAdminFirestore();
    await db.collection("liveOverlays").doc(postId).update({ obsReady: scheduledAt ?? Date.now() });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
