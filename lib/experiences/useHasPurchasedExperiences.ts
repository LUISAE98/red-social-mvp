"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";

/**
 * ¿El usuario ha COMPRADO al menos una experiencia? (lado COMPRADOR).
 *
 * Es el gate del acceso directo "Mis experiencias" (la estrella junto a
 * notificaciones y en el nav inferior). La estrella se enciende SOLO para quien
 * compró algo: quien únicamente vende, o solo navega sin comprar, NO la ve.
 *
 * Ligero a propósito (corre en cada página): un listener por colección con límite
 * chico, sin traer los datos completos del comprador. Devuelve `true` en cuanto
 * detecta la primera compra pagada.
 *
 * Debe coincidir con lo que muestra `useMyExperiences` (la página /experiencias):
 * si aquí hay una compra, allá hay algo que mostrar, y viceversa.
 *
 * ── Colecciones de compra actuales (4 tipos de experiencia) ──────────────────
 *  - greetingRequests         → saludo / consejo / mensaje. Excluye las creadas
 *                               sin pagar (`paymentStatus: "awaiting_payment"`).
 *  - meetGreetRequests        → meet & greet. Siempre pagadas ("simulated_paid"),
 *                               así que su sola existencia = compra.
 *  - exclusiveSessionRequests → sesión exclusiva. Idem: existencia = compra.
 *
 * Al crecer a 11 experiencias, agregar la fuente nueva a `SOURCES` (con su
 * `isPurchased`/`scan` si aplica) y el gate sigue funcionando sin más cambios.
 */

type Source = {
  /** Colección de Firestore donde vive la compra. */
  collection: string;
  /**
   * Cuántos docs escanear. Si hay `isPurchased`, sube el límite para no fallar
   * el filtro cuando hay varias solicitudes sin pagar delante. Si no hay filtro
   * (la existencia ya implica compra), basta con 1.
   */
  scan: number;
  /**
   * Filtro client-side opcional: `true` si el doc representa una compra pagada.
   * Se omite cuando la colección solo almacena compras ya pagadas.
   */
  isPurchased?: (data: Record<string, unknown>) => boolean;
};

const SOURCES: Source[] = [
  {
    collection: "greetingRequests",
    scan: 20,
    isPurchased: (d) => (d as { paymentStatus?: string }).paymentStatus !== "awaiting_payment",
  },
  { collection: "meetGreetRequests", scan: 1 },
  { collection: "exclusiveSessionRequests", scan: 1 },
];

export function useHasPurchasedExperiences(uid: string | null | undefined): boolean {
  // Una bandera por fuente; la estrella se muestra si alguna es `true`.
  const [flags, setFlags] = useState<boolean[]>(() => SOURCES.map(() => false));

  useEffect(() => {
    if (!uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFlags(SOURCES.map(() => false));
      return;
    }

    let cancelled = false;
    const unsubs: Array<() => void> = [];

    // Esperar a que Auth resuelva antes de leer: sin esto `request.auth` puede
    // llegar null al evaluar las reglas y el listener falla silenciosamente.
    auth.authStateReady().then(() => {
      if (cancelled) return;

      SOURCES.forEach((source, i) => {
        const q = query(
          collection(db, source.collection),
          where("buyerId", "==", uid),
          limit(source.scan)
        );
        const unsub = onSnapshot(
          q,
          (snap) => {
            const has = snap.docs.some((d) =>
              source.isPurchased ? source.isPurchased(d.data()) : true
            );
            setFlags((prev) => {
              if (prev[i] === has) return prev;
              const next = [...prev];
              next[i] = has;
              return next;
            });
          },
          () => {
            setFlags((prev) => {
              if (!prev[i]) return prev;
              const next = [...prev];
              next[i] = false;
              return next;
            });
          }
        );
        unsubs.push(unsub);
      });
    });

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [uid]);

  return flags.some(Boolean);
}
