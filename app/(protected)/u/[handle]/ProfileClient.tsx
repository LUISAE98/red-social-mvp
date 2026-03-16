"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

import {
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
  collection,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { onAuthStateChanged } from "firebase/auth";

import Cropper from "react-easy-crop";

import { auth, db, storage } from "@/lib/firebase";
import ProfilePostsFeed from "./components/ProfilePostsFeed";

type UserDoc = {
  uid: string;
  handle: string;
  displayName: string;
  firstName: string;
  lastName: string;
  age?: number;
  birthDate?: string;
  sex: string;
  photoURL: string | null;
  coverUrl?: string | null;
  showPosts?: boolean;
  profileGreeting?: {
    enabled: boolean;
    price: number | null;
    currency: "MXN" | "USD" | null;
  };
};

type CropMode = "avatar" | "cover";
type Area = { x: number; y: number; width: number; height: number };

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function dataUrlFromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = (e) => reject(e);
    r.readAsDataURL(file);
  });
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", (e) => reject(e));
    img.setAttribute("crossOrigin", "anonymous");
    img.src = url;
  });
}

async function getCroppedBlob(
  imageSrc: string,
  pixelCrop: Area,
  mime = "image/jpeg"
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo inicializar canvas");

  const safeX = clamp(pixelCrop.x, 0, image.width);
  const safeY = clamp(pixelCrop.y, 0, image.height);
  const safeW = clamp(pixelCrop.width, 1, image.width - safeX);
  const safeH = clamp(pixelCrop.height, 1, image.height - safeY);

  canvas.width = Math.floor(safeW);
  canvas.height = Math.floor(safeH);

  ctx.drawImage(
    image,
    safeX,
    safeY,
    safeW,
    safeH,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("No se pudo generar blob"));
        resolve(blob);
      },
      mime,
      0.9
    );
  });
}

