"use client";

import { useCallback, useEffect, useState } from "react";
import { registrarCompraGeo } from "@/lib/wallet/registrarCompraGeo";

const STORAGE_PREFIX = "vibra_post_unlocked_";

/**
 * Reflejo local del desbloqueo de un post premium en ESTE dispositivo.
 *
 * El acceso real (postAccess) lo concede el backend tras el pago aprobado
 * (payPremiumPost → reconcile); el cliente ya NO escribe ese doc. Aquí solo
 * marcamos un flag en localStorage para desbloquear el contenido de inmediato
 * sin esperar a recargar, y registramos la geo de la compra.
 */
export function usePostTempUnlock(
  postId: string,
  currentUserId?: string | null,
  creatorId?: string | null,
  price?: number | null,
) {
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
      registrarCompraGeo({
        creatorId,
        serviceType: "premium_post",
        grossAmount: price,
      });
    }
  }, [key, currentUserId, creatorId, price]);

  return { isTempUnlocked, unlock };
}
