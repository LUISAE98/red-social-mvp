"use client";

// Lógica del onboarding de perfil (crear/actualizar doc, subir foto/portada,
// push). Se comparte entre:
//   - La página /complete-profile (CompleteProfileClient).
//   - El 4º panel del swap del login (usuario nuevo de Google).
// Devuelve `panel` (props listas para CompleteProfilePanel) y `submit`.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";
import {
  cleanName,
  completeGoogleProfile,
  isValidHandle,
  normalizeHandle,
} from "@/lib/auth/profileOnboarding";
import { enablePush, isPushSupported } from "@/lib/push/fcm";
import { uploadProfileImage } from "@/lib/storage/uploadProfileImage";

export function useProfileOnboarding(user: User | null) {
  const t = useTranslations("completeProfile");

  // ¿El usuario ya tiene doc? (Google nuevo = no → crear; existente = actualizar.)
  const [hasProfile, setHasProfile] = useState(false);
  /** El perfil existe pero le falta foto o portada. */
  const [faltanImagenes, setFaltanImagenes] = useState(false);
  const [ready, setReady] = useState(false);

  const [handle, setHandle] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null);
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);

  const [notifOn, setNotifOn] = useState(true);
  const [pushSupported, setPushSupported] = useState(false);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void isPushSupported().then((ok) => {
      if (alive) setPushSupported(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Prellenado según el usuario (doc existente → bio; Google nuevo → identidad).
  useEffect(() => {
    if (!user) {
      setReady(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as {
            bio?: string;
            photoURL?: string | null;
            coverUrl?: string | null;
          };
          setHasProfile(true);
          setBio((prev) => prev || data.bio || "");
          // Un perfil puede existir y aun así estar a medias. La identidad
          // —usuario, nombre, apellido— la pone siempre quien lo crea, así que
          // lo único que puede faltar de verdad son las imágenes.
          setFaltanImagenes(!data.photoURL || !data.coverUrl);
        } else {
          setHasProfile(false);
          const displayName = user.displayName?.trim() || "";
          const parts = displayName.split(/\s+/).filter(Boolean);
          if (parts[0]) setFirstName((prev) => prev || parts[0]);
          if (parts.length > 1) {
            setLastName((prev) => prev || parts.slice(1).join(" "));
          }
          const emailPrefix = user.email?.split("@")[0] || "";
          if (emailPrefix) setHandle((prev) => prev || normalizeHandle(emailPrefix));
        }
      } catch {
        if (!cancelled) setHasProfile(false);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function submit(e: React.FormEvent, onCompleted: () => void) {
    e.preventDefault();
    setMsg(null);

    if (!user) {
      setMsg(t("errorSessionExpired"));
      return;
    }
    const uid = user.uid;

    if (!hasProfile) {
      const nh = normalizeHandle(handle);
      const fn = cleanName(firstName);
      const ln = cleanName(lastName);
      if (!isValidHandle(nh)) {
        setMsg(t("errorInvalidHandle"));
        return;
      }
      if (!fn) {
        setMsg(t("errorFirstNameRequired"));
        return;
      }
      if (!ln) {
        setMsg(t("errorLastNameRequired"));
        return;
      }
    }

    setLoading(true);
    try {
      let photoURL: string | undefined;
      let coverUrl: string | null = null;
      if (avatarBlob) {
        try {
          photoURL = await uploadProfileImage(uid, "avatar", avatarBlob);
        } catch {
          /* opcional */
        }
      }
      if (coverBlob) {
        try {
          coverUrl = await uploadProfileImage(uid, "cover", coverBlob);
        } catch {
          /* opcional */
        }
      }

      if (!hasProfile) {
        await completeGoogleProfile(db, {
          user,
          handle: normalizeHandle(handle),
          firstName: cleanName(firstName),
          lastName: cleanName(lastName),
          bio,
          photoURL,
          coverUrl,
        });
      } else {
        await updateDoc(doc(db, "users", uid), {
          bio: bio.trim(),
          updatedAt: serverTimestamp(),
        });
        if (photoURL || coverUrl) {
          const imgUpdate: Record<string, unknown> = { updatedAt: serverTimestamp() };
          if (photoURL) imgUpdate.photoURL = photoURL;
          if (coverUrl) imgUpdate.coverUrl = coverUrl;
          await updateDoc(doc(db, "users", uid), imgUpdate);
        }
      }

      if (notifOn && pushSupported) {
        try {
          await enablePush(uid);
        } catch {
          /* permiso denegado: seguimos */
        }
      }

      onCompleted();
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : t("errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  return {
    ready,
    hasProfile,
    /**
     * No queda nada que pedirle a esta persona.
     *
     * Tiene perfil Y tiene sus dos imágenes. Quien ofrezca completar el perfil
     * fuera del alta —tras una compra, por ejemplo— se calla cuando esto es
     * cierto: insistirle a quien ya lo tiene todo es ruido.
     */
    perfilCompleto: hasProfile && !faltanImagenes,
    submit,
    // Props listas para <CompleteProfilePanel/> (menos onSubmit/onCancel, que
    // los pone quien lo monta según su flujo).
    panel: {
      showIdentity: !hasProfile,
      handle,
      firstName,
      lastName,
      onHandleChange: (v: string) => setHandle(normalizeHandle(v)),
      onFirstNameChange: setFirstName,
      onLastNameChange: setLastName,
      initialPhotoUrl: user?.photoURL ?? null,
      onAvatarBlobChange: setAvatarBlob,
      onCoverBlobChange: setCoverBlob,
      bio,
      onBioChange: setBio,
      notifOn,
      onToggleNotif: () => setNotifOn((v) => !v),
      pushSupported,
      loading,
      msg,
    },
  };
}
