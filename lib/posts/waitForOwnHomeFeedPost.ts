"use client";

/**
 * Espera a que TU publicación aterrice en tu propio home feed.
 *
 * El feed no se escribe al publicar: lo llena un trigger de backend
 * (`onHomeFeedPostCreated` → `addPostToUserHomeFeed`), así que entre que la
 * llamada de creación resuelve y el documento existe pasa un rato. Refrescar de
 * inmediato suele no traer nada, y el usuario ve su publicación desaparecer en
 * el vacío justo cuando más atento está.
 *
 * Se resuelve con UN listener que se cancela solo, en vez de reconsultar el feed
 * varias veces a ciegas.
 *
 * 🚨 La línea base es el ID del documento más reciente, NO una marca de tiempo.
 * El `createdAt` del feed lo pone el servidor y el reloj del navegador puede ir
 * adelantado o atrasado; comparar contra él daría falsos positivos y negativos.
 * Comparar identidades no tiene ese problema.
 */

import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";

import { db } from "@/lib/firebase";

/** Si el trigger tarda más que esto, se deja de esperar y se suelta el listener. */
const WAIT_TIMEOUT_MS = 20000;

export function waitForOwnHomeFeedPost(params: {
  uid: string;
  onArrived: () => void;
}): () => void {
  const { uid, onArrived } = params;

  // `undefined` = aún no se ha leído nada; `null` = leído y el feed está vacío.
  let baselineId: string | null | undefined = undefined;
  let done = false;

  const topOfFeed = query(
    collection(db, "users", uid, "homeFeed"),
    orderBy("createdAt", "desc"),
    limit(1)
  );

  const finish = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    unsub();
  };

  const unsub = onSnapshot(
    topOfFeed,
    (snap) => {
      if (done) return;

      const top = snap.docs[0] ?? null;
      const topId = top?.id ?? null;

      // Primera emisión: solo fija la referencia de "lo que ya había".
      if (baselineId === undefined) {
        baselineId = topId;
        return;
      }

      if (topId === baselineId || !top) return;

      // Que encabece el feed no basta: puede ser el post de alguien a quien
      // sigues, que llegó mientras publicabas. Solo cuenta si es tuyo.
      if (top.get("authorId") !== uid) return;

      finish();
      onArrived();
    },
    () => finish()
  );

  const timer = window.setTimeout(finish, WAIT_TIMEOUT_MS);

  return finish;
}
