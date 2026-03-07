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
import {
  createGreetingRequest,
  type GreetingType,
} from "@/lib/greetings/greetingRequests";
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
  const [joinReqStatus, setJoinReqStatus] =
    useState<JoinRequestStatus | null>(null);

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = useMemo(
    () => !!user && !!group?.ownerId && group.ownerId === user.uid,
    [user, group]
  );
  const effectiveIsMember = isOwner || isMember;

  const [greetOpen, setGreetOpen] = useState(false);
  const [greetType, setGreetType] = useState<GreetingType>("saludo");
  const [toName, setToName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [greetSubmitting, setGreetSubmitting] = useState(false);
  const [greetError, setGreetError] = useState<string | null>(null);
  const [greetSuccess, setGreetSuccess] = useState<string | null>(null);

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

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const ui = {
    pageMaxWidth: 860,
    coverHeight: 210,
    avatarSize: 210,
    avatarOffsetTop: -105,
    contentTopPadding: 128,
    cardRadius: 14,
    panelRadius: 12,
    buttonRadius: 9,
    buttonPadding: "8px 12px",
    inputPadding: "9px 11px",
    modalMaxWidth: 680,
    title: 18,
    subtitle: 16,
    body: 13,
    micro: 12,
    label: 12,
    shadow: "0 18px 48px rgba(0,0,0,0.55)",
    borderSoft: "1px solid rgba(255,255,255,0.18)",
    borderFaint: "1px solid rgba(255,255,255,0.12)",
    cardBg: "rgba(12,12,12,0.92)",
    panelBg: "rgba(255,255,255,0.03)",
  };

  const pageWrap: React.CSSProperties = {
    minHeight: "calc(100vh - 70px)",
    padding: "20px 14px 120px",
    background: "#000",
    color: "#fff",
    fontFamily: fontStack,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    textRendering: "optimizeLegibility",
  };

  const container: React.CSSProperties = {
    maxWidth: ui.pageMaxWidth,
    margin: "0 auto",
    width: "100%",
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: ui.cardRadius,
    overflow: "hidden",
    border: ui.borderSoft,
    background: ui.cardBg,
    boxShadow: ui.shadow,
    color: "#fff",
    backdropFilter: "blur(10px)",
  };

  const panelStyle: React.CSSProperties = {
    borderRadius: ui.panelRadius,
    border: ui.borderFaint,
    background: ui.panelBg,
    padding: 12,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: ui.title,
    fontWeight: 600,
    lineHeight: 1.16,
    color: "#fff",
    letterSpacing: 0,
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: ui.subtitle,
    fontWeight: 600,
    lineHeight: 1.2,
    color: "#fff",
    letterSpacing: 0,
  };

  const textStyle: React.CSSProperties = {
    fontSize: ui.body,
    fontWeight: 400,
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.82)",
  };

  const microText: React.CSSProperties = {
    fontSize: ui.micro,
    fontWeight: 400,
    lineHeight: 1.4,
    color: "rgba(255,255,255,0.70)",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: ui.label,
    fontWeight: 500,
    lineHeight: 1.3,
    color: "#fff",
  };

  const primaryButton: React.CSSProperties = {
    padding: ui.buttonPadding,
    borderRadius: ui.buttonRadius,
    border: "1px solid rgba(255,255,255,0.24)",
    background: "#fff",
    color: "#000",
    fontWeight: 600,
    fontSize: ui.body,
    lineHeight: 1.2,
    cursor: "pointer",
    fontFamily: fontStack,
  };

  const secondaryButton: React.CSSProperties = {
    padding: ui.buttonPadding,
    borderRadius: ui.buttonRadius,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.07)",
    color: "#fff",
    fontWeight: 600,
    fontSize: ui.body,
    lineHeight: 1.2,
    cursor: "pointer",
    fontFamily: fontStack,
    backdropFilter: "blur(8px)",
  };

  const tinyGhostButton: React.CSSProperties = {
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
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: ui.inputPadding,
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
    fontSize: ui.body,
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
  };

  const messageBox: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    fontSize: ui.micro,
    fontWeight: 400,
    color: "rgba(255,255,255,0.92)",
    lineHeight: 1.4,
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
      setGreetError(
        "Escribe el nombre de la persona a quien va dirigido el saludo."
      );
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

  const onCropComplete = useCallback(
    (_croppedArea: any, croppedAreaPixelsArg: any) => {
      setCroppedAreaPixels(croppedAreaPixelsArg as Area);
    },
    []
  );

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
      const blob = await getCroppedBlob(
        cropImageSrc,
        croppedAreaPixels,
        "image/jpeg"
      );

      const path =
        mode === "avatar"
          ? `groups/${groupId}/avatar/avatar.jpg`
          : `groups/${groupId}/cover/cover.jpg`;

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

  if (loading) {
    return (
      <main style={pageWrap}>
        <div style={container}>
          <div style={{ ...cardStyle, padding: 18 }}>
            <div style={textStyle}>Cargando grupo...</div>
          </div>
        </div>
      </main>
    );
  }

  if (error && !group) {
    return (
      <main style={pageWrap}>
        <div style={container}>
          <div style={{ ...cardStyle, padding: 18 }}>
            <div style={{ ...messageBox, color: "#fff" }}>{error}</div>
          </div>
        </div>
      </main>
    );
  }

  if (!group) return null;

  const visibility = group.visibility ?? "";
  const offerings = Array.isArray(group.offerings) ? group.offerings : [];
  const enabledOfferings = offerings.filter((o) => (o as any).enabled !== false);

  const coverBg =
    group.coverUrl ||
    "data:image/svg+xml;base64," +
      btoa(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600">
        <defs>
          <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stop-color="#070707"/>
            <stop offset="0.5" stop-color="#101010"/>
            <stop offset="1" stop-color="#151515"/>
          </linearGradient>
        </defs>
        <rect width="1600" height="600" fill="url(#g)"/>
        <circle cx="1240" cy="180" r="170" fill="#171717" opacity="0.7"/>
        <circle cx="1360" cy="280" r="230" fill="#0f0f0f" opacity="0.9"/>
      </svg>
    `);

  if (visibility === "private" && !effectiveIsMember) {
    const pending = joinReqStatus === "pending";
    const rejected = joinReqStatus === "rejected";
    const approved = joinReqStatus === "approved";

    return (
      <main style={pageWrap}>
        <div style={container}>
          <section style={cardStyle}>
            <div
              style={{
                position: "relative",
                height: ui.coverHeight,
                background: "#0b0b0b",
              }}
            >
              {group.coverUrl ? (
                <img
                  src={group.coverUrl}
                  alt="Cover"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    opacity: 0.96,
                  }}
                />
              ) : (
                <img
                  src={coverBg}
                  alt="Cover"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    opacity: 0.96,
                  }}
                />
              )}

              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.52) 58%, rgba(0,0,0,0.88) 100%)",
                }}
              />
            </div>

            <div style={{ padding: 16 }}>
              <div style={{ ...titleStyle, marginBottom: 8 }}>
                {group.name ?? ""}
              </div>

              {!!group.description && (
                <p style={{ ...textStyle, margin: 0 }}>{group.description}</p>
              )}

              <div style={{ ...panelStyle, marginTop: 14 }}>
                <div style={{ ...microText, color: "rgba(255,255,255,0.82)" }}>
                  {approved && "✅ Aprobado. Entrando…"}
                  {pending && "✅ Solicitud enviada. Está pendiente de revisión."}
                  {!pending && !approved && !rejected && "Este grupo es privado."}
                  {rejected && "❌ Tu solicitud fue rechazada."}
                </div>

                <div
                  style={{
                    marginTop: 12,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
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
          </section>
        </div>
      </main>
    );
  }

  return (
    <>
      {isOwner && (
        <button
          type="button"
          style={{
            position: "fixed",
            right: 14,
            top: 84,
            height: 36,
            padding: "0 12px",
            borderRadius: 9,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(12,12,12,0.92)",
            color: "#fff",
            fontWeight: 600,
            fontSize: ui.body,
            lineHeight: 1,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            zIndex: 20000,
            backdropFilter: "blur(10px)",
            boxShadow: ui.shadow,
            fontFamily: fontStack,
          }}
          title={adminOpen ? "Cerrar administración" : "Administrar"}
          onClick={() => setAdminOpen((v) => !v)}
        >
          <span>{adminOpen ? "Cerrar administración" : "Administrar"}</span>
          <span
            aria-hidden="true"
            style={{ opacity: 0.85, fontSize: ui.micro }}
          >
            ⚙
          </span>
        </button>
      )}

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

      <main style={pageWrap}>
        <div style={container}>
          <section style={cardStyle}>
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
                    ...tinyGhostButton,
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

            <div style={{ position: "relative", padding: "0 18px 18px" }}>
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
                    aria-label="Cambiar avatar del grupo"
                    title={isOwner ? "Cambiar avatar del grupo" : undefined}
                  >
                    {group.avatarUrl ? (
                      <img
                        src={group.avatarUrl}
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
                          fontSize: 34,
                          fontWeight: 600,
                          color: "rgba(255,255,255,0.88)",
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
                        right: 10,
                        bottom: 10,
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
                      title="Cambiar avatar del grupo"
                      aria-label="Cambiar avatar del grupo"
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
                    justifyItems: "center",
                    textAlign: "center",
                  }}
                >
                  <h1 style={{ ...titleStyle, margin: 0 }}>
                    {group.name ?? ""}
                  </h1>

                  {!!group.description && (
                    <div
                      style={{
                        marginTop: 8,
                        maxWidth: 600,
                        ...textStyle,
                      }}
                    >
                      {group.description}
                    </div>
                  )}

                  <div style={{ marginTop: 8, ...microText }}>
                    {visibilityLabel(String(group.visibility ?? ""))}
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 16,
                  borderTop: "1px solid rgba(255,255,255,0.10)",
                  paddingTop: 14,
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

                  {!isOwner &&
                    !effectiveIsMember &&
                    visibility === "public" && (
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

                {error && (
                  <div
                    style={{
                      ...messageBox,
                      textAlign: "center",
                    }}
                  >
                    {error}
                  </div>
                )}

                {!isOwner &&
                  effectiveIsMember &&
                  enabledOfferings.length > 0 && (
                    <section
                      style={{
                        ...panelStyle,
                        maxWidth: 560,
                        width: "100%",
                        marginLeft: "auto",
                        marginRight: "auto",
                        boxShadow: ui.shadow,
                      }}
                    >
                      <div style={{ ...subtitleStyle, marginBottom: 6 }}>
                        Comprar al creador
                      </div>

                      <div style={{ ...microText, marginBottom: 12 }}>
                        MVP sin pagos reales todavía. Envías una solicitud y el
                        creador podrá aceptarla o rechazarla.
                      </div>

                      <div style={{ display: "grid", gap: 10 }}>
                        {enabledOfferings.map((o: any) => {
                          const t = String(o.type ?? "");
                          const label = labelForOfferingType(t);
                          const priceText =
                            o.price != null && o.currency
                              ? ` — ${o.currency} ${o.price}`
                              : "";
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
                                opacity: disabled ? 0.55 : 1,
                                cursor: disabled ? "not-allowed" : "pointer",
                              }}
                              title={
                                disabled
                                  ? "Tipo de servicio no soportado en MVP"
                                  : undefined
                              }
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
                            ...panelStyle,
                            background: "rgba(255,255,255,0.035)",
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
                            <div style={subtitleStyle}>
                              Solicitar {labelForOfferingType(greetType)}
                            </div>

                            <button
                              type="button"
                              onClick={closeGreetingForm}
                              disabled={greetSubmitting}
                              style={secondaryButton}
                            >
                              Cerrar
                            </button>
                          </div>

                          <div
                            style={{
                              marginTop: 10,
                              display: "grid",
                              gap: 10,
                            }}
                          >
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={labelStyle}>
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
                              <span style={labelStyle}>
                                Contexto / instrucciones
                              </span>
                              <textarea
                                value={instructions}
                                onChange={(e) =>
                                  setInstructions(e.target.value)
                                }
                                placeholder="Ej. Cumpleaños, felicitación por logro, tono del mensaje, etc."
                                disabled={greetSubmitting}
                                rows={5}
                                style={{
                                  ...inputStyle,
                                  resize: "vertical",
                                  minHeight: 110,
                                }}
                              />
                            </label>

                            {greetError && (
                              <div style={{ ...messageBox }}>
                                {greetError}
                              </div>
                            )}
                            {greetSuccess && (
                              <div style={messageBox}>{greetSuccess}</div>
                            )}

                            <div
                              style={{
                                display: "flex",
                                gap: 10,
                                flexWrap: "wrap",
                              }}
                            >
                              <button
                                type="button"
                                onClick={submitGreetingRequest}
                                disabled={greetSubmitting}
                                style={{
                                  ...primaryButton,
                                  opacity: greetSubmitting ? 0.75 : 1,
                                  cursor: greetSubmitting
                                    ? "not-allowed"
                                    : "pointer",
                                }}
                              >
                                {greetSubmitting
                                  ? "Enviando..."
                                  : "Enviar solicitud"}
                              </button>

                              <button
                                type="button"
                                onClick={closeGreetingForm}
                                disabled={greetSubmitting}
                                style={{
                                  ...secondaryButton,
                                  opacity: greetSubmitting ? 0.75 : 1,
                                  cursor: greetSubmitting
                                    ? "not-allowed"
                                    : "pointer",
                                }}
                              >
                                Cancelar
                              </button>
                            </div>

                            <div style={microText}>
                              Nota: el creador podrá aceptar o rechazar tu
                              solicitud. Pagos y entrega de video se integran
                              después.
                            </div>
                          </div>
                        </div>
                      )}
                    </section>
                  )}
              </div>
            </div>
          </section>

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
              <div style={subtitleStyle}>
                {cropMode === "avatar"
                  ? "Recortar avatar del grupo"
                  : "Recortar portada del grupo"}
              </div>

              <button
                type="button"
                onClick={() => !uploading && setCropOpen(false)}
                style={{
                  ...secondaryButton,
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
                <label style={labelStyle}>Zoom</label>

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
                  }}
                >
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