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
    pageMaxWidth: 980,
    coverHeight: "clamp(180px, 34vw, 280px)",
    avatarSize: "clamp(110px, 22vw, 210px)",
    avatarOffsetTop: "clamp(-56px, -9vw, -78px)",
    contentTopPadding: "clamp(78px, 14vw, 170px)",
    cardRadius: 16,
    buttonRadius: 10,
    buttonPadding: "10px 14px",
    borderSoft: "1px solid rgba(255,255,255,0.14)",
    shadow: "0 18px 48px rgba(0,0,0,0.55)",
  };

  const styles = {
    card: {
      borderRadius: ui.cardRadius,
      border: ui.borderSoft,
      background: "rgba(12,12,12,0.92)",
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
      fontSize: 14,
      fontFamily: fontStack,
      lineHeight: 1.2,
      minHeight: 42,
    } as React.CSSProperties,
    buttonSecondary: {
      padding: ui.buttonPadding,
      borderRadius: ui.buttonRadius,
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(255,255,255,0.07)",
      color: "#fff",
      cursor: "pointer",
      fontWeight: 600,
      fontSize: 14,
      fontFamily: fontStack,
      lineHeight: 1.2,
      minHeight: 42,
    } as React.CSSProperties,
    label: {
      fontSize: 12,
      fontWeight: 500,
      color: "rgba(255,255,255,0.90)",
    } as React.CSSProperties,
    message: {
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      fontSize: 12,
      lineHeight: 1.45,
    } as React.CSSProperties,
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setViewer(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  async function loadProfile() {
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

      const u = usnap.data() as UserDoc;
      setUserDoc(u);
    } catch (e: any) {
      setMsg(e?.message ?? "Error cargando perfil");
      setUserDoc(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!handle) return;
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

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

      const url = await getDownloadURL(fileRef);
      const uref = doc(db, "users", uid);

      if (mode === "avatar") {
        await updateDoc(uref, { photoURL: url });
        setUserDoc((prev) => (prev ? { ...prev, photoURL: url } : prev));
        setMsg("✅ Foto de perfil actualizada.");
      } else {
        await updateDoc(uref, { coverUrl: url });
        setUserDoc((prev) => (prev ? { ...prev, coverUrl: url } : prev));
        setMsg("✅ Foto de portada actualizada.");
      }

      setCropOpen(false);
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
          padding: "clamp(16px, 3vw, 24px) 14px 96px",
          fontFamily: fontStack,
        }}
      >
        <div style={{ maxWidth: ui.pageMaxWidth, margin: "0 auto" }}>
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
          padding: "clamp(16px, 3vw, 24px) 14px 96px",
          fontFamily: fontStack,
        }}
      >
        <div style={{ maxWidth: ui.pageMaxWidth, margin: "0 auto" }}>
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

  const coverBg =
    userDoc.coverUrl || `data:image/svg+xml;base64,${btoa(coverSvg)}`;

  return (
    <>
      <main
        style={{
          minHeight: "calc(100dvh - 70px)",
          padding: "clamp(16px, 3vw, 24px) 14px 120px",
          background: "#000",
          color: "#fff",
          fontFamily: fontStack,
        }}
      >
        <style jsx>{`
          .profile-shell {
            max-width: ${ui.pageMaxWidth}px;
            margin: 0 auto;
          }

          .profile-content {
            position: relative;
            padding: 0 clamp(14px, 3vw, 22px) clamp(18px, 3vw, 24px);
          }

          .profile-meta {
            display: grid;
            place-items: center;
            text-align: center;
          }

          .profile-stats {
            margin-top: 18px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 14px;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .profile-stat-card {
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.03);
            border-radius: 12px;
            padding: 12px;
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
            font-size: clamp(14px, 2vw, 16px);
            font-weight: 600;
            line-height: 1.2;
            word-break: break-word;
          }

          .crop-actions {
            margin-top: 12px;
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
          }

          .crop-buttons {
            margin-left: auto;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
          }

          @media (max-width: 640px) {
            .profile-stats {
              grid-template-columns: 1fr;
            }

            .crop-actions {
              align-items: stretch;
            }

            .crop-buttons {
              margin-left: 0;
              width: 100%;
            }

            .crop-buttons :global(button) {
              flex: 1 1 0;
            }
          }
        `}</style>

        <div className="profile-shell">
          <div
            style={{
              ...styles.card,
              overflow: "hidden",
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
                src={coverBg}
                alt="cover"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  filter: "contrast(1.05) saturate(1.05)",
                  opacity: 0.95,
                }}
              />

              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.48) 58%, rgba(0,0,0,0.88) 100%)",
                }}
              />

              {isOwner && (
                <button
                  onClick={handlePickCover}
                  disabled={uploading}
                  type="button"
                  style={{
                    position: "absolute",
                    right: 12,
                    top: 12,
                    ...styles.buttonSecondary,
                    background: uploading
                      ? "rgba(255,255,255,0.12)"
                      : "rgba(12,12,12,0.72)",
                    cursor: uploading ? "not-allowed" : "pointer",
                    zIndex: 3,
                    backdropFilter: "blur(8px)",
                    padding: "8px 12px",
                    minHeight: 38,
                    fontSize: 13,
                  }}
                  title="Cambiar portada"
                >
                  {uploading && cropMode === "cover"
                    ? "Subiendo..."
                    : "Cambiar portada"}
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
                  zIndex: 50,
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
                      border: "4px solid rgba(0,0,0,0.94)",
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
                    {userDoc.photoURL ? (
                      <img
                        src={userDoc.photoURL}
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
                          color: "rgba(255,255,255,0.9)",
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
                        width: "clamp(38px, 8vw, 46px)",
                        height: "clamp(38px, 8vw, 46px)",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: uploading
                          ? "rgba(255,255,255,0.14)"
                          : "rgba(12,12,12,0.9)",
                        color: "#fff",
                        cursor: uploading ? "not-allowed" : "pointer",
                        fontSize: 16,
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
                  <div
                    style={{
                      fontSize: "clamp(20px, 3vw, 28px)",
                      fontWeight: 700,
                      lineHeight: 1.1,
                      letterSpacing: "-0.02em",
                      maxWidth: 620,
                    }}
                  >
                    {fullName}
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      color: "rgba(255,255,255,0.74)",
                      fontWeight: 500,
                      fontSize: "clamp(14px, 2vw, 16px)",
                    }}
                  >
                    @{userDoc.handle}
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 12,
                      color: "rgba(255,255,255,0.55)",
                    }}
                  >
                    Perfil público
                  </div>
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
                  }}
                >
                  Sesión activa: {viewer.email}
                </p>
              )}
            </div>
          </div>

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
              width: "min(680px, 92vw)",
              ...styles.card,
              overflow: "hidden",
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
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 600, color: "#fff", fontSize: 16 }}>
                {cropMode === "avatar"
                  ? "Recortar foto de perfil"
                  : "Recortar portada"}
              </div>

              <button
                type="button"
                onClick={() => !uploading && setCropOpen(false)}
                style={{
                  ...styles.buttonSecondary,
                  cursor: uploading ? "not-allowed" : "pointer",
                  opacity: uploading ? 0.6 : 1,
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

              <div className="crop-actions">
                <label style={{ ...styles.label }}>Zoom</label>

                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  style={{ width: 200, maxWidth: "100%" }}
                />

                <div className="crop-buttons">
                  <button
                    type="button"
                    onClick={() => !uploading && setCropOpen(false)}
                    style={{
                      ...styles.buttonSecondary,
                      cursor: uploading ? "not-allowed" : "pointer",
                      opacity: uploading ? 0.6 : 1,
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
                      background: uploading ? "rgba(255,255,255,0.15)" : "#ffffff",
                      color: uploading ? "#fff" : "#000",
                      cursor: uploading ? "not-allowed" : "pointer",
                    }}
                  >
                    {uploading ? "Subiendo..." : "Guardar"}
                  </button>
                </div>
              </div>

              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: "rgba(255,255,255,0.55)",
                  lineHeight: 1.45,
                }}
              >
                Tip: mueve la imagen para encuadrar.{" "}
                {cropMode === "avatar" ? "Avatar 1:1" : "Portada 16:9"}.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}