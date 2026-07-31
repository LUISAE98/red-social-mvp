//page.tsx

"use client";

import Image from "next/image";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import SafeCropper from "@/components/media/SafeCropper";
import { useAuth } from "@/app/providers";
import { createGroup } from "@/lib/groups/createGroup";
import type {
  CanonicalGroupCategory,
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
import { usePriceFormat } from "@/lib/currency/usePriceFormat";


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

  if (!ctx) throw new Error("canvas_context_unavailable");

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
          reject(new Error("crop_blob_unavailable"));
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
          borderRadius: 12,
          border: "none",
          backgroundColor: "rgba(255,255,255,0.11)",
          color: "rgba(255,255,255,0.85)",
          padding: "10px 36px 10px 12px",
          fontSize: 13,
          fontWeight: 400,
          fontFamily: "inherit",
          lineHeight: 1.5,
          outline: "none",
          appearance: "none",
          WebkitAppearance: "none",
          MozAppearance: "none",
          boxSizing: "border-box",
          cursor: disabled ? "not-allowed" : "pointer",
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
const tCommon = useTranslations("common");
const tGroups = useTranslations("groups");
const tProfile = useTranslations("profile");
const { resolveStoredPrice, currency: displayCurrency, formatAnchor } = usePriceFormat();
const router = useRouter();
const pathname = usePathname();
const searchParams = useSearchParams();
const { user, loading: authLoading } = useAuth();

  const fontStack =
    'inherit';

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
      borderRadius: 10,
      border: "none",
      background: "linear-gradient(135deg, #f472b6, #a855f7)",
      color: "#fff",
      cursor: "pointer",
      fontWeight: 600,
      fontSize: ui.fontBody,
      fontFamily: fontStack,
      letterSpacing: "-0.01em",
      lineHeight: 1.2,
      WebkitTapHighlightColor: "transparent",
      transition: "opacity 150ms ease",
    } as React.CSSProperties,
    buttonSecondary: {
      padding: ui.buttonPadding,
      borderRadius: 10,
      border: "none",
      background: "rgba(239, 68, 68, 0.10)",
      color: "#fff",
      cursor: "pointer",
      fontWeight: 600,
      fontSize: ui.fontBody,
      fontFamily: fontStack,
      letterSpacing: "-0.01em",
      lineHeight: 1.2,
      WebkitTapHighlightColor: "transparent",
      transition: "opacity 150ms ease",
    } as React.CSSProperties,
    label: {
      fontSize: ui.fontMicro,
      fontWeight: 500,
      color: "rgba(255,255,255,0.90)",
    } as React.CSSProperties,
  };

  // Estilos espejo del formulario de crear cuenta (RegisterPanel): inputs con
  // fondo translúcido SIN borde, labels chicos, botón píldora con gradiente. El
  // formulario ya no usa contenedores (secciones con borde/sombra).
  const fieldInput: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: "rgba(255,255,255,0.11)",
    border: "none",
    borderRadius: 12,
    padding: "10px 12px",
    color: "#fff",
    fontSize: 13,
    fontFamily: "inherit",
    lineHeight: 1.5,
    outline: "none",
    WebkitAppearance: "none",
  };
  const fieldLabel: React.CSSProperties = {
    display: "block",
    marginBottom: 5,
    fontSize: 10.5,
    fontWeight: 500,
    color: "rgba(255,255,255,0.88)",
    lineHeight: 1.15,
  };
  const helperText: React.CSSProperties = {
    margin: "6px 0 0 0",
    fontSize: 10,
    fontWeight: 400,
    color: "rgba(255,255,255,0.60)",
    lineHeight: 1.35,
  };
  const sectionGroup: React.CSSProperties = { display: "grid", gap: 12 };
  const primaryButton: React.CSSProperties = {
    width: "100%",
    minHeight: 40,
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    backgroundImage:
      "linear-gradient(100deg, #ff2fb3 0%, #a855f7 35%, #4f46ff 70%, #ff2fb3 100%)",
    backgroundSize: "280% 280%",
    backgroundPosition: "0% 50%",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    fontFamily: fontStack,
    cursor: "pointer",
    boxShadow: "0 10px 28px rgba(168,85,255,0.22)",
    overflow: "hidden",
    WebkitTapHighlightColor: "transparent",
  };

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<GroupVisibility>("public");

  // "otros" ya no es seleccionable; el formulario arranca en la primera categoría real.
  const [category, setCategory] = useState<CanonicalGroupCategory>(
    GROUP_CATEGORY_OPTIONS[0].value
  );
  const [tagsRaw, setTagsRaw] = useState("");

  const [greetingsEnabled, setGreetingsEnabled] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState("");

  const [ageMin, setAgeMin] = useState<string>("18");
  const [ageMax, setAgeMax] = useState<string>("99");

  const [postingMode, setPostingMode] = useState<PostingMode>("members");
  const [commentsEnabled, setCommentsEnabled] = useState(true);

  const [monetizationMode, setMonetizationMode] = useState<"free" | "paid">("free");
  const [priceMonthly, setPriceMonthly] = useState<string>("");

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
    setError((e instanceof Error ? e.message : null) ?? tGroups("avatarReadError"));
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
    setError((e instanceof Error ? e.message : null) ?? tGroups("coverReadError"));
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
      setError(tGroups("cropError"));
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
    } catch {
      setError(tGroups("cropError"));
    } finally {
      setCroppingBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!user) {
      setError(tGroups("mustLogin"));
      return;
    }

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();

    if (trimmedName.length < 3) {
      setError(tGroups("nameMinLength"));
      return;
    }

    if (trimmedDesc.length < 10) {
      setError(tGroups("descriptionMinLength"));
      return;
    }

    const ageMinNum = ageMin ? Number(ageMin) : null;
    const ageMaxNum = ageMax ? Number(ageMax) : null;

    if (
      ageMinNum != null &&
      (!Number.isFinite(ageMinNum) || ageMinNum < 18 || ageMinNum > 99)
    ) {
      setError(tGroups("ageMinInvalid"));
      return;
    }

    if (
      ageMaxNum != null &&
      (!Number.isFinite(ageMaxNum) || ageMaxNum < 18 || ageMaxNum > 99)
    ) {
      setError(tGroups("ageMaxInvalid"));
      return;
    }

    if (ageMinNum != null && ageMaxNum != null && ageMinNum > ageMaxNum) {
      setError(tGroups("ageMinGreaterThanMax"));
      return;
    }

    const priceNum = priceMonthly ? Number(priceMonthly) : null;
    if (isPaid) {
      if (priceNum == null || !(priceNum > 0) || !Number.isFinite(priceNum)) {
        setError(tGroups("priceInvalid"));
        return;
      }
    }

    // El creador tecleó en su moneda; guardamos en MXN (ancla).
    const storedPrice =
      isPaid && priceNum != null ? resolveStoredPrice(priceNum) : null;
    const storedPriceMonthly = storedPrice ? storedPrice.price : null;
    const storedCurrency = storedPrice ? storedPrice.currency : null;

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
          priceMonthly: storedPriceMonthly,
          currency: storedCurrency,
          subscriptionsEnabled: isPaid,
          subscriptionPriceMonthly: storedPriceMonthly,
          subscriptionCurrency: storedCurrency,
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
      setError((err instanceof Error ? err.message : null) ?? tGroups("groupCreationError"));
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
            {tCommon("loading")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          minHeight: "100dvh",
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
              {tGroups("createCommunity")}
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
              {tGroups("createGroupDescription")}
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
            <div style={sectionGroup}>
              <div>
                <label style={fieldLabel}>
                  {tGroups("name")}
                </label>
                <input
                  style={fieldInput}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label style={fieldLabel}>
                  {tGroups("groupDescription")}
                </label>
                <textarea
                  style={{ ...fieldInput, minHeight: 110, resize: "vertical" }}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
              </div>

              <div>
                <label style={fieldLabel}>
                  {tGroups("visibility")}
                </label>
                <SelectField
                  value={visibility}
                  onChange={(value) => setVisibility(value as GroupVisibility)}
                >
                  <option value="public">{tGroups("visibilityPublic")}</option>
                  <option value="private">{tGroups("visibilityPrivate")}</option>
                  <option value="hidden">{tGroups("visibilityHidden")}</option>
                </SelectField>
              </div>
            </div>

            <div style={sectionGroup}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{tGroups("images")}</h2>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.50)" }}>
                  {tGroups("imagePreviewDescription")}
                </span>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "none",
                  background: "rgba(255,255,255,0.05)",
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
                      alt={tGroups("cover")}
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
                      {tGroups("communitycover")}
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
                    {tGroups("chooseCover")}
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
                        alt={tGroups("avatar")}
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
                        {tGroups("avatar")}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      aria-label={tGroups("chooseAvatarAriaLabel")}
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
                    {name.trim() || tGroups("groupName")}
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
                      : tGroups("previewEmptyState")}
                  </p>

                  <p
                    style={{
                      margin: "10px 0 0 0",
                      fontSize: 12,
                      color: "rgba(255,255,255,0.56)",
                      lineHeight: 1.4,
                    }}
                  >
                    {tGroups("previewLabel")}
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
                      {tGroups("removeAvatar")}
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
                      {tGroups("removeCover")}
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
                  {tGroups("uploadingAvatar")}{avatarUploadPct}%
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
                  {tGroups("uploadingCover")}{coverUploadPct}%
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
                {tGroups("avatarPreviewInfo")}
              </p>
            </div>

            <div style={sectionGroup}>
              <div>
                <label style={fieldLabel}>
                  {tGroups("category")}
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
                <label style={fieldLabel}>
                  {tGroups("tagsLabel")}
                </label>
                <input
                  style={fieldInput}
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                />
                <p
                  style={{
                    margin: "6px 0 0 0",
                    fontSize: 12,
                    color: "rgba(255,255,255,0.45)",
                  }}
                >
                  {tGroups("tagsMaxInfo")}
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  borderRadius: 12,
                  border: "none",
                  background: "rgba(255,255,255,0.04)",
                  padding: "10px 12px",
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#fff" }}>
                    {tGroups("welcomeMessageLabel")}
                  </p>
                  <p
                    style={{
                      margin: "2px 0 0 0",
                      fontSize: 12,
                      color: "rgba(255,255,255,0.55)",
                    }}
                  >
                    {tGroups("welcomeMessageDescription")}
                  </p>
                </div>
                <ToggleSwitch checked={greetingsEnabled} onChange={setGreetingsEnabled} />
              </div>

              {greetingsEnabled && (
                <div>
                  <label style={fieldLabel}>
                    {tGroups("welcomeMessageLabel")}
                  </label>
                  <textarea
                    style={{ ...fieldInput, minHeight: 90, resize: "vertical" }}
                    value={welcomeMessage}
                    onChange={(e) => setWelcomeMessage(e.target.value)}
                    rows={3}
                  />
                </div>
              )}

              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <label style={fieldLabel}>
                    {tGroups("ageMin")}
                  </label>
                  <input
                    type="number"
                    style={fieldInput}
                    value={ageMin}
                    onChange={(e) => setAgeMin(e.target.value)}
                  />
                </div>

                <div>
                  <label style={fieldLabel}>
                    {tGroups("ageMax")}
                  </label>
                  <input
                    type="number"
                    style={fieldInput}
                    value={ageMax}
                    onChange={(e) => setAgeMax(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div style={sectionGroup}>
              <div>
                <label style={fieldLabel}>
                  {tGroups("whoCanPost")}
                </label>
                <SelectField
                  value={postingMode}
                  onChange={(value) => setPostingMode(value as PostingMode)}
                >
                  <option value="members">{tGroups("members")}</option>
                  <option value="owner_only">{tGroups("ownerOnly")}</option>
                </SelectField>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  borderRadius: 12,
                  border: "none",
                  background: "rgba(255,255,255,0.04)",
                  padding: "10px 12px",
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#fff" }}>
                    {tGroups("allowComments")}
                  </p>
                  <p
                    style={{
                      margin: "2px 0 0 0",
                      fontSize: 12,
                      color: "rgba(255,255,255,0.55)",
                    }}
                  >
                    {tGroups("commentsDescription")}
                  </p>
                </div>
                <ToggleSwitch checked={commentsEnabled} onChange={setCommentsEnabled} />
              </div>
            </div>

            <div style={sectionGroup}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{tCommon("monetization")}</h2>

              {!subscriptionAllowed && (
                <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.50)" }}>
                  {tGroups("publicGroupsNoSubscription")}
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
                  {tCommon("free")}
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
                  {tGroups("monthlySubscription")}
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
                      {tGroups("monthlyPrice")}
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
                    />
                    {displayCurrency !== "USD" &&
                    priceMonthly &&
                    Number(priceMonthly) > 0 ? (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 12,
                          color: "rgba(255,255,255,0.6)",
                        }}
                      >
                        = {formatAnchor(resolveStoredPrice(Number(priceMonthly)).price)}
                      </div>
                    ) : null}
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
                      {tGroups("currency")}
                    </label>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        borderRadius: 12,
                        border: "none",
                        background: "rgba(255,255,255,0.11)",
                        color: "#fff",
                        padding: "10px 12px",
                        fontSize: 13,
                        boxSizing: "border-box",
                      }}
                    >
                      {displayCurrency}
                    </span>
                  </div>
                </div>
              )}
            </div>
            
            <button
              type="submit"
              disabled={loading}
              style={{
                ...primaryButton,
                marginTop: 2,
                opacity: loading ? 0.82 : 1,
                cursor: loading ? "not-allowed" : "pointer",
                filter: loading ? "grayscale(0.15)" : "none",
              }}
            >
              {loading ? tGroups("creating") : tGroups("createCommunity")}
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
                {cropMode === "avatar" ? tGroups("cropAvatarTitle") : tProfile("cropCover")}
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
                {tCommon("close")}
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
                <label style={styles.label}>{tCommon("zoom")}</label>

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
                    {tCommon("cancel")}
                  </button>

                  <button
                    type="button"
                    onClick={confirmCrop}
                    disabled={croppingBusy}
                    style={{
                      ...styles.buttonPrimary,
                      opacity: croppingBusy ? 0.65 : 1,
                      cursor: croppingBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    {croppingBusy ? tCommon("saving") : tCommon("save")}
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
                {cropMode === "avatar" ? tProfile("cropTipAvatar") : tProfile("cropTipCover")}
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