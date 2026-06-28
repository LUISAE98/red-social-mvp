import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const postId = req.nextUrl.searchParams.get("postId");
  if (!postId) return NextResponse.json({ activeSuper: null });

  try {
    const db = getAdminFirestore();
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
