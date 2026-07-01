"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/app/providers";

type PlatformModState = {
  isPlatformMod: boolean;
  loading: boolean;
};

/**
 * Devuelve si el usuario actual tiene el Custom Claim `role: 'moderator'`.
 * El claim es asignado desde el script scripts/set-moderator.ts y nunca
 * es modificable desde el cliente.
 */
export function usePlatformMod(): PlatformModState {
  const { user, loading: authLoading } = useAuth();
  const [isPlatformMod, setIsPlatformMod] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setIsPlatformMod(false);
      setLoading(false);
      return;
    }

    user
      .getIdTokenResult()
      .then((result) => {
        setIsPlatformMod(result.claims["role"] === "moderator");
      })
      .catch(() => {
        setIsPlatformMod(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [user, authLoading]);

  return { isPlatformMod, loading };
}
