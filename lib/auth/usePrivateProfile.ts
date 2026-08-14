"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";

export type PrivateProfile = {
  email: string | null;
  birthDate: string | null;
  sex: string | null;
};

/**
 * Lee los datos personales del perfil, que viven fuera del documento público.
 *
 * `users/{uid}` lo lee cualquiera y Firestore no oculta campos sueltos, así que
 * el correo, la fecha de nacimiento y el sexo se mudaron a
 * `users/{uid}/private/identity`, legible SOLO por su dueño.
 *
 * Devuelve null mientras carga, si no eres el dueño, o si el perfil todavía no
 * tiene su documento privado (cuentas creadas antes de la mudanza y aún sin
 * migrar). Quien lo use debe tratar el null como "dato no disponible", no como
 * un error.
 */
export function usePrivateProfile(uid: string | null | undefined, enabled: boolean) {
  const [data, setData] = useState<PrivateProfile | null>(null);

  useEffect(() => {
    if (!uid || !enabled) {
      setData(null);
      return;
    }

    let cancelled = false;

    getDoc(doc(db, "users", uid, "private", "identity"))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setData(null);
          return;
        }
        const raw = snap.data();
        setData({
          email: typeof raw.email === "string" ? raw.email : null,
          birthDate: typeof raw.birthDate === "string" ? raw.birthDate : null,
          sex: typeof raw.sex === "string" ? raw.sex : null,
        });
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [uid, enabled]);

  return data;
}