function calculateAgeFromBirthDate(birthDate?: string) {
  if (!birthDate) return null;

  const [y, m, d] = birthDate.split("-").map(Number);
  if (!y || !m || !d) return null;

  const today = new Date();
  let age = today.getFullYear() - y;
  const monthDiff = today.getMonth() + 1 - m;
  const dayDiff = today.getDate() - d;

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

function sexLabel(sex: string) {
  if (sex === "male") return "Hombre";
  if (sex === "female") return "Mujer";
  if (sex === "other") return "Otro";
  if (sex === "prefer_not_say") return "Prefiero no decir";
  return sex || "No disponible";
}

export default function ProfileClient() {
  const params = useParams<{ handle: string }>();
  const handle = useMemo(
    () => String(params?.handle || "").toLowerCase(),
    [params]
  );

  const [viewer, setViewer] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);

  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [avatarRenderUrl, setAvatarRenderUrl] = useState<string | null>(null);
  const [coverRenderUrl, setCoverRenderUrl] = useState<string | null>(null);

  const isOwner = !!viewer && !!userDoc && viewer.uid === userDoc.uid;

  const [cropOpen, setCropOpen] = useState(false);
  const [cropMode, setCropMode] = useState<CropMode>("avatar");
  const [cropImageSrc, setCropImageSrc] = useState<string>("");

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const cropAspect = cropMode === "avatar" ? 1 / 1 : 16 / 9;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const ageToShow = useMemo(() => {
    if (!userDoc) return null;
    if (typeof userDoc.age === "number") return userDoc.age;
    return calculateAgeFromBirthDate(userDoc.birthDate);
  }, [userDoc]);

  const ui = {
    pageMaxWidth: 1080,
    coverHeight: "clamp(190px, 35vw, 300px)",
    avatarSize: "clamp(112px, 24vw, 220px)",
    avatarOffsetTop: "clamp(-58px, -9vw, -82px)",
    contentTopPadding: "clamp(82px, 14vw, 176px)",
    cardRadius: 18,
    panelRadius: 14,
    buttonRadius: 10,
    buttonPadding: "10px 14px",
    modalMaxWidth: 680,
    title: 18,
    subtitle: 16,
    body: 14,
    micro: 12,
    label: 12,
    shadow: "0 18px 48px rgba(0,0,0,0.55)",
    borderSoft: "1px solid rgba(255,255,255,0.16)",
    borderFaint: "1px solid rgba(255,255,255,0.10)",
    cardBg: "rgba(12,12,12,0.92)",
    panelBg: "rgba(255,255,255,0.03)",
  };

  const styles = {
    card: {
      borderRadius: ui.cardRadius,
      border: ui.borderSoft,
      background: ui.cardBg,
      boxShadow: ui.shadow,
      backdropFilter: "blur(10px)",
    } as React.CSSProperties,
    buttonPrimary: {
      padding: ui.buttonPadding,
      borderRadius: ui.buttonRadius,
      border: "1px solid rgba(255,255,255,0.24)",
      background: "#fff",
      color: "#000",
      cursor: "pointer",
      fontWeight: 600,
      fontSize: ui.body,
      fontFamily: fontStack,
      lineHeight: 1.2,
    } as React.CSSProperties,
    buttonSecondary: {
      padding: ui.buttonPadding,
      borderRadius: ui.buttonRadius,
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(255,255,255,0.07)",
      color: "#fff",
      cursor: "pointer",
      fontWeight: 600,
      fontSize: ui.body,
      fontFamily: fontStack,
      lineHeight: 1.2,
      backdropFilter: "blur(8px)",
    } as React.CSSProperties,
    tinyGhostButton: {
      padding: "7px 10px",
      borderRadius: ui.buttonRadius,
      border: "1px solid rgba(255,255,255,0.16)",
      background: "rgba(12,12,12,0.88)",
      color: "#fff",
      fontWeight: 600,
      fontSize: ui.micro,
      lineHeight: 1.2,
      cursor: "pointer",
      fontFamily: fontStack,
      backdropFilter: "blur(10px)",
      boxShadow: ui.shadow,
    } as React.CSSProperties,
    label: {
      fontSize: ui.label,
      fontWeight: 500,
      lineHeight: 1.3,
      color: "#fff",
    } as React.CSSProperties,
    message: {
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      fontSize: ui.micro,
      lineHeight: 1.45,
    } as React.CSSProperties,
    title: {
      fontSize: ui.title,
      fontWeight: 600,
      lineHeight: 1.16,
      color: "#fff",
      letterSpacing: 0,
    } as React.CSSProperties,
    subtitle: {
      fontSize: ui.subtitle,
      fontWeight: 600,
      lineHeight: 1.2,
      color: "#fff",
      letterSpacing: 0,
    } as React.CSSProperties,
    microText: {
      fontSize: ui.micro,
      fontWeight: 400,
      lineHeight: 1.4,
      color: "rgba(255,255,255,0.70)",
    } as React.CSSProperties,
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setViewer(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    try {
      const hq = query(
        collection(db, "handles"),
        where("__name__", "==", handle),
        limit(1)
      );
      const hs = await getDocs(hq);

      if (hs.empty) {
        setUserDoc(null);
        setMsg("No existe este usuario.");
        return;
      }

      const hdata = hs.docs[0].data() as any;
      const uid = hdata?.uid as string;

      if (!uid) {
        setUserDoc(null);
        setMsg("Handle inválido.");
        return;
      }

      const uref = doc(db, "users", uid);
      const usnap = await getDoc(uref);

      if (!usnap.exists()) {
        setUserDoc(null);
        setMsg("Perfil no encontrado.");
        return;
      }

      setUserDoc({
        uid,
        ...(usnap.data() as Omit<UserDoc, "uid">),
      });
    } catch (e: any) {
      setMsg(e?.message ?? "Error cargando perfil");
      setUserDoc(null);
    } finally {
      setLoading(false);
    }
  }, [handle]);

  useEffect(() => {
    if (!handle) return;
    loadProfile();
  }, [handle, loadProfile]);

  useEffect(() => {
    setAvatarRenderUrl(userDoc?.photoURL ?? null);
    setCoverRenderUrl(userDoc?.coverUrl ?? null);
  }, [userDoc?.photoURL, userDoc?.coverUrl]);

  const openCropWithFile = useCallback(
    async (mode: CropMode, file: File) => {
      if (!isOwner) return;

      setMsg(null);

      const src = await dataUrlFromFile(file);
      setCropMode(mode);
      setCropImageSrc(src);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setCropOpen(true);
    },
    [isOwner]
  );

  function handlePickAvatar() {
    if (!isOwner) return;
    avatarInputRef.current?.click();
  }

  function handlePickCover() {
    if (!isOwner) return;
    coverInputRef.current?.click();
  }

  const onCropComplete = useCallback(
    (_croppedArea: any, croppedAreaPixelsArg: any) => {
      setCroppedAreaPixels(croppedAreaPixelsArg as Area);
    },
    []
  );

  async function uploadCropped(mode: CropMode) {
    if (!userDoc || !isOwner) return;

    if (!cropImageSrc || !croppedAreaPixels) {
      setMsg("❌ No se pudo recortar la imagen.");
      return;
    }

    setUploading(true);
    setMsg(null);

    try {
      const uid = userDoc.uid;

      const blob = await getCroppedBlob(
        cropImageSrc,
        croppedAreaPixels,
        "image/jpeg"
      );

      const path =
        mode === "avatar"
          ? `users/${uid}/avatar/avatar.jpg`
          : `users/${uid}/cover/cover.jpg`;

      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });

      const rawUrl = await getDownloadURL(fileRef);
      const freshUrl = `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;

      const uref = doc(db, "users", uid);

      if (mode === "avatar") {
        setAvatarRenderUrl(freshUrl);
        setUserDoc((prev) => (prev ? { ...prev, photoURL: freshUrl } : prev));
        await updateDoc(uref, { photoURL: freshUrl });
        setMsg("✅ Foto de perfil actualizada.");
      } else {
        setCoverRenderUrl(freshUrl);
        setUserDoc((prev) => (prev ? { ...prev, coverUrl: freshUrl } : prev));
        await updateDoc(uref, { coverUrl: freshUrl });
        setMsg("✅ Foto de portada actualizada.");
      }

      setCropOpen(false);
      setCropImageSrc("");
      setCroppedAreaPixels(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);

      await loadProfile();
    } catch (e: any) {
      setMsg(
        e?.code === "permission-denied"
          ? "❌ Permiso denegado. Revisa reglas de Storage/Firestore."
          : `❌ No se pudo subir la imagen: ${e?.message ?? "error"}`
      );
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          background: "#000",
          color: "#fff",
          padding: "12px 0 calc(108px + env(safe-area-inset-bottom))",
          fontFamily: fontStack,
        }}
      >
        <div style={{ maxWidth: ui.pageMaxWidth, margin: "0 auto", padding: "0 12px" }}>
          Cargando perfil...
        </div>
      </main>
    );
  }

  if (!userDoc) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          background: "#000",
          color: "#fff",
          padding: "12px 0 calc(108px + env(safe-area-inset-bottom))",
          fontFamily: fontStack,
        }}
      >
        <div style={{ maxWidth: ui.pageMaxWidth, margin: "0 auto", padding: "0 12px" }}>
          {msg ?? "Perfil no disponible"}
        </div>
      </main>
    );
  }

  const fullName =
    userDoc.displayName || `${userDoc.firstName} ${userDoc.lastName}`.trim();

  const coverSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#0b0b0b"/>
      <stop offset="1" stop-color="#1a1a1a"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="600" fill="url(#g)"/>
  <circle cx="1250" cy="170" r="180" fill="#141414"/>
  <circle cx="1350" cy="250" r="210" fill="#101010"/>
</svg>`.trim();

  const fallbackCoverBg = `data:image/svg+xml;base64,${btoa(coverSvg)}`;
  const coverSrc = coverRenderUrl || userDoc.coverUrl || fallbackCoverBg;
  const avatarSrc = avatarRenderUrl || userDoc.photoURL || "";

  return (
    <>
      <main
        style={{
          minHeight: "calc(100dvh - 70px)",
          padding: "12px 0 calc(120px + env(safe-area-inset-bottom))",
          background: "#000",
          color: "#fff",
          fontFamily: fontStack,
        }}
      >
        <style jsx>{`
          .profile-shell {
            width: 100%;
            max-width: ${ui.pageMaxWidth}px;
            margin: 0 auto;
            padding: 0 12px;
            box-sizing: border-box;
          }

          .profile-card {
            overflow: hidden;
          }

          .profile-content {
            position: relative;
            padding: 0 18px 20px;
          }

          .profile-meta {
            display: grid;
            place-items: center;
            text-align: center;
          }

          .profile-handle {
            margin-top: 8px;
            color: rgba(255, 255, 255, 0.74);
            font-weight: 500;
            font-size: 15px;
            line-height: 1.2;
            word-break: break-word;
          }

          .profile-visibility {
            margin-top: 10px;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.55);
            line-height: 1.3;
          }

          .profile-stats {
            margin-top: 18px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 14px;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }

          .profile-stat-card {
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.03);
            border-radius: 14px;
            padding: 14px;
            min-width: 0;
          }

          .profile-stat-label {
            color: rgba(255, 255, 255, 0.6);
            font-size: 12px;
            line-height: 1.2;
          }

          .profile-stat-value {
            margin-top: 6px;
            color: #fff;
            font-size: clamp(15px, 2vw, 16px);
            font-weight: 600;
            line-height: 1.25;
            word-break: break-word;
          }

          @media (max-width: 900px) {
            .profile-shell {
              max-width: none;
              padding: 0 8px;
            }
          }

          @media (max-width: 640px) {
            .profile-shell {
              padding: 0 6px;
            }

            .profile-card {
              border-radius: 18px !important;
            }

            .profile-content {
              padding: 0 12px 18px;
            }

            .profile-stats {
              grid-template-columns: 1fr;
              gap: 10px;
            }

            .profile-stat-card {
              padding: 13px;
            }

            .profile-handle {
              font-size: 14px;
            }
          }
        `}</style>

        <div className="profile-shell">
          <div
            className="profile-card"
            style={{
              ...styles.card,
            }}
          >
            <div
              style={{
                position: "relative",
                height: ui.coverHeight,
                background: "#0b0b0b",
              }}
            >
              <img
                key={coverSrc}
                src={coverSrc}
                alt="cover"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  opacity: 0.96,
                }}
              />

              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.52) 58%, rgba(0,0,0,0.88) 100%)",
                }}
              />

              {isOwner && (
                <button
                  onClick={handlePickCover}
                  disabled={uploading}
                  type="button"
                  style={{
                    ...styles.tinyGhostButton,
                    position: "absolute",
                    right: 12,
                    top: 12,
                    opacity: uploading ? 0.7 : 1,
                    cursor: uploading ? "not-allowed" : "pointer",
                    zIndex: 3,
                  }}
                  title="Elegir portada"
                >
                  {uploading && cropMode === "cover"
                    ? "Subiendo..."
                    : "Elegir portada"}
                </button>
              )}
            </div>

            <div className="profile-content">
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: ui.avatarOffsetTop,
                  transform: "translateX(-50%)",
                  zIndex: 20,
                }}
              >
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handlePickAvatar();
                    }}
                    disabled={!isOwner || uploading}
                    style={{
                      width: ui.avatarSize,
                      height: ui.avatarSize,
                      borderRadius: "50%",
                      overflow: "hidden",
                      border: "4px solid rgba(0,0,0,0.96)",
                      boxShadow: ui.shadow,
                      display: "grid",
                      placeItems: "center",
                      background: "#0c0c0c",
                      userSelect: "none",
                      padding: 0,
                      margin: 0,
                      cursor: !isOwner || uploading ? "default" : "pointer",
                      pointerEvents: isOwner ? "auto" : "none",
                    }}
                    aria-label="Cambiar foto de perfil"
                    title={isOwner ? "Cambiar foto de perfil" : undefined}
                  >
                    {avatarSrc ? (
                      <img
                        key={avatarSrc}
                        src={avatarSrc}
                        alt="avatar"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          fontSize: "clamp(24px, 5vw, 34px)",
                          fontWeight: 600,
                          color: "rgba(255,255,255,0.88)",
                          fontFamily: fontStack,
                        }}
                      >
                        {initials(fullName)}
                      </span>
                    )}
                  </button>

                  {isOwner && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handlePickAvatar();
                      }}
                      disabled={uploading}
                      style={{
                        position: "absolute",
                        right: 8,
                        bottom: 8,
                        width: 34,
                        height: 34,
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.16)",
                        background: "rgba(12,12,12,0.92)",
                        color: "#fff",
                        cursor: uploading ? "not-allowed" : "pointer",
                        fontSize: 13,
                        fontWeight: 600,
                        display: "grid",
                        placeItems: "center",
                        boxShadow: ui.shadow,
                        backdropFilter: "blur(10px)",
                        zIndex: 200,
                        pointerEvents: "auto",
                        fontFamily: fontStack,
                      }}
                      title="Cambiar foto de perfil"
                      aria-label="Cambiar foto de perfil"
                    >
                      {uploading && cropMode === "avatar" ? "..." : "✎"}
                    </button>
                  )}
                </div>
              </div>

              <div
                style={{
                  paddingTop: ui.contentTopPadding,
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <div className="profile-meta">
                  <h1 style={{ ...styles.title, margin: 0 }}>{fullName}</h1>

                  <div className="profile-handle">@{userDoc.handle}</div>

                  <div className="profile-visibility">Perfil público</div>
                </div>
              </div>

              <div className="profile-stats">
                <div className="profile-stat-card">
                  <div className="profile-stat-label">Edad</div>
                  <div className="profile-stat-value">
                    {ageToShow ?? "No disponible"}
                  </div>
                </div>

                <div className="profile-stat-card">
                  <div className="profile-stat-label">Sexo</div>
                  <div className="profile-stat-value">
                    {sexLabel(userDoc.sex)}
                  </div>
                </div>
              </div>

              {msg && (
                <div
                  style={{
                    ...styles.message,
                    marginTop: 12,
                  }}
                >
                  {msg}
                </div>
              )}

              {authReady && viewer && (
                <p
                  style={{
                    marginTop: 12,
                    marginBottom: 0,
                    opacity: 0.6,
                    fontSize: 12,
                    textAlign: "center",
                    wordBreak: "break-word",
                  }}
                >
                  Sesión activa: {viewer.email}
                </p>
              )}
            </div>
          </div>

          <ProfilePostsFeed
            profileUid={userDoc.uid}
            viewerUid={viewer?.uid ?? null}
            isOwner={isOwner}
            showPosts={userDoc.showPosts ?? true}
          />

          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await openCropWithFile("avatar", f);
              e.currentTarget.value = "";
            }}
          />

          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await openCropWithFile("cover", f);
              e.currentTarget.value = "";
            }}
          />
        </div>
      </main>

      {!cropOpen ? null : (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.72)",
            display: "grid",
            placeItems: "center",
            padding: 14,
            fontFamily: fontStack,
          }}
          onClick={() => {
            if (!uploading) setCropOpen(false);
          }}
        >
          <div
            style={{
              width: `min(${ui.modalMaxWidth}px, 92vw)`,
              background: ui.cardBg,
              border: ui.borderSoft,
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: ui.shadow,
              color: "#fff",
              backdropFilter: "blur(10px)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "10px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderBottom: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.06)",
              }}
            >
              <div style={styles.subtitle}>
                {cropMode === "avatar"
                  ? "Recortar foto de perfil"
                  : "Recortar portada"}
              </div>

              <button
                type="button"
                onClick={() => !uploading && setCropOpen(false)}
                style={{
                  ...styles.buttonSecondary,
                  opacity: uploading ? 0.6 : 1,
                  cursor: uploading ? "not-allowed" : "pointer",
                }}
              >
                Cerrar
              </button>
            </div>

            <div style={{ padding: 12 }}>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: cropMode === "avatar" ? 300 : 240,
                  background: "#050505",
                  borderRadius: 12,
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                <Cropper
                  image={cropImageSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={cropAspect}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                  cropShape={cropMode === "avatar" ? "round" : "rect"}
                  showGrid={cropMode !== "avatar"}
                />
              </div>

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <label style={styles.label}>Zoom</label>

                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  style={{ width: 200 }}
                />

                <div
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => !uploading && setCropOpen(false)}
                    style={{
                      ...styles.buttonSecondary,
                      opacity: uploading ? 0.6 : 1,
                      cursor: uploading ? "not-allowed" : "pointer",
                    }}
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    onClick={() => uploadCropped(cropMode)}
                    disabled={uploading}
                    style={{
                      ...styles.buttonPrimary,
                      background: uploading ? "rgba(255,255,255,0.15)" : "#fff",
                      color: uploading ? "#fff" : "#000",
                      opacity: uploading ? 0.8 : 1,
                      cursor: uploading ? "not-allowed" : "pointer",
                    }}
                  >
                    {uploading ? "Subiendo..." : "Guardar"}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 10, ...styles.microText }}>
                Tip: mueve la imagen para encuadrar.{" "}
                {cropMode === "avatar" ? "Avatar 1:1." : "Portada 16:9."}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}