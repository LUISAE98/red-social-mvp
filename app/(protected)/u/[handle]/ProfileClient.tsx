"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { onAuthStateChanged } from "firebase/auth";

import Cropper from "react-easy-crop";

import { auth, db, storage } from "@/lib/firebase";
import { updateOfferings, type GroupOffering } from "@/lib/groups/updateOfferings";

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

type GroupDocLite = {
  id: string;
  name?: string;
  ownerId?: string;
  offerings?: Array<{
    type: "saludo" | "consejo" | "mensaje" | string;
    enabled?: boolean;
    price?: number | null;
    currency?: "MXN" | "USD" | null;
  }>;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

function pickSaludoOffering(offerings: GroupDocLite["offerings"]) {
  const arr = Array.isArray(offerings) ? offerings : [];
  const found = arr.find((o) => String(o?.type) === "saludo");
  const enabled = found?.enabled === true;
  const price = found?.price ?? null;
  const currency = (found?.currency ?? "MXN") as "MXN" | "USD";
  return { enabled, price, currency };
}

const LS_WIDGET_OPEN_KEY = "rs_widget_groups_open_v1";

type CropMode = "avatar" | "cover";
type Area = { x: number; y: number; width: number; height: number };

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
  const router = useRouter();
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

  const [pgEnabled, setPgEnabled] = useState(false);
  const [pgPrice, setPgPrice] = useState<string>("");
  const [pgCurrency, setPgCurrency] = useState<"MXN" | "USD">("MXN");
  const [savingProfileGreeting, setSavingProfileGreeting] = useState(false);

  const [widgetOpen, setWidgetOpen] = useState(true);
  const [myGroups, setMyGroups] = useState<GroupDocLite[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupsErr, setGroupsErr] = useState<string | null>(null);
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);

  const [groupDraft, setGroupDraft] = useState<
    Record<string, { enabled: boolean; price: string; currency: "MXN" | "USD" }>
  >({});

  const profileDraft = useMemo(() => {
    return {
      enabled: pgEnabled,
      price: pgPrice,
      currency: pgCurrency,
    };
  }, [pgEnabled, pgPrice, pgCurrency]);

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
    card: {
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.22)",
      background: "rgba(12,12,12,0.9)",
      boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    } as React.CSSProperties,
    input: {
      padding: "11px 12px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.30)",
      background: "rgba(0,0,0,0.32)",
      color: "#fff",
      outline: "none",
      fontSize: 14,
      fontFamily: fontStack,
    } as React.CSSProperties,
    buttonPrimary: {
      padding: "11px 12px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.28)",
      background: "#fff",
      color: "#000",
      cursor: "pointer",
      fontWeight: 600,
      fontSize: 14,
      fontFamily: fontStack,
    } as React.CSSProperties,
    buttonSecondary: {
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.24)",
      background: "rgba(255,255,255,0.08)",
      color: "#fff",
      cursor: "pointer",
      fontWeight: 500,
      fontSize: 13,
      fontFamily: fontStack,
    } as React.CSSProperties,
    title: {
      fontSize: 22,
      fontWeight: 600,
      margin: 0,
    } as React.CSSProperties,
    subtitle: {
      fontSize: 14,
      fontWeight: 400,
      color: "rgba(255,255,255,0.78)",
    } as React.CSSProperties,
    label: {
      fontSize: 13,
      fontWeight: 500,
      color: "rgba(255,255,255,0.90)",
    } as React.CSSProperties,
    meta: {
      fontSize: 13,
      color: "rgba(255,255,255,0.78)",
    } as React.CSSProperties,
    panel: {
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.03)",
    } as React.CSSProperties,
    message: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.16)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      fontSize: 13,
    } as React.CSSProperties,
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setViewer(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_WIDGET_OPEN_KEY);
      if (raw === "0") setWidgetOpen(false);
      if (raw === "1") setWidgetOpen(true);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_WIDGET_OPEN_KEY, widgetOpen ? "1" : "0");
    } catch {}
  }, [widgetOpen]);

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

      const pg = u.profileGreeting;
      setPgEnabled(pg?.enabled === true);
      setPgPrice(pg?.price == null ? "" : String(pg.price));
      setPgCurrency((pg?.currency ?? "MXN") as "MXN" | "USD");
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

  useEffect(() => {
    async function loadMyGroups() {
      if (!isOwner || !viewer?.uid) {
        setMyGroups([]);
        setGroupDraft({});
        return;
      }

      setLoadingGroups(true);
      setGroupsErr(null);

      try {
        const gq = query(
          collection(db, "groups"),
          where("ownerId", "==", viewer.uid),
          limit(50)
        );
        const gs = await getDocs(gq);

        const rows: GroupDocLite[] = gs.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));

        setMyGroups(rows);

        const draft: Record<
          string,
          { enabled: boolean; price: string; currency: "MXN" | "USD" }
        > = {};

        for (const g of rows) {
          const s = pickSaludoOffering(g.offerings);
          draft[g.id] = {
            enabled: s.enabled,
            price: s.price == null ? "" : String(s.price),
            currency: s.currency ?? "MXN",
          };
        }

        setGroupDraft(draft);
      } catch (e: any) {
        setGroupsErr(e?.message ?? "No se pudieron cargar tus grupos.");
        setMyGroups([]);
        setGroupDraft({});
      } finally {
        setLoadingGroups(false);
      }
    }

    loadMyGroups();
  }, [isOwner, viewer?.uid]);

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

  async function saveProfileGreetingFromWidget() {
    if (!userDoc || !isOwner) return;

    setSavingProfileGreeting(true);
    setMsg(null);

    try {
      const priceNum = pgPrice.trim() === "" ? null : Number(pgPrice);

      if (
        pgEnabled &&
        (priceNum == null || Number.isNaN(priceNum) || priceNum < 0)
      ) {
        setMsg("❌ Precio inválido.");
        return;
      }

      const uref = doc(db, "users", userDoc.uid);

      await updateDoc(uref, {
        profileGreeting: {
          enabled: pgEnabled,
          price: pgEnabled ? priceNum : null,
          currency: pgEnabled ? pgCurrency : null,
        },
      });

      setMsg("✅ Configuración de saludos en perfil guardada.");
    } catch (e: any) {
      setMsg(e?.message ?? "❌ No se pudo guardar configuración.");
    } finally {
      setSavingProfileGreeting(false);
    }
  }

  async function saveGroupSaludo(groupId: string) {
    if (!isOwner) return;

    const g = myGroups.find((x) => x.id === groupId);
    if (!g) return;

    const d = groupDraft[groupId];
    if (!d) return;

    const priceNum = d.price.trim() === "" ? null : Number(d.price);

    if (d.enabled && (priceNum == null || Number.isNaN(priceNum) || priceNum < 0)) {
      setGroupsErr("❌ Precio inválido en un grupo.");
      return;
    }

    const existing = Array.isArray(g.offerings) ? g.offerings : [];

    const next: GroupOffering[] = [];

    const hasType = (t: string) =>
      existing.some((o: any) => String(o?.type) === t);

    next.push({
      type: "saludo",
      enabled: d.enabled,
      price: d.enabled ? priceNum : null,
      currency: d.enabled ? d.currency : null,
    });

    if (hasType("consejo")) {
      const o = existing.find((x: any) => String(x?.type) === "consejo") as any;
      next.push({
        type: "consejo",
        enabled: o?.enabled === true,
        price: o?.price ?? null,
        currency: o?.currency ?? null,
      });
    }

    if (hasType("mensaje")) {
      const o = existing.find((x: any) => String(x?.type) === "mensaje") as any;
      next.push({
        type: "mensaje",
        enabled: o?.enabled === true,
        price: o?.price ?? null,
        currency: o?.currency ?? null,
      });
    }

    setSavingGroupId(groupId);
    setGroupsErr(null);

    try {
      await updateOfferings(groupId, next);

      setMyGroups((prev) =>
        prev.map((gg) => {
          if (gg.id !== groupId) return gg;

          return {
            ...gg,
            offerings: [
              ...existing.filter((o: any) => String(o?.type) !== "saludo"),
              {
                type: "saludo",
                enabled: d.enabled,
                price: d.enabled ? priceNum : null,
                currency: d.enabled ? d.currency : null,
              },
            ],
          };
        })
      );
    } catch (e: any) {
      setGroupsErr(e?.message ?? "❌ No se pudo actualizar el grupo.");
    } finally {
      setSavingGroupId(null);
    }
  }

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#000",
          color: "#fff",
          padding: 24,
          fontFamily: fontStack,
        }}
      >
        <div style={{ maxWidth: 980, margin: "0 auto" }}>Cargando perfil...</div>
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
          padding: 24,
          fontFamily: fontStack,
        }}
      >
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
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
      {isOwner && (
        <button
          type="button"
          style={{
            position: "fixed",
            right: 18,
            top: 18,
            height: 42,
            padding: "0 14px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(12,12,12,0.9)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            zIndex: 20000,
            backdropFilter: "blur(10px)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            fontFamily: fontStack,
          }}
          title="Administrar"
          onClick={() => {
            // router.push("/settings");
          }}
        >
          Administrar <span style={{ opacity: 0.9 }}>⚙️</span>
        </button>
      )}

      <main
        style={{
          minHeight: "calc(100vh - 70px)",
          padding: "28px 16px 140px",
          background: "#000",
          color: "#fff",
          fontFamily: fontStack,
        }}
      >
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <div
            style={{
              ...ui.card,
              borderRadius: 18,
              overflow: "hidden",
            }}
          >
            <div style={{ position: "relative", height: 260, background: "#0b0b0b" }}>
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
                    right: 16,
                    top: 16,
                    ...ui.buttonSecondary,
                    background: uploading
                      ? "rgba(255,255,255,0.12)"
                      : "rgba(12,12,12,0.72)",
                    cursor: uploading ? "not-allowed" : "pointer",
                    zIndex: 3,
                    backdropFilter: "blur(8px)",
                  }}
                  title="Cambiar portada"
                >
                  {uploading && cropMode === "cover" ? "Subiendo..." : "Cambiar portada"}
                </button>
              )}
            </div>

            <div style={{ position: "relative", padding: "0 22px 22px" }}>
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: -92,
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
                      width: 300,
                      height: 300,
                      borderRadius: "50%",
                      overflow: "hidden",
                      border: "6px solid rgba(0,0,0,0.9)",
                      boxShadow: "0 16px 40px rgba(0,0,0,0.7)",
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
                          fontSize: 36,
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
                        right: 14,
                        bottom: 16,
                        width: 56,
                        height: 56,
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.22)",
                        background: uploading
                          ? "rgba(255,255,255,0.14)"
                          : "rgba(12,12,12,0.9)",
                        color: "#fff",
                        cursor: uploading ? "not-allowed" : "pointer",
                        fontSize: 18,
                        fontWeight: 600,
                        display: "grid",
                        placeItems: "center",
                        boxShadow: "0 10px 24px rgba(0,0,0,0.6)",
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

              <div style={{ paddingTop: 250, position: "relative", zIndex: 1 }}>
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
                      fontSize: 28,
                      fontWeight: 600,
                      letterSpacing: -0.4,
                      lineHeight: 1.1,
                    }}
                  >
                    {fullName}
                  </div>

                  <div
                    style={{
                      marginTop: 6,
                      color: "rgba(255,255,255,0.72)",
                      fontWeight: 500,
                      fontSize: 14,
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

              <div
                style={{
                  marginTop: 18,
                  borderTop: "1px solid rgba(255,255,255,0.10)",
                  paddingTop: 16,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ color: "rgba(255,255,255,0.65)", fontSize: 14 }}>Edad</span>
                  <b style={{ color: "#fff", fontSize: 14 }}>{userDoc.age}</b>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ color: "rgba(255,255,255,0.65)", fontSize: 14 }}>Sexo</span>
                  <b style={{ color: "#fff", fontSize: 14 }}>{userDoc.sex}</b>
                </div>

                {msg && (
                  <div
                    style={{
                      ...ui.message,
                      marginTop: 6,
                    }}
                  >
                    {msg}
                  </div>
                )}

                {authReady && viewer && (
                  <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.6, fontSize: 12 }}>
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
            padding: 16,
            fontFamily: fontStack,
          }}
          onClick={() => {
            if (!uploading) setCropOpen(false);
          }}
        >
          <div
            style={{
              width: "min(820px, 96vw)",
              ...ui.card,
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderBottom: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <div style={{ fontWeight: 600, color: "#fff", fontSize: 16 }}>
                {cropMode === "avatar" ? "Recortar foto de perfil" : "Recortar portada"}
              </div>

              <button
                type="button"
                onClick={() => !uploading && setCropOpen(false)}
                style={{
                  ...ui.buttonSecondary,
                  cursor: uploading ? "not-allowed" : "pointer",
                  opacity: uploading ? 0.6 : 1,
                }}
              >
                Cerrar
              </button>
            </div>

            <div style={{ padding: 14 }}>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: cropMode === "avatar" ? 420 : 360,
                  background: "#050505",
                  borderRadius: 14,
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
                <label style={{ ...ui.label, fontSize: 12 }}>Zoom</label>

                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  style={{ width: 240 }}
                />

                <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => !uploading && setCropOpen(false)}
                    style={{
                      ...ui.buttonSecondary,
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
                      ...ui.buttonPrimary,
                      background: uploading ? "rgba(255,255,255,0.15)" : "#ffffff",
                      color: uploading ? "#fff" : "#000",
                      cursor: uploading ? "not-allowed" : "pointer",
                    }}
                  >
                    {uploading ? "Subiendo..." : "Guardar"}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
                Tip: mueve la imagen para encuadrar.{" "}
                {cropMode === "avatar" ? "Avatar 1:1" : "Portada 16:9"}.
              </div>
            </div>
          </div>
        </div>
      )}

      {isOwner && (
        <div
          style={{
            position: "fixed",
            left: 16,
            bottom: 16,
            width: 380,
            zIndex: 9998,
            fontFamily: fontStack,
          }}
        >
          <div
            style={{
              ...ui.card,
              borderRadius: 14,
              overflow: "hidden",
              color: "#fff",
            }}
          >
            <button
              type="button"
              onClick={() => setWidgetOpen((v) => !v)}
              style={{
                width: "100%",
                padding: "10px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                border: "none",
                background: "rgba(255,255,255,0.06)",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                fontFamily: fontStack,
              }}
            >
              <span>Mis grupos — Saludos</span>

              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, opacity: 0.85 }}>
                  {loadingGroups ? "Cargando..." : `${myGroups.length}`}
                </span>
                <span style={{ fontSize: 12, opacity: 0.9 }}>
                  {widgetOpen ? "▲" : "▼"}
                </span>
              </span>
            </button>

            {!widgetOpen ? null : (
              <div style={{ padding: 12, display: "grid", gap: 10 }}>
                {groupsErr && (
                  <div style={ui.message}>{groupsErr}</div>
                )}

                <div
                  style={{
                    ...ui.panel,
                    padding: 10,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <span>Mi perfil</span>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>saludo</span>
                  </div>

                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginTop: 10,
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={profileDraft.enabled}
                      onChange={(e) => setPgEnabled(e.target.checked)}
                    />
                    Vender saludos en mi perfil
                  </label>

                  {profileDraft.enabled && (
                    <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <input
                        type="number"
                        value={profileDraft.price}
                        onChange={(e) => setPgPrice(e.target.value)}
                        placeholder="Precio"
                        style={{
                          ...ui.input,
                          width: 140,
                        }}
                      />

                      <select
                        value={profileDraft.currency}
                        onChange={(e) => setPgCurrency(e.target.value as "MXN" | "USD")}
                        style={ui.input}
                      >
                        <option value="MXN">MXN</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={saveProfileGreetingFromWidget}
                    disabled={savingProfileGreeting}
                    style={{
                      ...ui.buttonSecondary,
                      marginTop: 10,
                      opacity: savingProfileGreeting ? 0.7 : 1,
                      width: "100%",
                      cursor: savingProfileGreeting ? "not-allowed" : "pointer",
                    }}
                  >
                    {savingProfileGreeting ? "Guardando..." : "Guardar Mi perfil"}
                  </button>
                </div>

                {!loadingGroups && myGroups.length === 0 && (
                  <div style={{ fontSize: 12, opacity: 0.75 }}>No tienes grupos como owner.</div>
                )}

                {myGroups.map((g) => {
                  const d = groupDraft[g.id];
                  if (!d) return null;

                  const saving = savingGroupId === g.id;

                  return (
                    <div
                      key={g.id}
                      style={{
                        ...ui.panel,
                        padding: 10,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => router.push(`/groups/${g.id}`)}
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          textAlign: "left",
                          cursor: "pointer",
                          textDecoration: "underline",
                          color: "#fff",
                          fontFamily: fontStack,
                        }}
                        title="Abrir grupo"
                      >
                        {g.name ?? "(Sin nombre)"}
                      </button>

                      <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>
                        id: {g.id}
                      </div>

                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          marginTop: 10,
                          fontSize: 13,
                          fontWeight: 500,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={d.enabled}
                          onChange={(e) =>
                            setGroupDraft((prev) => ({
                              ...prev,
                              [g.id]: { ...prev[g.id], enabled: e.target.checked },
                            }))
                          }
                        />
                        Saludos activos en este grupo
                      </label>

                      {d.enabled && (
                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <input
                            type="number"
                            value={d.price}
                            onChange={(e) =>
                              setGroupDraft((prev) => ({
                                ...prev,
                                [g.id]: { ...prev[g.id], price: e.target.value },
                              }))
                            }
                            placeholder="Precio"
                            style={{
                              ...ui.input,
                              width: 140,
                            }}
                          />

                          <select
                            value={d.currency}
                            onChange={(e) =>
                              setGroupDraft((prev) => ({
                                ...prev,
                                [g.id]: { ...prev[g.id], currency: e.target.value as "MXN" | "USD" },
                              }))
                            }
                            style={ui.input}
                          >
                            <option value="MXN">MXN</option>
                            <option value="USD">USD</option>
                          </select>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => saveGroupSaludo(g.id)}
                        disabled={saving}
                        style={{
                          ...ui.buttonSecondary,
                          marginTop: 10,
                          opacity: saving ? 0.7 : 1,
                          width: "100%",
                          cursor: saving ? "not-allowed" : "pointer",
                        }}
                      >
                        {saving ? "Guardando..." : "Guardar cambios"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}