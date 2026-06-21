import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAndGetUid(req: NextRequest): Promise<string | null> {
  try {
    const auth = req.headers.get("Authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return null;
    const decoded = await getAdminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

// POST /api/cf-broadcast — sets activeLivePostId so the live ring appears immediately
export async function POST(req: NextRequest) {
  const uid = await verifyAndGetUid(req);
  if (!uid) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const postId = body?.postId as string | undefined;
  if (!postId) return NextResponse.json({ error: "postId requerido" }, { status: 400 });

  const db = getAdminFirestore();
  const postSnap = await db.collection("posts").doc(postId).get();
  if (!postSnap.exists) return NextResponse.json({ error: "Post no encontrado" }, { status: 404 });
  if (postSnap.data()?.authorId !== uid) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const postData = postSnap.data();
  const liveGroupId = typeof postData?.groupId === "string" && postData.groupId ? postData.groupId : null;
  const setLive = body?.setLive === true;

  const updates: Promise<unknown>[] = [
    db.collection("users").doc(uid).update({ activeLivePostId: postId }),
  ];
  if (liveGroupId) {
    updates.push(db.collection("groups").doc(liveGroupId).update({ activeLivePostId: postId }));
  }
  if (setLive) {
    const now = FieldValue.serverTimestamp();
    updates.push(db.collection("posts").doc(postId).update({
      "liveData.status": "live",
      "liveData.startedAt": now,
      updatedAt: now,
    }));
  }
  await Promise.all(updates).catch((err) => {
    console.error("[cf-broadcast] Failed to set activeLivePostId:", err);
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/cf-broadcast?postId=xxx — marks live as ended and clears live rings
export async function DELETE(req: NextRequest) {
  const uid = await verifyAndGetUid(req);
  if (!uid) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const postId = req.nextUrl.searchParams.get("postId");
  if (!postId) return new NextResponse(null, { status: 204 });

  const db = getAdminFirestore();
  const postSnap = await db.collection("posts").doc(postId).get();
  if (postSnap.exists && postSnap.data()?.authorId !== uid) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const postData = postSnap.data();
  const stopGroupId = typeof postData?.groupId === "string" && postData.groupId ? postData.groupId : null;
  const now = FieldValue.serverTimestamp();

  const clearUpdates: Promise<unknown>[] = [
    db.collection("users").doc(uid).update({ activeLivePostId: FieldValue.delete() }),
    db.collection("posts").doc(postId).update({
      "liveData.status": "ended",
      "liveData.endedAt": now,
      updatedAt: now,
    }),
  ];
  if (stopGroupId) {
    clearUpdates.push(
      db.collection("groups").doc(stopGroupId).update({ activeLivePostId: FieldValue.delete() })
    );
  }
  await Promise.all(clearUpdates).catch((err) => {
    console.error("[cf-broadcast] Failed to clear live state:", err);
  });

  return new NextResponse(null, { status: 204 });
}
