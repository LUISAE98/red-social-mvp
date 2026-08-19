"use client";

// Hook LIGERO para el badge de la estrella (layout): última actividad del comprador
// por categoría, sin traer nombres ni datos completos. 3 listeners por `buyerId`
// (saludos/consejos, meet & greet, sesión exclusiva). Devuelve el timestamp más
// reciente por categoría; el badge se decide comparando contra el "visto".

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  computeCategoryLatest,
  computeCategoryTimestamps,
  type ActivityRow,
  type CategoryLatest,
} from "./experienceActivity";

const EMPTY_ROWS: ActivityRow[] = [];

/**
 * Lo que devuelve: la ultima actividad por categoria (`latest`, para saber SI hay
 * algo nuevo) y la marca de tiempo de cada experiencia (`timestamps`, para saber
 * CUANTAS lo son). El globo del menu lateral lleva un numero, y con solo la mas
 * reciente no se puede contar.
 */
export type BuyerExperienceActivity = {
  latest: CategoryLatest;
  timestamps: Record<keyof CategoryLatest, number[]>;
};

export function useBuyerExperienceActivity(
  uid: string | null | undefined
): BuyerExperienceActivity {
  const [greetings, setGreetings] = useState<ActivityRow[]>(EMPTY_ROWS);
  const [meet, setMeet] = useState<ActivityRow[]>(EMPTY_ROWS);
  const [exclusive, setExclusive] = useState<ActivityRow[]>(EMPTY_ROWS);

  useEffect(() => {
    if (!uid) {
      setGreetings(EMPTY_ROWS);
      setMeet(EMPTY_ROWS);
      setExclusive(EMPTY_ROWS);
      return;
    }
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    auth.authStateReady().then(() => {
      if (cancelled) return;
      const sub = (col: string, setter: (rows: ActivityRow[]) => void) =>
        onSnapshot(
          query(collection(db, col), where("buyerId", "==", uid), limit(200)),
          (snap) => setter(snap.docs.map((d) => ({ data: d.data() as ActivityRow["data"] }))),
          () => setter([])
        );
      unsubs.push(sub("greetingRequests", setGreetings));
      unsubs.push(sub("meetGreetRequests", setMeet));
      unsubs.push(sub("exclusiveSessionRequests", setExclusive));
    });

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [uid]);

  return useMemo(() => {
    // Clasificar saludos/consejos por estado (sin contar los que esperan pago).
    const pendingGreetings = greetings.filter(
      (r) =>
        (r.data.status ?? "") === "pending" &&
        (r.data as { paymentStatus?: string }).paymentStatus !== "awaiting_payment"
    );
    const deliveredGreetings = greetings.filter((r) => r.data.status === "delivered");
    const rejectedGreetings = greetings.filter(
      (r) => r.data.status === "rejected" || r.data.status === "refund_requested" || r.data.status === "refund_review"
    );
    const input = {
      pendingGreetings,
      deliveredGreetings,
      rejectedGreetings,
      sessions: [...meet, ...exclusive],
    };

    return {
      latest: computeCategoryLatest(input),
      timestamps: computeCategoryTimestamps(input),
    };
  }, [greetings, meet, exclusive]);
}
