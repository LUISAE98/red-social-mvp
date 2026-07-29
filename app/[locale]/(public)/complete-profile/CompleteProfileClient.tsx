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
import CompleteProfilePanel from "./CompleteProfilePanel";

export default function CompleteProfileClient() {
  const t = useTranslations("completeProfile");
  const router = useRouter();
  const searchParams = useSearchParams();

  const nextPath = getNextFromSearchParams(searchParams, "/");

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  // ¿El usuario YA tiene doc? (defensivo). El flujo normal a este panel es
  // "Google nuevo sin doc" → crear. Si ya existe, solo actualiza.
  const [hasProfile, setHasProfile] = useState(false);

  const [handle, setHandle] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null);
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

      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          const data = snap.data() as { bio?: string };
          setHasProfile(true);
          setBio((prev) => prev || data.bio || "");
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
        setHasProfile(false);
      }

      setCheckingAuth(false);
    });

    return () => unsubscribe();
  }, [nextPath, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!currentUser) {
      setMsg(t("errorSessionExpired"));
      return;
    }
    const uid = currentUser.uid;

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
      // Sube foto/portada (opcionales) mientras la cuenta está autenticada.
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
        // Crea el doc. Si no subió foto, createUserProfileDoc usa la de Google.
        await completeGoogleProfile(db, {
          user: currentUser,
          handle: normalizeHandle(handle),
          firstName: cleanName(firstName),
          lastName: cleanName(lastName),
          bio,
          photoURL,
          coverUrl,
        });
      } else {
        // Ya existe: actualizamos en updates SEPARADOS (las reglas validan cada
        // grupo de campos por separado: bio | photoURL+coverUrl).
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
        initialPhotoUrl={currentUser?.photoURL ?? null}
        onAvatarBlobChange={setAvatarBlob}
        onCoverBlobChange={setCoverBlob}
        bio={bio}
        onBioChange={setBio}
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
