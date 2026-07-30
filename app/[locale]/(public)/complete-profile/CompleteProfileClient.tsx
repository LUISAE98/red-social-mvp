"use client";

// Página /complete-profile (fallback / acceso directo tras Google). Resuelve al
// usuario autenticado, y monta CompleteProfilePanel dentro de su propio shell.
// La MISMA lógica (useProfileOnboarding) y el MISMO panel se reutilizan como 4º
// panel del swap del login.

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";
import { getNextFromSearchParams } from "@/lib/auth-redirect";
import CompleteProfilePanel from "./CompleteProfilePanel";
import { useProfileOnboarding } from "./useProfileOnboarding";

export default function CompleteProfileClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = getNextFromSearchParams(searchParams, "/");

  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const onboarding = useProfileOnboarding(user);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setCheckingAuth(false);
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
        return;
      }
      const tokenResult = await u.getIdTokenResult();
      if (tokenResult.claims["role"] === "moderator") {
        router.replace("/admin");
        return;
      }
      setUser(u);
      setCheckingAuth(false);
    });
    return () => unsub();
  }, [nextPath, router]);

  const pageStyle: React.CSSProperties = {
    minHeight: "100dvh",
    display: "grid",
    placeItems: "start center",
    background: "transparent",
    color: "#fff",
    fontFamily: "inherit",
    padding: "clamp(24px, 6vh, 56px) clamp(10px, 3vw, 18px)",
    boxSizing: "border-box",
  };

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 420,
    boxSizing: "border-box",
  };

  if (checkingAuth || !user) {
    return <main style={{ minHeight: "100dvh", background: "transparent" }} />;
  }

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <CompleteProfilePanel
          {...onboarding.panel}
          onSubmit={(e) => onboarding.submit(e, () => router.replace(nextPath))}
          onCancel={async () => {
            await signOut(auth);
            router.replace("/login");
          }}
        />
      </div>
    </main>
  );
}
