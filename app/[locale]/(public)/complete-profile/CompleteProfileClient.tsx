"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { getNextFromSearchParams } from "@/lib/auth-redirect";
import {
  cleanName,
  completeGoogleProfile,
  isValidHandle,
  normalizeHandle,
} from "@/lib/auth/profileOnboarding";
import { enablePush, isPushSupported } from "@/lib/push/fcm";
import { uploadProfileImage } from "@/lib/storage/uploadProfileImage";
import { updateProfileInterests } from "@/lib/profile/updateProfileInterests";
import type { CanonicalGroupCategory } from "@/types/group";
import CompleteProfilePanel from "./CompleteProfilePanel";

export default function CompleteProfileClient() {
  const t = useTranslations("completeProfile");
  const router = useRouter();
  const searchParams = useSearchParams();

  const nextPath = getNextFromSearchParams(searchParams, "/");

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  // ¿El usuario YA tiene doc de perfil? (alta por email) → solo onboarding
  // (portada/bio/tags). Si NO (Google nuevo) → además pide handle/nombre y crea.
  const [hasProfile, setHasProfile] = useState(false);

  const [handle, setHandle] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");
  const [selectedTags, setSelectedTags] = useState<CanonicalGroupCategory[]>([]);
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [notifOn, setNotifOn] = useState(true);
  const [pushSupported, setPushSupported] = useState(false);

  useEffect(() => {
    let alive = true;
    void isPushSupported().then((ok) => {
      if (alive) setPushSupported(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("loginNoScroll");
    document.body.classList.add("loginNoScroll");
    return () => {
      document.documentElement.classList.remove("loginNoScroll");
      document.body.classList.remove("loginNoScroll");
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);

      if (!user) {
        setCheckingAuth(false);
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
        return;
      }

      // Moderadores no completan perfil — van directo al panel
      const tokenResult = await user.getIdTokenResult();
      if (tokenResult.claims["role"] === "moderator") {
        router.replace("/admin");
        return;
      }

      // ¿Ya existe el doc? (alta por email lo creó en el registro.)
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          const data = snap.data() as {
            bio?: string;
            interests?: CanonicalGroupCategory[];
          };
          setHasProfile(true);
          setBio((prev) => prev || data.bio || "");
          setSelectedTags((prev) =>
            prev.length ? prev : (data.interests ?? [])
          );
        } else {
          // Usuario nuevo de Google: prellenamos identidad con lo de Google.
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
        // Si falla la lectura, asumimos usuario nuevo (pide identidad).
        setHasProfile(false);
      }

      setCheckingAuth(false);
    });

    return () => unsubscribe();
  }, [nextPath, router]);

  function toggleTag(category: CanonicalGroupCategory) {
    setSelectedTags((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!currentUser) {
      setMsg(t("errorSessionExpired"));
      return;
    }
    const uid = currentUser.uid;

    // Validación de identidad solo cuando se pide (Google nuevo).
    if (!hasProfile) {
      const normalizedHandle = normalizeHandle(handle);
      const fn = cleanName(firstName);
      const ln = cleanName(lastName);

      if (!isValidHandle(normalizedHandle)) {
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
      if (!hasProfile) {
        // Crea el doc (misma fuente unificada, vía completeGoogleProfile).
        await completeGoogleProfile(db, {
          user: currentUser,
          handle: normalizeHandle(handle),
          firstName: cleanName(firstName),
          lastName: cleanName(lastName),
          bio,
        });
      } else {
        // Ya existe (alta por email): solo actualizamos la bio.
        await updateDoc(doc(db, "users", uid), {
          bio: bio.trim(),
          updatedAt: serverTimestamp(),
        });
      }

      // Portada: subir + guardar coverUrl (el doc ya existe en ambos caminos).
      if (coverBlob) {
        try {
          const coverUrl = await uploadProfileImage(uid, "cover", coverBlob);
          await updateDoc(doc(db, "users", uid), { coverUrl });
        } catch {
          /* portada opcional */
        }
      }

      // Intereses (tags): callable que valida y reconstruye el índice de búsqueda.
      if (selectedTags.length > 0) {
        try {
          await updateProfileInterests(selectedTags);
        } catch {
          /* no bloquear el onboarding si falla */
        }
      }

      // Notificaciones push (dentro del gesto del submit).
      if (notifOn && pushSupported) {
        try {
          await enablePush(uid);
        } catch {
          /* permiso denegado: seguimos */
        }
      }

      router.replace(nextPath);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setMsg(err.message);
      } else {
        setMsg(t("errorGeneric"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    await signOut(auth);
    router.replace("/login");
  }

  if (checkingAuth) {
    return <main style={{ minHeight: "100dvh", background: "transparent" }} />;
  }

  return (
    <>
      <style jsx global>{`
        html.loginNoScroll,
        body.loginNoScroll {
          overflow: hidden !important;
          height: 100%;
          overscroll-behavior: none;
        }
      `}</style>

      <CompleteProfilePanel
        showIdentity={!hasProfile}
        handle={handle}
        firstName={firstName}
        lastName={lastName}
        onHandleChange={(v) => setHandle(normalizeHandle(v))}
        onFirstNameChange={setFirstName}
        onLastNameChange={setLastName}
        onCoverBlobChange={setCoverBlob}
        bio={bio}
        onBioChange={setBio}
        selectedTags={selectedTags}
        onToggleTag={toggleTag}
        notifOn={notifOn}
        onToggleNotif={() => setNotifOn((v) => !v)}
        pushSupported={pushSupported}
        loading={loading}
        msg={msg}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </>
  );
}
