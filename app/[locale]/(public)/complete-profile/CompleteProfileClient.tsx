"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";
import { getNextFromSearchParams } from "@/lib/auth-redirect";
import {
  cleanName,
  completeGoogleProfile,
  isValidHandle,
  normalizeHandle,
} from "@/lib/auth/profileOnboarding";
import { enablePush, isPushSupported } from "@/lib/push/fcm";
import CompleteProfilePanel from "./CompleteProfilePanel";

export default function CompleteProfileClient() {
  const t = useTranslations("completeProfile");
  const router = useRouter();
  const searchParams = useSearchParams();

  const nextPath = getNextFromSearchParams(searchParams, "/");

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [handle, setHandle] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Notificaciones: activadas por defecto en la creación de la cuenta.
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

      setCheckingAuth(false);

      const displayName = user.displayName?.trim() || "";
      const parts = displayName.split(/\s+/).filter(Boolean);

      if (parts[0]) setFirstName((prev) => prev || parts[0]);
      if (parts.length > 1) setLastName((prev) => prev || parts.slice(1).join(" "));

      const emailPrefix = user.email?.split("@")[0] || "";
      if (emailPrefix) setHandle((prev) => prev || normalizeHandle(emailPrefix));
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

    const normalizedHandle = normalizeHandle(handle);
    const cleanedFirstName = cleanName(firstName);
    const cleanedLastName = cleanName(lastName);

    if (!isValidHandle(normalizedHandle)) {
      setMsg(t("errorInvalidHandle"));
      return;
    }

    if (!cleanedFirstName) {
      setMsg(t("errorFirstNameRequired"));
      return;
    }

    if (!cleanedLastName) {
      setMsg(t("errorLastNameRequired"));
      return;
    }

    setLoading(true);

    try {
      await completeGoogleProfile(db, {
        user: currentUser,
        handle: normalizedHandle,
        firstName: cleanedFirstName,
        lastName: cleanedLastName,
      });

      // Si dejó activadas las notificaciones, pide permiso y registra el token
      // de este dispositivo (dentro del gesto del submit). No bloquea el alta.
      if (notifOn && pushSupported) {
        try {
          await enablePush(currentUser.uid);
        } catch {
          /* si el navegador niega el permiso, seguimos con el alta igual */
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
        handle={handle}
        firstName={firstName}
        lastName={lastName}
        onHandleChange={(v) => setHandle(normalizeHandle(v))}
        onFirstNameChange={setFirstName}
        onLastNameChange={setLastName}
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
