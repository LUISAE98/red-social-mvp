//page.tsx

"use client";

import Image from "next/image";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import SafeCropper from "@/components/media/SafeCropper";
import { useAuth } from "@/app/providers";
import { createGroup } from "@/lib/groups/createGroup";
import type {
  CanonicalGroupCategory,
  Currency,
  GroupVisibility,
  PostingMode,
} from "@/types/group";
import {
  GROUP_CATEGORY_OPTIONS,
  normalizeGroupTags,
} from "@/types/group";

import { db } from "@/lib/firebase";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { uploadFile } from "@/lib/storage/uploadFile";
import { buildFileName } from "@/lib/storage/fileNaming";
import { buildCurrentPathWithSearch } from "@/lib/auth-redirect";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";


function parseTags(raw: string): string[] {
  return normalizeGroupTags(raw.split(","));
}

function extFromMime(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

const MAX_IMAGE_BYTES = 150 * 1024 * 1024;
const AVATAR_ASPECT = 1;
const COVER_ASPECT = 16 / 9;

type CropMode = "avatar" | "cover";
type Area = { x: number; y: number; width: number; height: number };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
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

  if (!ctx) throw new Error("No se pudo inicializar canvas.");

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
        if (!blob) {
          reject(new Error("No se pudo generar el recorte."));
          return;
        }
        resolve(blob);
      },
      mime,
      0.9
    );
  });
}

function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      style={{
        position: "relative",
        width: 44,
        height: 26,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.14)",
        background: checked ? "#ffffff" : "rgba(255,255,255,0.08)",
        transition: "all 0.18s ease",
        cursor: disabled ? "not-allowed" : "pointer",
        padding: 0,
        opacity: disabled ? 0.55 : 1,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 20 : 2,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: checked ? "#000" : "#fff",
          transition: "all 0.18s ease",
        }}
      />
    </button>
  );
}

function SelectField({
  value,
  onChange,
  children,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div style={{ position: "relative" }}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          borderRadius: 9,
          border: "1px solid rgba(255,255,255,0.14)",
          backgroundColor: "rgba(255,255,255,0.04)",
          color: "#ffffff",
          padding: "9px 36px 9px 11px",
          fontSize: 13,
          fontWeight: 400,
          outline: "none",
          appearance: "none",
          WebkitAppearance: "none",
          MozAppearance: "none",
          boxSizing: "border-box",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        {children}
      </select>

      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          right: 11,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          color: "rgba(255,255,255,0.68)",
          fontSize: 11,
        }}
      >
        ▼
      </span>
    </div>
  );
}

