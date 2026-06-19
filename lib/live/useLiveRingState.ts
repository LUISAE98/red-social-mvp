"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

type LiveRingState = {
  isLive: boolean;
  livePostId: string | null;
};

const INITIAL: LiveRingState = { isLive: false, livePostId: null };

export function useLiveRingState(
  entityId: string | null | undefined,
  entityType: "profile" | "group"
): LiveRingState {
  const [state, setState] = useState<LiveRingState>(INITIAL);

  useEffect(() => {
    if (!entityId) {
      setState(INITIAL);
      return;
    }
    const collectionName = entityType === "profile" ? "users" : "groups";
    return onSnapshot(doc(db, collectionName, entityId), (snap) => {
      if (!snap.exists()) {
        setState(INITIAL);
        return;
      }
      const raw = snap.data().activeLivePostId;
      const livePostId = typeof raw === "string" && raw ? raw : null;
      setState({ isLive: !!livePostId, livePostId });
    });
  }, [entityId, entityType]);

  return state;
}
