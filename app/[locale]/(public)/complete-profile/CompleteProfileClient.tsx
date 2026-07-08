"use client";

import Image from "next/image";
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

const vibraPink = "#ff2fb3";
const vibraPurple = "#a855ff";
const vibraBlue = "#4f46ff";

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

  const fontStack =
    'inherit';

  const pageStyle: React.CSSProperties = {
    minHeight: "100dvh",
    display: "grid",
    placeItems: "center",
    background: "transparent",
    color: "#fff",
    fontFamily: fontStack,
    padding: 18,
    boxSizing: "border-box",
  };

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 420,
    padding: "28px 34px 34px",
    borderRadius: 18,
    border: "1px solid rgba(168, 85, 255, 0.58)",
    background: "rgba(10, 7, 28, 0.34)",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 28px rgba(168,85,255,0.18)",
    backdropFilter: "blur(16px) saturate(120%)", WebkitBackdropFilter: "blur(16px) saturate(120%)",
    boxSizing: "border-box",
  };

  const logoStyle: React.CSSProperties = {
    width: 142,
    height: "auto",
    display: "block",
    margin: "-15px auto 1px auto",
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 21,
    fontWeight: 650,
    letterSpacing: "-0.03em",
    lineHeight: 1.1,
    textAlign: "center",
  };

  const subtitleStyle: React.CSSProperties = {
    margin: "7px 0 24px",
    fontSize: 12,
    color: "rgba(255,255,255,0.66)",
    lineHeight: 1.4,
    textAlign: "center",
  };

  const labelTextStyle: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 500,
    color: "rgba(255,255,255,0.88)",
    lineHeight: 1.15,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 40,
    padding: "0 11px",
    borderRadius: 8,
    border: "1px solid rgba(168,85,255,0.22)",
    background: "rgba(255,255,255,0.035)",
    color: "#fff",
    outline: "none",
    fontSize: 12.5,
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
  };

  const primaryButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 40,
    padding: "8px 14px",
    borderRadius: 10,
    border: "none",
    backgroundImage: `linear-gradient(100deg, ${vibraPink} 0%, ${vibraPurple} 35%, ${vibraBlue} 70%, ${vibraPink} 100%)`,
    backgroundSize: "280% 280%",
    backgroundPosition: "0% 50%",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    fontFamily: fontStack,
    cursor: "pointer",
    boxShadow: "0 10px 28px rgba(168,85,255,0.22)",
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    background: "rgba(255,255,255,0.08)",
    boxShadow: "none",
  };

  const noticeStyle: React.CSSProperties = {
    marginTop: 10,
    borderRadius: 9,
    border: "1px solid rgba(255, 80, 80, 0.45)",
    background: "rgba(255, 40, 40, 0.10)",
    padding: "7px 9px",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "rgba(255, 190, 190, 0.95)",
  };

  if (checkingAuth) {
    return <main style={pageStyle} />;
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

        .completeProfileInput::placeholder {
          color: rgba(255, 255, 255, 0.36);
        }
      `}</style>

      <main style={pageStyle}>
        <div style={shellStyle}>
          <Image src="/logotipo.png" alt="Vibra" width={142} height={40} style={logoStyle} />

          <h1 style={titleStyle}>{t("title")}</h1>
          <p style={subtitleStyle}>
            {t("subtitle")}
          </p>

          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 13 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>{t("usernameLabel")}</span>
              <input
                className="completeProfileInput"
                value={handle}
                onChange={(e) => setHandle(normalizeHandle(e.target.value))}
                style={inputStyle}
                placeholder={t("usernamePlaceholder")}
                autoComplete="username"
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>{t("firstNameLabel")}</span>
                <input
                  className="completeProfileInput"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  style={inputStyle}
                  placeholder={t("firstNamePlaceholder")}
                  autoComplete="given-name"
                />
              </label>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>{t("lastNameLabel")}</span>
                <input
                  className="completeProfileInput"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  style={inputStyle}
                  placeholder={t("lastNamePlaceholder")}
                  autoComplete="family-name"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                ...primaryButtonStyle,
                marginTop: 4,
                opacity: loading ? 0.84 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? t("submitting") : t("submit")}
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={handleCancel}
              style={{
                ...secondaryButtonStyle,
                opacity: loading ? 0.6 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {t("cancel")}
            </button>
          </form>

          {msg && <div style={noticeStyle}>{msg}</div>}
        </div>
      </main>
    </>
  );
}