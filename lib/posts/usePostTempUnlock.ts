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
  isVod?: boolean,
) {
  // El caché se scopea por SESIÓN: el uid cuando hay sesión, o "guest" sin sesión.
  // Así un desbloqueo NO se hereda al cambiar de cuenta en el mismo dispositivo
  // (antes la llave era solo por postId → se filtraba entre sesiones).
  const scope = currentUserId ?? "guest";
  const key = `${STORAGE_PREFIX}${scope}_${postId}`;

  const [isTempUnlocked, setIsTempUnlocked] = useState(false);

  useEffect(() => {
    try {
      // Limpia el caché LEGACY sin scope (versión con el bug de fuga entre sesiones),
      // por si quedó un desbloqueo filtrado de antes de este fix.
      const legacyKey = `${STORAGE_PREFIX}${postId}`;
      if (localStorage.getItem(legacyKey) !== null) localStorage.removeItem(legacyKey);
      setIsTempUnlocked(localStorage.getItem(key) === "1");
    } catch {}
  }, [key, postId]);

  const unlock = useCallback(async () => {
    try {
      localStorage.setItem(key, "1");
    } catch {}

    setIsTempUnlocked(true);

    // Geo del planeta 3D: `unlock()` SOLO se llama tras una compra real, así que se
    // registra SIEMPRE (no se gatea por `currentUserId` — `registrarCompraGeo` ya exige
    // `creatorId`, y el INVITADO anónimo puede tener `currentUserId` null en el closure).
    // VOD (post con `liveData`) → `vod_ticket`; post premium normal → `premium_post`.
    registrarCompraGeo({
      creatorId,
      serviceType: isVod ? "vod_ticket" : "premium_post",
      grossAmount: price,
    });
  }, [creatorId, price, isVod]);

  return { isTempUnlocked, unlock };
}
