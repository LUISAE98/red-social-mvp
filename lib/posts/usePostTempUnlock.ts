"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

const STORAGE_PREFIX = "vibra_post_unlocked_";

/**
 * Temporary unlock for premium posts.
 * - Logged-in users: writes a real postAccess doc to Firestore so Firestore rules
 *   verify the access and comments/likes are enabled.
 * - Guests: localStorage only (no comments/likes — shown as a warning).
 *
 * Replace the Firestore write with the real Mercado Pago confirmation when integrated.
 */
export function usePostTempUnlock(postId: string, currentUserId?: string | null) {
  const key = `${STORAGE_PREFIX}${postId}`;

  const [isTempUnlocked, setIsTempUnlocked] = useState(false);

  useEffect(() => {
    try {
      setIsTempUnlocked(localStorage.getItem(key) === "1");
    } catch {}
  }, [key]);

  const unlock = useCallback(async () => {
    try {
      localStorage.setItem(key, "1");
    } catch {}

    setIsTempUnlocked(true);

    if (currentUserId) {
      const accessId = `${currentUserId}_${postId}`;
      await setDoc(doc(db, "postAccess", accessId), {
        postId,
        buyerId: currentUserId,
        status: "active",
        createdAt: serverTimestamp(),
      });
    }
  }, [key, postId, currentUserId]);

  return { isTempUnlocked, unlock };
}
