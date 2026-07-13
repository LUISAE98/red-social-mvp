"use client";

import { useCallback, useEffect, useState } from "react";

const storageKey = (uid: string) => `vibra_sidebar_visits_${uid}`;

export function useSidebarVisitCounts(uid: string | null) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!uid) { setCounts({}); return; }
    try {
      const raw = localStorage.getItem(storageKey(uid));
      if (raw) setCounts(JSON.parse(raw) as Record<string, number>);
    } catch {}
  }, [uid]);

  const increment = useCallback(
    (id: string) => {
      if (!uid) return;
      setCounts((prev) => {
        const next = { ...prev, [id]: (prev[id] ?? 0) + 1 };
        try { localStorage.setItem(storageKey(uid), JSON.stringify(next)); } catch {}
        return next;
      });
    },
    [uid]
  );

  return { counts, increment };
}
