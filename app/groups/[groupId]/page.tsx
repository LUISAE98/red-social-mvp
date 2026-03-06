"use client";

import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { joinGroup, leaveGroup } from "@/lib/groups/membership";
import { requestToJoin, cancelJoinRequest } from "@/lib/groups/joinRequests";
import JoinRequestsPanel from "./components/JoinRequestsPanel";
import OwnerAdminPanel from "./components/OwnerAdminPanel";
import { createGreetingRequest, type GreetingType } from "@/lib/greetings/greetingRequests";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import Cropper from "react-easy-crop";

type JoinRequestStatus = "pending" | "approved" | "rejected" | string;

type GroupDoc = {
  id: string;
  name?: string;
  description?: string;
  ownerId?: string;
  visibility?: "public" | "private" | "hidden" | string;
  isActive?: boolean;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  category?: string | null;
  tags?: string[] | null;
  monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: string | null;
  };
  offerings?: Array<{
    type: "saludo" | "consejo" | "mensaje" | string;
    enabled?: boolean;
    price?: number | null;
    currency?: string | null;
  }>;
};

function labelForOfferingType(t: string) {
  if (t === "saludo") return "Saludo";
  if (t === "consejo") return "Consejo";
  return "Mensaje";
}

function isGreetingType(t: string): t is GreetingType {
  return t === "saludo" || t === "consejo" || t === "mensaje";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

type CropMode = "avatar" | "cover";
type Area = { x: number; y: number; width: number; height: number };

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

async function getCroppedBlob(imageSrc: string, pixelCrop: Area, mime = "image/jpeg"): Promise<Blob> {
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

  ctx.drawImage(image, safeX, safeY, safeW, safeH, 0, 0, canvas.width, canvas.height);

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

function visibilityLabel(v: string) {
  if (v === "public") return "Grupo público";
  if (v === "private") return "Grupo privado";
  if (v === "hidden") return "Grupo oculto";
  return v ? `Grupo ${v}` : "";
}

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const { user } = useAuth();

  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [isMember, setIsMember] = useState<boolean>(false);
  const [joinReqStatus, setJoinReqStatus] = useState<JoinRequestStatus | null>(null);

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = useMemo(() => !!user && !!group?.ownerId && group.ownerId === user.uid, [user, group]);
  const effectiveIsMember = isOwner || isMember;

  const [greetOpen, setGreetOpen] = useState(false);
  const [greetType, setGreetType] = useState<GreetingType>("saludo");
  const [toName, setToName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [greetSubmitting, setGreetSubmitting] = useState(false);
  const [greetError, setGreetError] = useState<string | null>(null);
  const [greetSuccess, setGreetSuccess] = useState<string | null>(null);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const pageWrap: React.CSSProperties = {
    minHeight: "calc(100vh - 70px)",
    padding: "28px 16px 140px",
    background: "#000",
    color: "#fff",
    fontFamily: fontStack,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    textRendering: "optimizeLegibility",
  };

  const container: React.CSSProperties = {
    maxWidth: 980,
    margin: "0 auto",
    width: "100%",
  };

  const coverHeight = 260;
  const avatarSize = 300;

  const [adminOpen, setAdminOpen] = useState(false);

  const [uploading, setUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [cropOpen, setCropOpen] = useState(false);
  const [cropMode, setCropMode] = useState<CropMode>("avatar");
  const [cropImageSrc, setCropImageSrc] = useState<string>("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const cropAspect = cropMode === "avatar" ? 1 / 1 : 16 / 9;

  const cardStyle: React.CSSProperties = {
    borderRadius: 16,
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.22)",
    background: "rgba(12,12,12,0.92)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    color: "#fff",
    backdropFilter: "blur(10px)",
  };

  const subtleText: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 400,
    color: "rgba(255,255,255,0.78)",
  };

  const microText: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 400,
    color: "rgba(255,255,255,0.72)",
  };

  const primaryButton: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.28)",
    background: "#fff",
    color: "#000",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    fontFamily: fontStack,
  };

  const secondaryButton: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    fontFamily: fontStack,
  };

  const smallSecondaryButton: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "rgba(12,12,12,0.92)",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    fontFamily: fontStack,
    backdropFilter: "blur(10px)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
    fontSize: 14,
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
  };

  const messageBox: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.05)",
    fontSize: 13,
    fontWeight: 400,
    color: "rgba(255,255,255,0.92)",
  };

  useEffect(() => {
    setLoading(true);
    setError(null);

    const gref = doc(db, "groups", groupId);

    const unsubGroup = onSnapshot(
      gref,
      (gsnap) => {
        if (!gsnap.exists()) {
          setGroup(null);
          setError("Grupo no encontrado.");
          setLoading(false);
          return;
        }

        setGroup({
          id: gsnap.id,
          ...(gsnap.data() as any),
        });

        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );

    let unsubMember = () => {};
    if (user) {
      const mref = doc(db, "groups", groupId, "members", user.uid);
      unsubMember = onSnapshot(
        mref,
        (msnap) => setIsMember(msnap.exists()),
        () => setIsMember(false)
      );
    } else {
      setIsMember(false);
    }

    let unsubJoinReq = () => {};
    if (user) {
      const jref = doc(db, "groups", groupId, "joinRequests", user.uid);
      unsubJoinReq = onSnapshot(
        jref,
        (jsnap) => {
          if (!jsnap.exists()) {
            setJoinReqStatus(null);
          } else {
            const jd = jsnap.data() as any;
            setJoinReqStatus(jd.status ?? "pending");
          }
        },
        () => setJoinReqStatus(null)
      );
    } else {
      setJoinReqStatus(null);
    }

    return () => {
      unsubGroup();
      unsubMember();
      unsubJoinReq();
    };
  }, [groupId, user]);

  async function handleJoinPublic() {
    if (!user) return;

    setJoining(true);
    setError(null);

    try {
      await joinGroup(groupId, user.uid);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo unir");
    } finally {
      setJoining(false);
    }
  }

  async function handleRequestPrivate() {
    if (!user) return;

    setJoining(true);
    setError(null);

    try {
      await requestToJoin(groupId, user.uid);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo enviar la solicitud");
    } finally {
      setJoining(false);
    }
  }

  async function handleCancelPrivate() {
    if (!user) return;

    setJoining(true);
    setError(null);

    try {
      await cancelJoinRequest(groupId, user.uid);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cancelar la solicitud");
    } finally {
      setJoining(false);
    }
  }

  async function handleLeave() {
    if (!user) return;

    if (isOwner) {
      setError("El owner no puede salir de su propio grupo.");
      return;
    }

    setLeaving(true);
    setError(null);

    try {
      await leaveGroup(groupId, user.uid);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo salir");
    } finally {
      setLeaving(false);
    }
  }

  function openGreetingForm(type: GreetingType) {
    setGreetError(null);
    setGreetSuccess(null);
    setGreetType(type);
    setToName("");
    setInstructions("");
    setGreetOpen(true);
  }

  function closeGreetingForm() {
    setGreetOpen(false);
    setGreetSubmitting(false);
    setGreetError(null);
    setGreetSuccess(null);
    setToName("");
    setInstructions("");
  }

  async function submitGreetingRequest() {
    if (!user) return;

    if (isOwner) {
      setGreetError("No puedes solicitar/comprar saludos en tu propio grupo.");
      return;
    }

    if (!toName.trim()) {
      setGreetError("Escribe el nombre de la persona a quien va dirigido el saludo.");
      return;
    }
    if (!instructions.trim()) {
      setGreetError("Escribe el contexto / instrucciones del saludo.");
      return;
    }

    setGreetSubmitting(true);
    setGreetError(null);
    setGreetSuccess(null);

    try {
      const res = await createGreetingRequest({
        groupId,
        type: greetType,
        toName: toName.trim(),
        instructions: instructions.trim(),
        source: "group",
      });

      setGreetSuccess(`✅ Solicitud enviada. ID: ${res.requestId}`);
      setGreetOpen(false);
      setToName("");
      setInstructions("");
    } catch (e: any) {
      setGreetError(e?.message ?? "No se pudo enviar la solicitud.");
    } finally {
      setGreetSubmitting(false);
    }
  }

  const openCropWithFile = useCallback(
    async (mode: CropMode, file: File) => {
      if (!isOwner) return;
      setError(null);

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

  const onCropComplete = useCallback((_croppedArea: any, croppedAreaPixelsArg: any) => {
    setCroppedAreaPixels(croppedAreaPixelsArg as Area);
  }, []);

  async function uploadCropped(mode: CropMode) {
    if (!group) return;
    if (!isOwner) return;
    if (!cropImageSrc || !croppedAreaPixels) {
      setError("❌ No se pudo recortar la imagen.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const blob = await getCroppedBlob(cropImageSrc, croppedAreaPixels, "image/jpeg");

      const path = mode === "avatar" ? `groups/${groupId}/avatar/avatar.jpg` : `groups/${groupId}/cover/cover.jpg`;
      const fileRef = ref(storage, path);

      await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
      const url = await getDownloadURL(fileRef);

      const gref = doc(db, "groups", groupId);
      if (mode === "avatar") {
        await updateDoc(gref, { avatarUrl: url });
      } else {
        await updateDoc(gref, { coverUrl: url });
      }

      setCropOpen(false);
    } catch (e: any) {
      setError(
        e?.code === "permission-denied"
          ? "❌ Permiso denegado. Revisa reglas de Storage/Firestore."
          : `❌ No se pudo subir la imagen: ${e?.message ?? "error"}`
      );
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div style={{ ...pageWrap, ...subtleText }}>Cargando...</div>;
  if (error) return <div style={{ ...pageWrap, color: "#ff6b6b", fontSize: 14, fontWeight: 400 }}>{error}</div>;
  if (!group) return null;

  const visibility = group.visibility ?? "";

  if (visibility === "private" && !effectiveIsMember) {
    const pending = joinReqStatus === "pending";
    const rejected = joinReqStatus === "rejected";
    const approved = joinReqStatus === "approved";

    return (
      <main style={pageWrap}>
        <div style={container}>
          <div style={cardStyle}>
            <div style={{ position: "relative", height: coverHeight, background: "#0b0b0b" }}>
              {group.coverUrl ? (
                <img
                  src={group.coverUrl}
                  alt="Cover"
                  style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.95 }}
                />
              ) : null}

              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.75) 85%, rgba(0,0,0,0.9) 100%)",
                }}
              />
            </div>

            <div style={{ padding: 18 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>
                {group.name ?? ""}
              </h1>
              <p style={{ marginTop: 8, marginBottom: 0, ...subtleText }}>{group.description ?? ""}</p>

              {approved && <p style={{ marginTop: 14, ...subtleText, color: "#fff" }}>✅ Aprobado. Entrando…</p>}
              {pending && <p style={{ marginTop: 14, ...subtleText }}>✅ Solicitud enviada (pendiente).</p>}
              {!pending && !approved && !rejected && (
                <p style={{ marginTop: 14, ...subtleText }}>Este grupo es privado.</p>
              )}
              {rejected && <p style={{ marginTop: 14, ...subtleText, color: "#ff6b6b" }}>❌ Rechazado.</p>}

              <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {!pending && !rejected ? (
                  <button
                    onClick={handleRequestPrivate}
                    disabled={joining}
                    style={{
                      ...primaryButton,
                      opacity: joining ? 0.75 : 1,
                      cursor: joining ? "not-allowed" : "pointer",
                    }}
                  >
                    {joining ? "Enviando..." : "Solicitar acceso"}
                  </button>
                ) : (
                  <button
                    onClick={handleCancelPrivate}
                    disabled={joining}
                    style={{
                      ...secondaryButton,
                      opacity: joining ? 0.75 : 1,
                      cursor: joining ? "not-allowed" : "pointer",
                    }}
                  >
                    {joining ? "Cancelando..." : "Cancelar solicitud"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const offerings = Array.isArray(group.offerings) ? group.offerings : [];
  const enabledOfferings = offerings.filter((o) => (o as any).enabled !== false);

  const coverBg =
    group.coverUrl ||
    "data:image/svg+xml;base64," +
      btoa(`
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
      </svg>
    `);

  return (
    <>
      {isOwner && (
        <button
          type="button"
          style={{
            position: "fixed",
            right: 16,
            top: 92,
            height: 42,
            padding: "0 14px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(12,12,12,0.92)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            lineHeight: 1,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            zIndex: 20000,
            backdropFilter: "blur(10px)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            fontFamily: fontStack,
            letterSpacing: 0,
            WebkitFontSmoothing: "antialiased",
            MozOsxFontSmoothing: "grayscale",
            textRendering: "optimizeLegibility",
          }}
          title={adminOpen ? "Cerrar administración" : "Administrar"}
          onClick={() => setAdminOpen((v) => !v)}
        >
          <span style={{ fontWeight: 600, fontSize: 14, lineHeight: 1 }}>
            {adminOpen ? "Cerrar administración" : "Administrar"}
          </span>
          <span
            aria-hidden="true"
            style={{
              opacity: 0.88,
              fontWeight: 400,
              fontSize: 13,
              lineHeight: 1,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            ⚙
          </span>
        </button>
      )}

      <main style={pageWrap}>
        <div style={container}>
          <div style={cardStyle}>
            <div style={{ position: "relative", height: coverHeight, background: "#0b0b0b" }}>
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
                    "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.75) 85%, rgba(0,0,0,0.9) 100%)",
                }}
              />

              {isOwner && (
                <button
                  onClick={handlePickCover}
                  disabled={uploading}
                  type="button"
                  style={{
                    ...smallSecondaryButton,
                    position: "absolute",
                    right: 16,
                    top: 16,
                    opacity: uploading ? 0.7 : 1,
                    cursor: uploading ? "not-allowed" : "pointer",
                    zIndex: 3,
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
                      width: avatarSize,
                      height: avatarSize,
                      borderRadius: "50%",
                      overflow: "hidden",
                      border: "6px solid rgba(0,0,0,0.9)",
                      boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
                      display: "grid",
                      placeItems: "center",
                      background: "#0c0c0c",
                      userSelect: "none",
                      padding: 0,
                      margin: 0,
                      cursor: !isOwner || uploading ? "default" : "pointer",
                      pointerEvents: isOwner ? "auto" : "none",
                    }}
                    aria-label="Cambiar foto de perfil del grupo"
                    title={isOwner ? "Cambiar foto de perfil del grupo" : undefined}
                  >
                    {group.avatarUrl ? (
                      <img
                        src={group.avatarUrl}
                        alt="avatar"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <span
                        style={{
                          fontSize: 34,
                          fontWeight: 600,
                          color: "rgba(255,255,255,0.85)",
                          fontFamily: fontStack,
                        }}
                      >
                        {(group.name ?? "G").trim().slice(0, 2).toUpperCase()}
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
                        background: uploading ? "rgba(255,255,255,0.14)" : "rgba(12,12,12,0.92)",
                        color: "#fff",
                        cursor: uploading ? "not-allowed" : "pointer",
                        fontSize: 20,
                        fontWeight: 400,
                        display: "grid",
                        placeItems: "center",
                        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
                        backdropFilter: "blur(10px)",
                        zIndex: 200,
                        pointerEvents: "auto",
                        fontFamily: fontStack,
                      }}
                      title="Cambiar foto de perfil del grupo"
                      aria-label="Cambiar foto de perfil del grupo"
                    >
                      {uploading && cropMode === "avatar" ? "⚙" : "✎"}
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
                      fontSize: 22,
                      fontWeight: 600,
                      lineHeight: 1.15,
                      letterSpacing: 0,
                    }}
                  >
                    {group.name ?? ""}
                  </div>

                  {!!group.description && (
                    <div
                      style={{
                        marginTop: 10,
                        maxWidth: 720,
                        fontSize: 14,
                        fontWeight: 400,
                        lineHeight: 1.45,
                        color: "rgba(255,255,255,0.78)",
                      }}
                    >
                      {group.description}
                    </div>
                  )}

                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 13,
                      fontWeight: 400,
                      color: "rgba(255,255,255,0.72)",
                    }}
                  >
                    {visibilityLabel(String(group.visibility ?? ""))}
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 18,
                  borderTop: "1px solid rgba(255,255,255,0.10)",
                  paddingTop: 16,
                  display: "grid",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {isOwner && <JoinRequestsPanel groupId={groupId} />}

                  {!isOwner && !effectiveIsMember && visibility === "public" && (
                    <button
                      onClick={handleJoinPublic}
                      disabled={joining}
                      style={{
                        ...primaryButton,
                        opacity: joining ? 0.75 : 1,
                        cursor: joining ? "not-allowed" : "pointer",
                      }}
                    >
                      {joining ? "Uniéndote..." : "Unirme"}
                    </button>
                  )}

                  {!isOwner && effectiveIsMember && (
                    <button
                      onClick={handleLeave}
                      disabled={leaving}
                      style={{
                        ...secondaryButton,
                        opacity: leaving ? 0.75 : 1,
                        cursor: leaving ? "not-allowed" : "pointer",
                      }}
                    >
                      {leaving ? "Saliendo..." : "Salir"}
                    </button>
                  )}
                </div>

                {isOwner && user && group.ownerId ? (
                  <OwnerAdminPanel
                    groupId={groupId}
                    ownerId={group.ownerId}
                    currentUserId={user.uid}
                    currentAvatarUrl={group.avatarUrl ?? null}
                    currentCoverUrl={group.coverUrl ?? null}
                    currentName={group.name ?? null}
                    currentDescription={group.description ?? null}
                    currentCategory={group.category ?? null}
                    currentTags={group.tags ?? null}
                    isOpen={adminOpen}
                    onClose={() => setAdminOpen(false)}
                  />
                ) : null}

                {error && (
                  <div
                    style={{
                      ...messageBox,
                      marginTop: 6,
                      textAlign: "center",
                      color: "#ff6b6b",
                    }}
                  >
                    {error}
                  </div>
                )}

                {!isOwner && effectiveIsMember && enabledOfferings.length > 0 && (
                  <section
                    style={{
                      marginTop: 6,
                      border: "1px solid rgba(255,255,255,0.14)",
                      borderRadius: 16,
                      padding: 14,
                      background: "rgba(255,255,255,0.03)",
                      maxWidth: 640,
                      marginLeft: "auto",
                      marginRight: "auto",
                      boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 22, marginBottom: 6 }}>
                      Comprar al creador
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.72)", marginBottom: 12 }}>
                      (MVP sin pagos) Envías una solicitud al creador. El creador podrá aceptarla o rechazarla.
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      {enabledOfferings.map((o: any) => {
                        const t = String(o.type ?? "");
                        const label = labelForOfferingType(t);
                        const priceText = o.price != null && o.currency ? ` — ${o.currency} ${o.price}` : "";
                        const disabled = !isGreetingType(t);

                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => {
                              if (!isGreetingType(t)) return;
                              openGreetingForm(t);
                            }}
                            disabled={disabled}
                            style={{
                              ...secondaryButton,
                              textAlign: "left",
                              opacity: disabled ? 0.55 : 0.95,
                              cursor: disabled ? "not-allowed" : "pointer",
                            }}
                            title={disabled ? "Tipo de servicio no soportado en MVP" : undefined}
                          >
                            Solicitar {label}
                            {priceText}
                          </button>
                        );
                      })}
                    </div>

                    {greetOpen && (
                      <div
                        style={{
                          marginTop: 14,
                          padding: 12,
                          borderRadius: 12,
                          border: "1px solid rgba(255,255,255,0.14)",
                          background: "rgba(0,0,0,0.35)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            alignItems: "center",
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 22 }}>
                            Solicitar {labelForOfferingType(greetType)}
                          </div>
                          <button
                            type="button"
                            onClick={closeGreetingForm}
                            disabled={greetSubmitting}
                            style={{
                              ...secondaryButton,
                              padding: "8px 10px",
                            }}
                          >
                            Cerrar
                          </button>
                        </div>

                        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: "#fff" }}>
                              ¿A quién va dirigido?
                            </span>
                            <input
                              value={toName}
                              onChange={(e) => setToName(e.target.value)}
                              placeholder="Ej. Para Juan"
                              disabled={greetSubmitting}
                              style={inputStyle}
                            />
                          </label>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: "#fff" }}>
                              Contexto / instrucciones
                            </span>
                            <textarea
                              value={instructions}
                              onChange={(e) => setInstructions(e.target.value)}
                              placeholder="Ej. Cumpleaños, felicitación por logro, tono del mensaje, etc."
                              disabled={greetSubmitting}
                              rows={5}
                              style={{
                                ...inputStyle,
                                resize: "vertical",
                              }}
                            />
                          </label>

                          {greetError && <div style={{ ...messageBox, color: "#ff6b6b" }}>{greetError}</div>}
                          {greetSuccess && <div style={messageBox}>{greetSuccess}</div>}

                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={submitGreetingRequest}
                              disabled={greetSubmitting}
                              style={{
                                ...primaryButton,
                                opacity: greetSubmitting ? 0.75 : 1,
                                cursor: greetSubmitting ? "not-allowed" : "pointer",
                              }}
                            >
                              {greetSubmitting ? "Enviando..." : "Enviar solicitud"}
                            </button>

                            <button
                              type="button"
                              onClick={closeGreetingForm}
                              disabled={greetSubmitting}
                              style={{
                                ...secondaryButton,
                                opacity: greetSubmitting ? 0.75 : 1,
                                cursor: greetSubmitting ? "not-allowed" : "pointer",
                              }}
                            >
                              Cancelar
                            </button>
                          </div>

                          <div style={microText}>
                            Nota: el creador podrá aceptar o rechazar tu solicitud. (Pagos y entrega de video se integran después.)
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
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
              background: "rgba(12,12,12,0.92)",
              border: "1px solid rgba(255,255,255,0.22)",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
              color: "#fff",
              backdropFilter: "blur(10px)",
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
                background: "rgba(255,255,255,0.06)",
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 600, color: "#fff", lineHeight: 1.15 }}>
                {cropMode === "avatar" ? "Recortar foto de perfil del grupo" : "Recortar portada del grupo"}
              </div>
              <button
                type="button"
                onClick={() => !uploading && setCropOpen(false)}
                style={{
                  ...secondaryButton,
                  padding: "8px 10px",
                  opacity: uploading ? 0.6 : 1,
                  cursor: uploading ? "not-allowed" : "pointer",
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
                <label style={{ color: "#fff", fontWeight: 500, fontSize: 13 }}>Zoom</label>
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
                      ...secondaryButton,
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
                      ...primaryButton,
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

              <div style={{ marginTop: 10, ...microText }}>
                Tip: mueve la imagen para encuadrar. {cropMode === "avatar" ? "Avatar 1:1" : "Portada 16:9"}.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}