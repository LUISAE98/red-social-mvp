"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/app/providers";

type PlatformModState = {
  isPlatformMod: boolean;
  loading: boolean;
  /** true cuando el claim existe pero el proveedor no es Google */
  wrongProvider: boolean;
};

/**
 * Devuelve si el usuario actual tiene el Custom Claim `role: 'moderator'`.
 * El claim es asignado desde el script scripts/set-moderator.ts y nunca
 * es modificable desde el cliente.
 */
export function usePlatformMod(): PlatformModState {
  const { user, loading: authLoading } = useAuth();
  const [isPlatformMod, setIsPlatformMod] = useState(false);
  const [wrongProvider, setWrongProvider] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsPlatformMod(false);
      setWrongProvider(false);
      setLoading(false);
      return;
    }

    user
      .getIdTokenResult()
      .then((result) => {
        const hasClaim = result.claims["role"] === "moderator";
        const signedInWithGoogle = result.signInProvider === "google.com";

        if (hasClaim && !signedInWithGoogle) {
          // Tiene el claim pero esta sesión no usó Google — rechazar
          setIsPlatformMod(false);
          setWrongProvider(true);
        } else {
          setIsPlatformMod(hasClaim && signedInWithGoogle);
          setWrongProvider(false);
        }
      })
      .catch(() => {
        setIsPlatformMod(false);
        setWrongProvider(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [user, authLoading]);

  return { isPlatformMod, loading, wrongProvider };
}
