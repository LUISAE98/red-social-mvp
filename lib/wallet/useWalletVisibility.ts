"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { captureError } from "@/lib/observability/captureError";

type WalletVisibilityCache = {
  ownerId: string | null;
  hasWallet: boolean;
  loaded: boolean;
};

let walletVisibilityCache: WalletVisibilityCache = {
  ownerId: null,
  hasWallet: false,
  loaded: false,
};

/**
 * Olvida lo que se sabía sobre la wallet de este usuario.
 *
 * La caché vive en el módulo y, una vez resuelta, NO se vuelve a consultar en
 * toda la sesión. Eso está bien para no repetir cinco consultas en cada
 * pantalla, pero significa que activar un servicio no encendía la wallet hasta
 * recargar la página entera.
 *
 * Quien cambie algo que pueda encenderla —activar un servicio, publicar una
 * experiencia— llama aquí y el siguiente montaje vuelve a preguntar.
 */
export function invalidateWalletVisibility(): void {
  walletVisibilityCache = { ownerId: null, hasWallet: false, loaded: false };
}

async function ownerHasAnyActiveGroupServices(ownerId: string): Promise<boolean> {
  const q = query(
    collection(db, "groups"),
    where("ownerId", "==", ownerId),
    limit(20)
  );

  const snap = await getDocs(q);

  return snap.docs.some((docSnap) => {
    const data = docSnap.data() as {
      offerings?: Array<{
        enabled?: boolean;
      }> | null;
      greetingsEnabled?: boolean;
      adviceEnabled?: boolean;
      customClassEnabled?: boolean;
      digitalMeetGreetEnabled?: boolean;
      monetization?: {
        greetingsEnabled?: boolean;
        adviceEnabled?: boolean;
        customClassEnabled?: boolean;
        digitalMeetGreetEnabled?: boolean;
      } | null;
    };

    const offeringsActive =
      Array.isArray(data.offerings) &&
      data.offerings.some((item) => item?.enabled === true);

    const legacyFlagsActive =
      data.greetingsEnabled === true ||
      data.adviceEnabled === true ||
      data.customClassEnabled === true ||
      data.digitalMeetGreetEnabled === true;

    const monetizationFlagsActive =
      data.monetization?.greetingsEnabled === true ||
      data.monetization?.adviceEnabled === true ||
      data.monetization?.customClassEnabled === true ||
      data.monetization?.digitalMeetGreetEnabled === true;

    return offeringsActive || legacyFlagsActive || monetizationFlagsActive;
  });
}

async function ownerHasProfileActiveServices(ownerId: string): Promise<boolean> {
  const userSnap = await getDoc(doc(db, "users", ownerId));
  if (!userSnap.exists()) return false;

  const data = userSnap.data() as {
    offerings?: Array<{ enabled?: boolean }> | null;
    monetization?: {
      greetingsEnabled?: boolean;
      adviceEnabled?: boolean;
      customClassEnabled?: boolean;
      digitalMeetGreetEnabled?: boolean;
      donationsEnabled?: boolean;
    } | null;
  };

  const offeringsActive =
    Array.isArray(data.offerings) &&
    data.offerings.some((item) => item?.enabled === true);

  // ⚠️ `donationsEnabled` estaba declarado arriba pero NO se comprobaba aquí.
  // Un creador con donaciones activas —y solo donaciones— no tenía wallet.
  const monetizationFlagsActive =
    data.monetization?.greetingsEnabled === true ||
    data.monetization?.adviceEnabled === true ||
    data.monetization?.customClassEnabled === true ||
    data.monetization?.digitalMeetGreetEnabled === true ||
    data.monetization?.donationsEnabled === true;

  return offeringsActive || monetizationFlagsActive;
}

async function ownerHasEverHadServiceRequest(ownerId: string): Promise<boolean> {
  // `profileDonations` va en la lista porque una donación ES dinero recibido.
  // Sin ella, alguien podía cobrar una donación real y no tener dónde verla:
  // había saldo y no había wallet.
  const requestCollections = [
    "greetingRequests",
    "meetGreetRequests",
    "exclusiveSessionRequests",
    "profileDonations",
  ];

  const checks = await Promise.all(
    requestCollections.map((col) =>
      getDocs(
        query(collection(db, col), where("creatorId", "==", ownerId), limit(1))
      )
    )
  );

  return checks.some((snap) => !snap.empty);
}

export function useWalletVisibility(ownerId?: string | null) {
  const [hasWallet, setHasWallet] = useState(() => {
    if (ownerId && walletVisibilityCache.ownerId === ownerId) {
      return walletVisibilityCache.hasWallet;
    }

    return false;
  });

  const [loaded, setLoaded] = useState(() => {
    return !!ownerId && walletVisibilityCache.ownerId === ownerId
      ? walletVisibilityCache.loaded
      : false;
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!ownerId) {
        walletVisibilityCache = {
          ownerId: null,
          hasWallet: false,
          loaded: true,
        };

        if (!cancelled) {
          setHasWallet(false);
          setLoaded(true);
        }

        return;
      }

      if (
        walletVisibilityCache.ownerId === ownerId &&
        walletVisibilityCache.loaded
      ) {
        if (!cancelled) {
          setHasWallet(walletVisibilityCache.hasWallet);
          setLoaded(true);
        }

        return;
      }

      if (!cancelled) {
        setLoaded(false);
      }

      try {
        /**
         * ⚠️ `allSettled`, NO `all`.
         *
         * Estas comprobaciones son INDEPENDIENTES y se combinan con un OR: que
         * una falle no dice nada de las otras. Con `Promise.all`, un solo error
         * —una regla que deniega, un índice que falta— rechazaba el conjunto,
         * el `catch` de abajo dejaba la wallet en `false` y lo guardaba en
         * caché. El creador tenía servicios activos y la wallet no aparecía,
         * sin un solo mensaje de error en ningún sitio.
         *
         * Ahora cada una responde por sí misma y el fallo se REPORTA en vez de
         * tragarse: un error aquí apaga una funcionalidad entera y tiene que
         * doler en la consola, no en silencio.
         */
        const resultados = await Promise.allSettled([
          ownerHasAnyActiveGroupServices(ownerId),
          ownerHasProfileActiveServices(ownerId),
          ownerHasEverHadServiceRequest(ownerId),
        ]);

        const nombres = ["servicios de comunidad", "servicios de perfil", "ingresos recibidos"];
        resultados.forEach((r, i) => {
          if (r.status === "rejected") {
            captureError(r.reason, {
              scope: "wallet",
              extra: { where: "useWalletVisibility", comprobacion: nombres[i] },
            });
          }
        });

        const nextHasWallet = resultados.some(
          (r) => r.status === "fulfilled" && r.value === true
        );

        walletVisibilityCache = {
          ownerId,
          hasWallet: nextHasWallet,
          loaded: true,
        };

        if (!cancelled) {
          setHasWallet(nextHasWallet);
          setLoaded(true);
        }
      } catch (err) {
        captureError(err, {
          scope: "wallet",
          extra: { where: "useWalletVisibility", comprobacion: "inesperado" },
        });
        walletVisibilityCache = {
          ownerId,
          hasWallet: false,
          loaded: true,
        };

        if (!cancelled) {
          setHasWallet(false);
          setLoaded(true);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  return {
    hasWallet,
    loaded,
  };
}