function NewGroupPageContent() {
const router = useRouter();
const pathname = usePathname();
const searchParams = useSearchParams();
const { user, loading: authLoading } = useAuth();

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

  const ui = {
    cardRadius: 14,
    buttonRadius: 9,
    buttonPadding: "8px 12px",
    fontBody: 13,
    fontMicro: 12,
    borderSoft: "1px solid rgba(255,255,255,0.18)",
    borderFaint: "1px solid rgba(255,255,255,0.12)",
    shadow: "0 18px 48px rgba(0,0,0,0.55)",
  };

  const styles = {
    card: {
      borderRadius: ui.cardRadius,
      border: ui.borderSoft,
      background: "rgba(12,12,12,0.92)",
      boxShadow: ui.shadow,
      backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
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
  };

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<GroupVisibility>("public");

  const [category, setCategory] = useState<CanonicalGroupCategory>("otros");
  const [tagsRaw, setTagsRaw] = useState("");

  const [greetingsEnabled, setGreetingsEnabled] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState("");

  const [ageMin, setAgeMin] = useState<string>("18");
  const [ageMax, setAgeMax] = useState<string>("99");

  const [postingMode, setPostingMode] = useState<PostingMode>("members");
  const [commentsEnabled, setCommentsEnabled] = useState(true);

  const [monetizationMode, setMonetizationMode] = useState<"free" | "paid">("free");
  const [priceMonthly, setPriceMonthly] = useState<string>("");
  const [currency, setCurrency] = useState<Currency>("MXN");

  const subscriptionAllowed = visibility !== "public";
  const isPaid = monetizationMode === "paid" && subscriptionAllowed;

  useEffect(() => {
    if (!subscriptionAllowed && monetizationMode === "paid") {
      setMonetizationMode("free");
      setPriceMonthly("");
    }
  }, [subscriptionAllowed, monetizationMode]);

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);

  const [pendingAvatarSrc, setPendingAvatarSrc] = useState<string | null>(null);
  const [pendingCoverSrc, setPendingCoverSrc] = useState<string | null>(null);

  const avatarPreview = useMemo(
    () => (avatarFile ? URL.createObjectURL(avatarFile) : null),
    [avatarFile]
  );
  const coverPreview = useMemo(
    () => (coverFile ? URL.createObjectURL(coverFile) : null),
    [coverFile]
  );

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      if (coverPreview) URL.revokeObjectURL(coverPreview);
      if (pendingAvatarSrc) URL.revokeObjectURL(pendingAvatarSrc);
      if (pendingCoverSrc) URL.revokeObjectURL(pendingCoverSrc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [avatarUploadPct, setAvatarUploadPct] = useState<number>(0);
  const [coverUploadPct, setCoverUploadPct] = useState<number>(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cropOpen, setCropOpen] = useState(false);
  const [cropMode, setCropMode] = useState<CropMode>("avatar");
  const [cropImageSrc, setCropImageSrc] = useState<string>("");

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [croppingBusy, setCroppingBusy] = useState(false);

  const cropAspect = cropMode === "avatar" ? AVATAR_ASPECT : COVER_ASPECT;

useEffect(() => {
  if (!authLoading && !user) {
    const nextPath = buildCurrentPathWithSearch(
      pathname || "/groups/new",
      searchParams
    );

    router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
  }
}, [authLoading, user, router, pathname, searchParams]);

async function onPickAvatar(file: File | null) {
  if (!file) return;

  try {
    const normalized = await normalizeImageFile(file, {
      maxSizeBytes: MAX_IMAGE_BYTES,
    });

    if (pendingAvatarSrc) URL.revokeObjectURL(pendingAvatarSrc);

    setError(null);
    const src = URL.createObjectURL(normalized.file);
    setPendingAvatarSrc(src);
    setCropMode("avatar");
    setCropImageSrc(src);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setCropOpen(true);
  } catch (e: unknown) {
    setError((e instanceof Error ? e.message : null) ?? "Avatar: no se pudo leer la imagen.");
  }
}

async function onPickCover(file: File | null) {
  if (!file) return;

  try {
    const normalized = await normalizeImageFile(file, {
      maxSizeBytes: MAX_IMAGE_BYTES,
    });

    if (pendingCoverSrc) URL.revokeObjectURL(pendingCoverSrc);

    setError(null);
    const src = URL.createObjectURL(normalized.file);
    setPendingCoverSrc(src);
    setCropMode("cover");
    setCropImageSrc(src);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setCropOpen(true);
  } catch (e: unknown) {
    setError((e instanceof Error ? e.message : null) ?? "Portada: no se pudo leer la imagen.");
  }
}

const onCropComplete = useCallback(
  (_croppedArea: unknown, croppedAreaPixelsArg: Area) => {
    setCroppedAreaPixels(croppedAreaPixelsArg);
  },
  []
);

  function closeCropModal() {
    if (croppingBusy) return;

    setCropOpen(false);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setCropImageSrc("");

    if (cropMode === "avatar") {
      if (pendingAvatarSrc) URL.revokeObjectURL(pendingAvatarSrc);
      setPendingAvatarSrc(null);
    } else {
      if (pendingCoverSrc) URL.revokeObjectURL(pendingCoverSrc);
      setPendingCoverSrc(null);
    }
  }

  async function confirmCrop() {
    if (!cropImageSrc || !croppedAreaPixels) {
      setError("No se pudo recortar la imagen.");
      return;
    }

    setCroppingBusy(true);
    setError(null);

    try {
      const blob = await getCroppedBlob(cropImageSrc, croppedAreaPixels, "image/jpeg");
      const ext = extFromMime("image/jpeg");

      if (cropMode === "avatar") {
        const file = new File([blob], `avatar.${ext}`, { type: "image/jpeg" });
        setAvatarFile(file);

        if (pendingAvatarSrc) URL.revokeObjectURL(pendingAvatarSrc);
        setPendingAvatarSrc(null);
      } else {
        const file = new File([blob], `cover.${ext}`, { type: "image/jpeg" });
        setCoverFile(file);

        if (pendingCoverSrc) URL.revokeObjectURL(pendingCoverSrc);
        setPendingCoverSrc(null);
      }

      setCropOpen(false);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setCropImageSrc("");
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : null) ?? "No se pudo recortar la imagen.");
    } finally {
      setCroppingBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!user) {
      setError("Debes iniciar sesión.");
      return;
    }

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();

    if (trimmedName.length < 3) {
      setError("El nombre debe tener al menos 3 caracteres.");
      return;
    }

    if (trimmedDesc.length < 10) {
      setError("La descripción debe tener al menos 10 caracteres.");
      return;
    }

    const ageMinNum = ageMin ? Number(ageMin) : null;
    const ageMaxNum = ageMax ? Number(ageMax) : null;

    if (
      ageMinNum != null &&
      (!Number.isFinite(ageMinNum) || ageMinNum < 18 || ageMinNum > 99)
    ) {
      setError("Edad mínima inválida (18–99).");
      return;
    }

    if (
      ageMaxNum != null &&
      (!Number.isFinite(ageMaxNum) || ageMaxNum < 18 || ageMaxNum > 99)
    ) {
      setError("Edad máxima inválida (18–99).");
      return;
    }

    if (ageMinNum != null && ageMaxNum != null && ageMinNum > ageMaxNum) {
      setError("Edad mínima no puede ser mayor que edad máxima.");
      return;
    }

    const priceNum = priceMonthly ? Number(priceMonthly) : null;
    if (isPaid) {
      if (priceNum == null || !(priceNum > 0) || !Number.isFinite(priceNum)) {
        setError("Precio mensual inválido.");
        return;
      }
    }

    setLoading(true);
    setAvatarUploadPct(0);
    setCoverUploadPct(0);

    try {
      const tags = parseTags(tagsRaw).slice(0, 10);

      const groupId = await createGroup({
        name: trimmedName,
        description: trimmedDesc,
        ownerId: user.uid,
        visibility,
        discoverable: visibility !== "hidden",
        category,
        tags,
        greetingsEnabled,
        welcomeMessage: greetingsEnabled ? welcomeMessage : null,
        ageMin: ageMinNum,
        ageMax: ageMaxNum,
        coverUrl: null,
        avatarUrl: null,
        permissions: {
          postingMode,
          commentsEnabled,
        },
        monetization: {
          isPaid,
          priceMonthly: isPaid ? priceNum : null,
          currency: isPaid ? currency : null,
          subscriptionsEnabled: isPaid,
          subscriptionPriceMonthly: isPaid ? priceNum : null,
          subscriptionCurrency: isPaid ? currency : null,
          paidPostsEnabled: false,
          paidLivesEnabled: false,
          paidVodEnabled: false,
          paidLiveCommentsEnabled: false,
          greetingsEnabled,
          adviceEnabled: false,
          customClassEnabled: false,
          digitalMeetGreetEnabled: false,
        },
        imageUrl: null,
        isActive: true,
      });

      let avatarUrl: string | null = null;
      let coverUrl: string | null = null;

      if (avatarFile) {
        try {
          const fileName = buildFileName(user.uid, avatarFile.name);
          const path = `groups/${groupId}/avatar/${fileName}`;

          avatarUrl = await uploadFile({
            file: avatarFile,
            path,
            onProgress: (p) => setAvatarUploadPct(Math.round(p)),
          });
        } catch (uploadErr: unknown) {
          throw new Error(
            `El grupo sí se creó, pero falló la subida del avatar: ${
              (uploadErr instanceof Error ? uploadErr.message : null) ?? "permiso insuficiente en Storage"
            }`
          );
        }
      }

      if (coverFile) {
        try {
          const fileName = buildFileName(user.uid, coverFile.name);
          const path = `groups/${groupId}/cover/${fileName}`;

          coverUrl = await uploadFile({
            file: coverFile,
            path,
            onProgress: (p) => setCoverUploadPct(Math.round(p)),
          });
        } catch (uploadErr: unknown) {
          throw new Error(
            `El grupo sí se creó, pero falló la subida de portada: ${
              (uploadErr instanceof Error ? uploadErr.message : null) ?? "permiso insuficiente en Storage"
            }`
          );
        }
      }

      if (avatarUrl || coverUrl) {
        try {
          const ref = doc(db, "groups", groupId);

          await updateDoc(ref, {
            ...(avatarUrl ? { avatarUrl } : {}),
            ...(coverUrl ? { coverUrl } : {}),
            updatedAt: serverTimestamp(),
          });
        } catch (updateErr: unknown) {
          throw new Error(
            `El grupo sí se creó y la imagen sí subió, pero falló actualizar avatar/portada en Firestore: ${
              (updateErr instanceof Error ? updateErr.message : null) ?? "permiso insuficiente en Firestore"
            }`
          );
        }
      }

      router.push(`/groups/${groupId}`);
    } catch (err: unknown) {
      console.error("CREATE_GROUP_ERROR", err);
      setError((err instanceof Error ? err.message : null) ?? "Error creando comunidad.");
    } finally {
      setLoading(false);
    }
  }

  if (authLoading || !user) {
    return (
      <div
        style={{
          minHeight: "60vh",
          padding: "20px 14px 120px",
          background: "#000",
          color: "#fff",
          fontFamily: fontStack,
        }}
      >
        <div
          style={{
            maxWidth: 588,
            margin: "0 auto",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(12,12,12,0.92)",
            boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
            padding: 18,
          }}
        >
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", margin: 0 }}>
            Cargando…
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
          fontFamily: fontStack,
          padding: "20px 14px 120px",
        }}
      >
        <style jsx>{`
          select,
          option,
          optgroup {
            background-color: #101010;
            color: #ffffff;
          }

          select:disabled {
            opacity: 0.55;
          }

          input[type="number"]::-webkit-outer-spin-button,
          input[type="number"]::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }

          input[type="number"] {
            -moz-appearance: textfield;
            appearance: textfield;
          }
        `}</style>

        <div style={{ maxWidth: 588, margin: "0 auto" }}>
          <div style={{ marginBottom: 14 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              Crear comunidad
            </h1>
            <p
              style={{
                margin: "6px 0 0 0",
                fontSize: 13,
                fontWeight: 400,
                color: "rgba(255,255,255,0.62)",
                lineHeight: 1.45,
              }}
            >
              Configura lo esencial de tu comunidad con estilo dark premium del MVP.
            </p>
          </div>

          {error && (
            <div
              style={{
                marginBottom: 14,
                borderRadius: 12,
                border: "1px solid rgba(255,120,120,0.25)",
                background: "rgba(255,90,90,0.10)",
                padding: "10px 12px",
                fontSize: 12,
                color: "rgba(255,220,220,0.95)",
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
            <section
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(12,12,12,0.92)",
                boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
                padding: 16,
                display: "grid",
                gap: 12,
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.92)",
                  }}
                >
                  Nombre
                </label>
                <input
                  style={{
                    width: "100%",
                    borderRadius: 9,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.04)",
                    color: "#fff",
                    padding: "9px 11px",
                    fontSize: 13,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Fans de Alfredo"
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.92)",
                  }}
                >
                  Descripción
                </label>
                <textarea
                  style={{
                    width: "100%",
                    borderRadius: 9,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.04)",
                    color: "#fff",
                    padding: "9px 11px",
                    fontSize: 13,
                    outline: "none",
                    minHeight: 110,
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe tu comunidad..."
                  rows={4}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.92)",
                  }}
                >
                  Visibilidad
                </label>
                <SelectField
                  value={visibility}
                  onChange={(value) => setVisibility(value as GroupVisibility)}
                >
                  <option value="public">Público</option>
                  <option value="private">Privado (requiere aprobación)</option>
                  <option value="hidden">Oculto (solo con link)</option>
                </SelectField>
              </div>
            </section>

            <section
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(12,12,12,0.92)",
                boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
                padding: 16,
                display: "grid",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Imágenes</h2>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.50)" }}>
                  Preview de cómo se verá tu comunidad
                </span>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    height: 270,
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  {coverPreview ? (
                    <Image
                      src={coverPreview}
                      alt="Portada"
                      width={1280}
                      height={210}
                      style={{ width: "100%", height: 210, objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: 210,
                        display: "grid",
                        placeItems: "center",
                        color: "rgba(255,255,255,0.28)",
                        fontSize: 12,
                        background:
                          "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                      }}
                    >
                      Portada de la comunidad
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      padding: "8px 12px",
                      borderRadius: 9,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(12,12,12,0.78)",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
                    }}
                  >
                    Elegir portada
                  </button>

                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: 140,
                      transform: "translateX(-50%)",
                      width: 132,
                      height: 132,
                      borderRadius: "50%",
                      border: "4px solid rgba(12,12,12,0.96)",
                      background: "rgba(255,255,255,0.05)",
                      overflow: "hidden",
                      boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
                    }}
                  >
                    {avatarPreview ? (
                      <Image
                        src={avatarPreview}
                        alt="Avatar"
                        fill
                        style={{ objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "grid",
                          placeItems: "center",
                          color: "rgba(255,255,255,0.28)",
                          fontSize: 12,
                        }}
                      >
                        Avatar
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      aria-label="Elegir avatar"
                      style={{
                        position: "absolute",
                        right: 6,
                        bottom: 6,
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: "rgba(12,12,12,0.88)",
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        padding: 0,
                      }}
                    >
                      ✎
                    </button>
                  </div>
                </div>

                <div style={{ padding: "18px 18px 16px 18px", textAlign: "center" }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 18,
                      fontWeight: 600,
                      color: "#fff",
                      lineHeight: 1.2,
                    }}
                  >
                    {name.trim() || "Nombre de la comunidad"}
                  </p>

                  <p
                    style={{
                      margin: "8px 0 0 0",
                      fontSize: 13,
                      color: "rgba(255,255,255,0.72)",
                      lineHeight: 1.45,
                    }}
                  >
                    {description.trim()
                      ? description.trim()
                      : "Aquí verás una vista previa de cómo lucirá tu comunidad al crearla."}
                  </p>

                  <p
                    style={{
                      margin: "10px 0 0 0",
                      fontSize: 12,
                      color: "rgba(255,255,255,0.56)",
                      lineHeight: 1.4,
                    }}
                  >
                    Vista previa de tu comunidad
                  </p>
                </div>
              </div>

              <input
                ref={avatarInputRef}
                type="file"
                style={{ display: "none" }}
                accept="image/*,.heic,.heif"
                onChange={(e) => {
                  onPickAvatar(e.target.files?.[0] ?? null);
                  e.currentTarget.value = "";
                }}
              />

              <input
                ref={coverInputRef}
                type="file"
                style={{ display: "none" }}
                accept="image/*,.heic,.heif"
                onChange={(e) => {
                  onPickCover(e.target.files?.[0] ?? null);
                  e.currentTarget.value = "";
                }}
              />

              {(avatarFile || coverFile) && (
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    flexWrap: "wrap",
                    justifyContent: "center",
                  }}
                >
                  {avatarFile && (
                    <button
                      type="button"
                      onClick={() => setAvatarFile(null)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "rgba(255,255,255,0.58)",
                        fontSize: 12,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Quitar avatar
                    </button>
                  )}

                  {coverFile && (
                    <button
                      type="button"
                      onClick={() => setCoverFile(null)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "rgba(255,255,255,0.58)",
                        fontSize: 12,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Quitar portada
                    </button>
                  )}
                </div>
              )}

              {loading && avatarFile && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "rgba(255,255,255,0.72)",
                    textAlign: "center",
                  }}
                >
                  Subiendo avatar: {avatarUploadPct}%
                </p>
              )}

              {loading && coverFile && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "rgba(255,255,255,0.72)",
                    textAlign: "center",
                  }}
                >
                  Subiendo portada: {coverUploadPct}%
                </p>
              )}

              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: "rgba(255,255,255,0.45)",
                  textAlign: "center",
                }}
              >
                Aquí ya puedes ver el avatar centrado sobre la portada antes de crear la comunidad.
              </p>
            </section>

            <section
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(12,12,12,0.92)",
                boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
                padding: 16,
                display: "grid",
                gap: 12,
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.92)",
                  }}
                >
                  Categoría
                </label>
                <SelectField
                  value={category}
                  onChange={(value) => setCategory(value as CanonicalGroupCategory)}
                >
                  {GROUP_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </SelectField>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.92)",
                  }}
                >
                  Tags (separados por coma)
                </label>
                <input
                  style={{
                    width: "100%",
                    borderRadius: 9,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.04)",
                    color: "#fff",
                    padding: "9px 11px",
                    fontSize: 13,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="ej: futbol, pumas, liga mx"
                />
                <p
                  style={{
                    margin: "6px 0 0 0",
                    fontSize: 12,
                    color: "rgba(255,255,255,0.45)",
                  }}
                >
                  Máximo 10 tags. Ejemplo: futbol, pumas, liga mx.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "10px 12px",
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#fff" }}>
                    Mensaje de bienvenida
                  </p>
                  <p
                    style={{
                      margin: "2px 0 0 0",
                      fontSize: 12,
                      color: "rgba(255,255,255,0.55)",
                    }}
                  >
                    Envía un texto inicial cuando entren a la comunidad.
                  </p>
                </div>
                <ToggleSwitch checked={greetingsEnabled} onChange={setGreetingsEnabled} />
              </div>

              {greetingsEnabled && (
                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      color: "rgba(255,255,255,0.92)",
                    }}
                  >
                    Mensaje de bienvenida
                  </label>
                  <textarea
                    style={{
                      width: "100%",
                      borderRadius: 9,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(255,255,255,0.04)",
                      color: "#fff",
                      padding: "9px 11px",
                      fontSize: 13,
                      outline: "none",
                      minHeight: 90,
                      resize: "vertical",
                      boxSizing: "border-box",
                    }}
                    value={welcomeMessage}
                    onChange={(e) => setWelcomeMessage(e.target.value)}
                    placeholder="Ej: Bienvenido a la comunidad..."
                    rows={3}
                  />
                </div>
              )}

              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      color: "rgba(255,255,255,0.92)",
                    }}
                  >
                    Edad mínima
                  </label>
                  <input
                    type="number"
                    style={{
                      width: "100%",
                      borderRadius: 9,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(255,255,255,0.04)",
                      color: "#fff",
                      padding: "9px 11px",
                      fontSize: 13,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                    value={ageMin}
                    onChange={(e) => setAgeMin(e.target.value)}
                    placeholder="18"
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      color: "rgba(255,255,255,0.92)",
                    }}
                  >
                    Edad máxima
                  </label>
                  <input
                    type="number"
                    style={{
                      width: "100%",
                      borderRadius: 9,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(255,255,255,0.04)",
                      color: "#fff",
                      padding: "9px 11px",
                      fontSize: 13,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                    value={ageMax}
                    onChange={(e) => setAgeMax(e.target.value)}
                    placeholder="99"
                  />
                </div>
              </div>
            </section>

            <section
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(12,12,12,0.92)",
                boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
                padding: 16,
                display: "grid",
                gap: 12,
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.92)",
                  }}
                >
                  Quién puede publicar
                </label>
                <SelectField
                  value={postingMode}
                  onChange={(value) => setPostingMode(value as PostingMode)}
                >
                  <option value="members">Miembros</option>
                  <option value="owner_only">Solo dueño</option>
                </SelectField>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                  padding: "10px 12px",
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#fff" }}>
                    Permitir comentarios
                  </p>
                  <p
                    style={{
                      margin: "2px 0 0 0",
                      fontSize: 12,
                      color: "rgba(255,255,255,0.55)",
                    }}
                  >
                    Activa respuestas dentro de publicaciones de la comunidad.
                  </p>
                </div>
                <ToggleSwitch checked={commentsEnabled} onChange={setCommentsEnabled} />
              </div>
            </section>

            <section
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "rgba(12,12,12,0.92)",
                boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
                padding: 16,
                display: "grid",
                gap: 12,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Monetización</h2>

              {!subscriptionAllowed && (
                <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.50)" }}>
                  Nota: las comunidades públicas no pueden tener suscripción en este MVP.
                </p>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: "rgba(255,255,255,0.82)",
                  }}
                >
                  <input
                    type="radio"
                    name="monetizationMode"
                    value="free"
                    checked={monetizationMode === "free"}
                    onChange={() => setMonetizationMode("free")}
                  />
                  Gratis
                </label>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: "rgba(255,255,255,0.82)",
                  }}
                >
                  <input
                    type="radio"
                    name="monetizationMode"
                    value="paid"
                    checked={monetizationMode === "paid"}
                    disabled={!subscriptionAllowed}
                    onChange={() => setMonetizationMode("paid")}
                  />
                  Suscripción mensual
                </label>
              </div>

              {isPaid && (
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: 6,
                        fontSize: 12,
                        fontWeight: 500,
                        color: "rgba(255,255,255,0.92)",
                      }}
                    >
                      Precio mensual
                    </label>
                    <input
                      type="number"
                      style={{
                        width: "100%",
                        borderRadius: 9,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: "rgba(255,255,255,0.04)",
                        color: "#fff",
                        padding: "9px 11px",
                        fontSize: 13,
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                      value={priceMonthly}
                      onChange={(e) => setPriceMonthly(e.target.value)}
                      placeholder="Ej: 99"
                    />
                  </div>

                  <div>
                    <label
                      style={{
                        display: "block",
                        marginBottom: 6,
                        fontSize: 12,
                        fontWeight: 500,
                        color: "rgba(255,255,255,0.92)",
                      }}
                    >
                      Moneda
                    </label>
                    <SelectField
                      value={currency}
                      onChange={(value) => setCurrency(value as Currency)}
                    >
                      <option value="MXN">MXN</option>
                      <option value="USD">USD</option>
                    </SelectField>
                  </div>
                </div>
              )}
            </section>
            
            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 9,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "#fff",
                color: "#000",
                fontSize: 13,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.72 : 1,
                fontFamily: fontStack,
              }}
            >
              {loading ? "Creando..." : "Crear comunidad"}
            </button>
          </form>
        </div>
      </div>

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
            if (!croppingBusy) closeCropModal();
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
                {cropMode === "avatar" ? "Recortar avatar de la comunidad" : "Recortar portada"}
              </div>

              <button
                type="button"
                onClick={closeCropModal}
                style={{
                  ...styles.buttonSecondary,
                  cursor: croppingBusy ? "not-allowed" : "pointer",
                  opacity: croppingBusy ? 0.6 : 1,
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
<SafeCropper
  image={cropImageSrc}
  crop={crop}
  zoom={zoom}
  aspect={cropAspect}
  onCropChange={setCrop}
  onZoomChange={setZoom}
  onCropComplete={onCropComplete}
  cropShape={cropMode === "avatar" ? "round" : "rect"}
  showGrid={cropMode !== "avatar"}
  rotation={0}
  minZoom={1}
  maxZoom={3}
  zoomSpeed={1}
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

                <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    onClick={closeCropModal}
                    style={{
                      ...styles.buttonSecondary,
                      cursor: croppingBusy ? "not-allowed" : "pointer",
                      opacity: croppingBusy ? 0.6 : 1,
                    }}
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    onClick={confirmCrop}
                    disabled={croppingBusy}
                    style={{
                      ...styles.buttonPrimary,
                      background: croppingBusy ? "rgba(255,255,255,0.15)" : "#ffffff",
                      color: croppingBusy ? "#fff" : "#000",
                      cursor: croppingBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    {croppingBusy ? "Guardando..." : "Guardar"}
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
                {cropMode === "avatar" ? "Avatar 1:1." : "Portada 16:9."}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
export default function NewGroupPage() {
  return (
    <Suspense fallback={null}>
      <NewGroupPageContent />
    </Suspense>
  );
}