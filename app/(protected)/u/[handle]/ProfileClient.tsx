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
  age: number;
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

  const ui = {
    pageMaxWidth: 860,
    coverHeight: 210,
    avatarSize: 210,
    avatarOffsetTop: -66,
    contentTopPadding: 160,
    cardRadius: 14,
    buttonRadius: 9,
    buttonPadding: "8px 12px",
    fontTitle: 18,
    fontBody: 13,
    fontMicro: 12,
    borderSoft: "1px solid rgba(255,255,255,0.18)",
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
      fontSize: ui.fontBody,
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
      fontSize: ui.fontBody,
      fontFamily: fontStack,
      lineHeight: 1.2,
    } as React.CSSProperties,
    label: {
      fontSize: ui.fontMicro,
      fontWeight: 500,
      color: "rgba(255,255,255,0.90)",
    } as React.CSSProperties,
    message: {
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      fontSize: ui.fontMicro,
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
    if (!userDoc) return;
    if (!isOwner) return;

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
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
          padding: "20px 14px 120px",
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
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
          padding: "20px 14px 120px",
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
    userDoc.displayName ||
    `${userDoc.firstName} ${userDoc.lastName}`.trim();

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
          minHeight: "calc(100vh - 70px)",
          padding: "20px 14px 140px",
          background: "#000",
          color: "#fff",
          fontFamily: fontStack,
        }}
      >
        <div
          style={{
            maxWidth: ui.pageMaxWidth,
            margin: "0 auto",
          }}
        >
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
                    "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.70) 82%, rgba(0,0,0,0.90) 100%)",
                }}
              />

              {isOwner && (
                <button
                  onClick={handlePickCover}
                  disabled={uploading}
                  type="button"
                  style={{
                    position: "absolute",
                    right: 14,
                    top: 14,
                    ...styles.buttonSecondary,
                    background: uploading
                      ? "rgba(255,255,255,0.12)"
                      : "rgba(12,12,12,0.72)",
                    cursor: uploading ? "not-allowed" : "pointer",
                    zIndex: 3,
                    backdropFilter: "blur(8px)",
                  }}
                  title="Cambiar portada"
                >
                  {uploading && cropMode === "cover"
                    ? "Subiendo..."
                    : "Cambiar portada"}
                </button>
              )}
            </div>

            <div style={{ position: "relative", padding: "0 18px 18px" }}>
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
                      border: "4px solid rgba(0,0,0,0.9)",
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
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <span
                        style={{
                          fontSize: 28,
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
                        right: 10,
                        bottom: 10,
                        width: 44,
                        height: 44,
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
                <div
                  style={{
                    display: "grid",
                    placeItems: "center",
                    textAlign: "center",
                    pointerEvents: "none",
                  }}
                >
                  <div
                    style={{
                      fontSize: ui.fontTitle,
                      fontWeight: 600,
                      lineHeight: 1.15,
                      letterSpacing: 0,
                    }}
                  >
                    {fullName}
                  </div>

                  <div
                    style={{
                      marginTop: 6,
                      color: "rgba(255,255,255,0.72)",
                      fontWeight: 500,
                      fontSize: ui.fontBody,
                    }}
                  >
                    @{userDoc.handle}
                  </div>

                  <div
                    style={{
                      marginTop: 8,
                      fontSize: ui.fontMicro,
                      color: "rgba(255,255,255,0.55)",
                    }}
                  >
                    Perfil público
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 16,
                  borderTop: "1px solid rgba(255,255,255,0.10)",
                  paddingTop: 14,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ color: "rgba(255,255,255,0.65)", fontSize: ui.fontBody }}>
                    Edad
                  </span>
                  <b style={{ color: "#fff", fontSize: ui.fontBody }}>{userDoc.age}</b>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ color: "rgba(255,255,255,0.65)", fontSize: ui.fontBody }}>
                    Sexo
                  </span>
                  <b style={{ color: "#fff", fontSize: ui.fontBody }}>{userDoc.sex}</b>
                </div>

                {msg && (
                  <div
                    style={{
                      ...styles.message,
                      marginTop: 6,
                    }}
                  >
                    {msg}
                  </div>
                )}

                {authReady && viewer && (
                  <p
                    style={{
                      marginTop: 8,
                      marginBottom: 0,
                      opacity: 0.6,
                      fontSize: ui.fontMicro,
                    }}
                  >
                    Sesión activa: {viewer.email}
                  </p>
                )}
              </div>
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

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <label style={{ ...styles.label }}>Zoom</label>

                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  style={{ width: 200 }}
                />

                <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
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
                  fontSize: ui.fontMicro,
                  color: "rgba(255,255,255,0.55)",
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