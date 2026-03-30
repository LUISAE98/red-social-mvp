"use client";

import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { joinGroup, leaveGroup } from "@/lib/groups/membership";
import { requestToJoin, cancelJoinRequest } from "@/lib/groups/joinRequests";
import OwnerAdminPanel from "./components/OwnerAdminPanel";
import GroupSubnav from "./components/GroupSubnav";
import GroupMembersTab from "./components/GroupMembersTab";
import GroupPostsFeed from "./components/posts/GroupPostsFeed";
import GroupRecommendationsRail from "@/app/components/GroupRecommendations/GroupRecommendationsRail";
import {
  createGreetingRequest,
  type GreetingType,
} from "@/lib/greetings/greetingRequests";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import Cropper from "react-easy-crop";

type JoinRequestStatus = "pending" | "approved" | "rejected" | string;
type MemberStatus =
  | "active"
  | "muted"
  | "banned"
  | "removed"
  | "kicked"
  | "expelled"
  | null;

type MemberRole = "owner" | "mod" | "member" | null;
type Currency = "MXN" | "USD";
type PostingMode = "members" | "owner_only";
type InteractionBlockedReason = "login" | "join" | "restricted" | null;

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
  postingMode?: PostingMode | string | null;
  commentsEnabled?: boolean | null;
  monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: string | Currency | null;
  } | null;
  settings?: {
    membersListVisibility?: "owner_only" | "members" | string;
  };
  permissions?: {
    postingMode?: PostingMode | string | null;
    commentsEnabled?: boolean | null;
  } | null;
  offerings?: Array<{
    type: "saludo" | "consejo" | "mensaje" | string;
    enabled?: boolean;
    price?: number | null;
    currency?: string | Currency | null;
  }> | null;
};

type CropMode = "avatar" | "cover";
type Area = { x: number; y: number; width: number; height: number };

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

function normalizeMemberStatus(raw: unknown): MemberStatus {
  if (raw === "active") return "active";
  if (raw === "muted") return "muted";
  if (raw === "banned") return "banned";
  if (raw === "removed") return "removed";
  if (raw === "kicked") return "kicked";
  if (raw === "expelled") return "expelled";
  return null;
}

function normalizeMemberRole(raw: unknown): MemberRole {
  if (raw === "owner") return "owner";
  if (raw === "mod") return "mod";
  if (raw === "moderator") return "mod";
  if (raw === "member") return "member";
  return null;
}

function normalizeCurrency(raw: unknown): Currency | null {
  if (raw === "MXN") return "MXN";
  if (raw === "USD") return "USD";
  return null;
}

function normalizePostingMode(raw: unknown): PostingMode {
  return raw === "owner_only" ? "owner_only" : "members";
}

function normalizeCommentsEnabled(raw: unknown): boolean {
  return raw !== false;
}

function isJoinedStatus(status: MemberStatus) {
  return status === "active" || status === "muted";
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

function visibilityLabel(v: string) {
  if (v === "public") return "Comunidad pública";
  if (v === "private") return "Comunidad privada";
  if (v === "hidden") return "Comunidad oculta";
  return v ? `Comunidad ${v}` : "";
}

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [isMember, setIsMember] = useState<boolean>(false);
  const [memberStatus, setMemberStatus] = useState<MemberStatus>(null);
  const [memberRole, setMemberRole] = useState<MemberRole>(null);
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

  const isModerator = useMemo(() => {
    if (isOwner) return false;
    return memberRole === "mod" && isJoinedStatus(memberStatus);
  }, [isOwner, memberRole, memberStatus]);

  const effectiveIsMember =
    isOwner || (isMember && isJoinedStatus(memberStatus));

  const currentPostingMode = useMemo(
    () =>
      normalizePostingMode(
        group?.permissions?.postingMode ?? group?.postingMode ?? "members"
      ),
    [group]
  );

  const currentCommentsEnabled = useMemo(
    () =>
      normalizeCommentsEnabled(
        group?.permissions?.commentsEnabled ?? group?.commentsEnabled ?? true
      ),
    [group]
  );

  const [greetOpen, setGreetOpen] = useState(false);
  const [greetType, setGreetType] = useState<GreetingType>("saludo");
  const [toName, setToName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [greetSubmitting, setGreetSubmitting] = useState(false);
  const [greetError, setGreetError] = useState<string | null>(null);
  const [greetSuccess, setGreetSuccess] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"feed" | "members" | "settings">(
    "feed"
  );

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

  const canMembersViewList =
    (group?.settings?.membersListVisibility ?? "owner_only") === "members";

  function redirectToLogin() {
    router.push(
      `/login?next=${encodeURIComponent(pathname || `/groups/${groupId}`)}`
    );
  }

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const ui = {
    pageMaxWidth: 1080,
    coverHeight: "clamp(190px, 35vw, 300px)",
    avatarSize: "clamp(112px, 22vw, 200px)",
    avatarOffsetTop: "clamp(-56px, -7vw, -72px)",
    cardRadius: 18,
    panelRadius: 14,
    buttonRadius: 12,
    buttonPadding: "11px 16px",
    inputPadding: "10px 12px",
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

  const pageWrap: React.CSSProperties = {
    minHeight: "calc(100dvh - 70px)",
    padding: "12px 0 calc(120px + env(safe-area-inset-bottom))",
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
    padding: "0",
    boxSizing: "border-box",
    minWidth: 0,
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: ui.cardRadius,
    overflow: "hidden",
    border: ui.borderSoft,
    background: ui.cardBg,
    boxShadow: ui.shadow,
    color: "#fff",
    backdropFilter: "blur(10px)",
    minWidth: 0,
  };

  const panelStyle: React.CSSProperties = {
    borderRadius: ui.panelRadius,
    border: ui.borderFaint,
    background: ui.panelBg,
    padding: 14,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: ui.title,
    fontWeight: 600,
    lineHeight: 1.2,
    color: "#fff",
    letterSpacing: 0,
    maxWidth: 620,
    textAlign: "center",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    padding: "0 16px",
    textShadow: "0 2px 14px rgba(0,0,0,0.45)",
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
    lineHeight: 1.5,
    color: "rgba(255,255,255,0.82)",
  };

  const microText: React.CSSProperties = {
    fontSize: ui.micro,
    fontWeight: 400,
    lineHeight: 1.45,
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
    border: "1px solid rgba(255,255,255,0.92)",
    background: "#fff",
    color: "#000",
    fontWeight: 700,
    fontSize: ui.body,
    lineHeight: 1.2,
    cursor: "pointer",
    fontFamily: fontStack,
    boxShadow: "0 10px 30px rgba(255,255,255,0.10)",
    minHeight: 42,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    transition: "all 160ms ease",
  };

  const secondaryButton: React.CSSProperties = {
    padding: ui.buttonPadding,
    borderRadius: ui.buttonRadius,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.07)",
    color: "#fff",
    fontWeight: 700,
    fontSize: ui.body,
    lineHeight: 1.2,
    cursor: "pointer",
    fontFamily: fontStack,
    backdropFilter: "blur(8px)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    minHeight: 42,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    transition: "all 160ms ease",
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
    borderRadius: 10,
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
    lineHeight: 1.45,
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
          setError("Comunidad no encontrada.");
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
        (msnap) => {
          if (!msnap.exists()) {
            setIsMember(false);
            setMemberStatus(null);
            setMemberRole(null);
            return;
          }

          const data = msnap.data() as any;
          const status = normalizeMemberStatus(data?.status ?? "active");
          const role = normalizeMemberRole(
            data?.roleInGroup ?? data?.role ?? "member"
          );

          setMemberStatus(status);
          setMemberRole(role);

          if (isJoinedStatus(status)) {
            setIsMember(true);
          } else {
            setIsMember(false);
          }
        },
        () => {
          setIsMember(false);
          setMemberStatus(null);
          setMemberRole(null);
        }
      );
    } else {
      setIsMember(false);
      setMemberStatus(null);
      setMemberRole(null);
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
    if (!user) {
      redirectToLogin();
      return;
    }

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
    if (!user) {
      redirectToLogin();
      return;
    }

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
    if (!user) {
      redirectToLogin();
      return;
    }

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
      setError("El owner no puede salir de su propia comunidad.");
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
      setGreetError("No puedes solicitar/comprar saludos en tu propia comunidad.");
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
      const rawUrl = await getDownloadURL(fileRef);
      const url = `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;

      const gref = doc(db, "groups", groupId);
      if (mode === "avatar") {
        await updateDoc(gref, { avatarUrl: url, updatedAt: Date.now() });
      } else {
        await updateDoc(gref, { coverUrl: url, updatedAt: Date.now() });
      }

      setCropOpen(false);
      setCropImageSrc("");
      setCroppedAreaPixels(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
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
            <div style={textStyle}>Cargando comunidad...</div>
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

  const normalizedCurrentMonetization = group.monetization
    ? {
        isPaid: group.monetization.isPaid,
        priceMonthly: group.monetization.priceMonthly ?? null,
        currency: normalizeCurrency(group.monetization.currency),
      }
    : null;

  const normalizedCurrentOfferings = offerings.map((o) => ({
    ...o,
    price: o.price ?? null,
    currency: normalizeCurrency(o.currency),
  }));

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

  const avatarNode = (
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
          aria-label="Avatar de la comunidad"
          title={isOwner ? "Cambiar avatar de la comunidad" : undefined}
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
                fontSize: "clamp(24px, 5vw, 34px)",
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
            title="Cambiar avatar de la comunidad"
            aria-label="Cambiar avatar de la comunidad"
          >
            {uploading && cropMode === "avatar" ? "..." : "✎"}
          </button>
        )}
      </div>
    </div>
  );

  const shouldShowRestrictedLanding =
    !isOwner &&
    !effectiveIsMember &&
    (visibility === "private" || visibility === "hidden");

  if (shouldShowRestrictedLanding) {
    const pending = joinReqStatus === "pending";
    const rejected = joinReqStatus === "rejected";
    const approved = joinReqStatus === "approved";
    const isBanned = memberStatus === "banned";
    const isPrivate = visibility === "private";
    const isHidden = visibility === "hidden";

    return (
      <main style={pageWrap}>
        <style jsx>{`
          .group-shell {
            width: 100%;
            padding: 0;
            box-sizing: border-box;
            min-width: 0;
          }

          .group-card {
            overflow: hidden;
            min-width: 0;
          }

          .group-content {
            position: relative;
            padding: 0 18px 20px;
            min-width: 0;
          }

          .group-header-copy {
            padding-top: 92px;
            position: relative;
            z-index: 1;
            min-height: 110px;
            min-width: 0;
          }

          .group-meta {
            display: grid;
            place-items: center;
            text-align: center;
            min-width: 0;
          }

          .group-description {
            margin-top: 8px;
            max-width: 620px;
            padding: 0 14px;
            word-break: break-word;
            overflow-wrap: anywhere;
          }

          .group-actions-wrap {
            margin-top: 18px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 14px;
            display: grid;
            gap: 12px;
            min-width: 0;
          }

          .group-actions-row {
            display: flex;
            justify-content: center;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
            min-width: 0;
          }

          .cta-card {
            max-width: 640px;
            margin: 0 auto;
            min-width: 0;
            width: 100%;
            box-sizing: border-box;
          }

          @media (min-width: 700px) {
            .group-header-copy {
              padding-top: 126px;
            }
          }

          @media (min-width: 1024px) {
            .group-header-copy {
              padding-top: 150px;
            }
          }

          @media (max-width: 900px) {
            .group-shell {
              max-width: none;
              padding: 0 8px;
            }
          }

          @media (max-width: 640px) {
            .group-shell {
              padding: 0 6px;
            }

            .group-content {
              padding: 0 12px 18px;
            }

            .group-actions-row > button {
              width: 100%;
            }
          }
        `}</style>

        <div style={container} className="group-shell">
          <section className="group-card" style={cardStyle}>
            <div
              style={{
                position: "relative",
                height: ui.coverHeight,
                background: "#0b0b0b",
              }}
            >
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

              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.52) 58%, rgba(0,0,0,0.88) 100%)",
                }}
              />
            </div>

            <div className="group-content">
              {avatarNode}

              <div className="group-header-copy">
                <div className="group-meta">
                  <h1 style={{ ...titleStyle, margin: 0 }}>{group.name ?? ""}</h1>

                  {!!group.description && (
                    <div className="group-description" style={textStyle}>
                      {group.description}
                    </div>
                  )}

                  <div style={{ marginTop: 8, ...microText }}>
                    {visibilityLabel(String(group.visibility ?? ""))}
                  </div>
                </div>
              </div>

              <div className="group-actions-wrap">
                <div style={{ ...panelStyle }} className="cta-card">
                  <div
                    style={{
                      ...microText,
                      color: "rgba(255,255,255,0.82)",
                      textAlign: "center",
                    }}
                  >
                    {isBanned && "🚫 Estás baneado de esta comunidad. No puedes ingresar."}
                    {!isBanned && approved && "✅ Aprobado. Entrando…"}
                    {!isBanned &&
                      isPrivate &&
                      pending &&
                      "✅ Solicitud enviada. Está pendiente de revisión."}
                    {!isBanned &&
                      isPrivate &&
                      !pending &&
                      !approved &&
                      !rejected &&
                      "Esta comunidad es privada. Puedes verla, pero necesitas aprobación para entrar."}
                    {!isBanned &&
                      isPrivate &&
                      rejected &&
                      "❌ Tu solicitud fue rechazada."}
                    {!isBanned &&
                      isHidden &&
                      "Esta comunidad es oculta. No tienes acceso en este momento."}
                  </div>

                  {!isBanned && isPrivate && (
                    <div className="group-actions-row" style={{ marginTop: 14 }}>
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
                          {joining
                            ? "Enviando..."
                            : user
                            ? "Solicitar acceso"
                            : "Iniciar sesión para solicitar acceso"}
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
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const isPublicGroup = visibility === "public";
  const canViewPublicFeed = isPublicGroup || effectiveIsMember || isOwner;

  const canCreatePosts =
    isOwner ||
    (effectiveIsMember &&
      memberStatus === "active" &&
      currentPostingMode === "members");

  const canCommentOnPosts =
    isOwner ||
    (effectiveIsMember &&
      memberStatus === "active" &&
      currentCommentsEnabled);

  let postBlockedReason: InteractionBlockedReason = null;
  let commentBlockedReason: InteractionBlockedReason = null;

  if (!canCreatePosts) {
    if (!user) {
      postBlockedReason = "login";
    } else if (
      memberStatus === "banned" ||
      memberStatus === "removed" ||
      memberStatus === "muted"
    ) {
      postBlockedReason = "restricted";
    } else if (!effectiveIsMember) {
      postBlockedReason = "join";
    } else {
      postBlockedReason = "restricted";
    }
  }

  if (!canCommentOnPosts) {
    if (!user) {
      commentBlockedReason = "login";
    } else if (
      memberStatus === "banned" ||
      memberStatus === "removed" ||
      memberStatus === "muted"
    ) {
      commentBlockedReason = "restricted";
    } else if (!effectiveIsMember) {
      commentBlockedReason = "join";
    } else {
      commentBlockedReason = "restricted";
    }
  }

  return (
    <>
      <main style={pageWrap}>
        <style jsx>{`
          .group-shell {
            width: 100%;
            padding: 0;
            box-sizing: border-box;
            min-width: 0;
          }

          .group-card {
            overflow: hidden;
            min-width: 0;
          }

          .group-content {
            position: relative;
            padding: 0 18px 20px;
            min-width: 0;
          }

          .group-header-copy {
            padding-top: 92px;
            position: relative;
            z-index: 1;
            min-height: 110px;
            min-width: 0;
          }

          .group-meta {
            display: grid;
            place-items: center;
            text-align: center;
            min-width: 0;
          }

          .group-description {
            margin-top: 8px;
            max-width: 620px;
            padding: 0 14px;
            word-break: break-word;
            overflow-wrap: anywhere;
          }

          .group-visibility {
            margin-top: 10px;
          }

          .group-subnav-wrap {
            margin-top: 16px;
            width: 100%;
            max-width: 720px;
            margin-left: auto;
            margin-right: auto;
            min-width: 0;
          }

          .group-actions-wrap {
            margin-top: 18px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 14px;
            display: grid;
            gap: 12px;
            min-width: 0;
          }

          .group-actions-row {
            display: flex;
            justify-content: center;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
            min-width: 0;
          }

          .group-offerings-card {
            max-width: 620px;
            width: 100%;
            margin-left: auto;
            margin-right: auto;
            box-shadow: ${ui.shadow};
            min-width: 0;
            box-sizing: border-box;
          }

          .group-feed-wrap {
            width: 100%;
            max-width: 720px;
            margin: 0 auto;
            display: grid;
            gap: 12px;
            min-width: 0;
          }

          .group-feed-item {
            width: 100%;
            min-width: 0;
            max-width: 100%;
          }

          @media (min-width: 700px) {
            .group-header-copy {
              padding-top: 126px;
            }
          }

          @media (min-width: 1024px) {
            .group-header-copy {
              padding-top: 150px;
            }
          }

          @media (max-width: 900px) {
            .group-shell {
              max-width: none;
              padding: 0 8px;
            }
          }

          @media (max-width: 640px) {
            .group-shell {
              padding: 0 6px;
            }

            .group-content {
              padding: 0 12px 18px;
            }

            .group-actions-row > button {
              width: 100%;
            }

            .group-offerings-card {
              max-width: none;
            }

            .group-feed-wrap {
              max-width: none;
              width: 100%;
              min-width: 0;
            }

            .group-feed-item {
              width: 100%;
              min-width: 0;
              max-width: 100%;
            }

            .group-subnav-wrap {
              max-width: none;
            }
          }
        `}</style>

        <div style={container} className="group-shell">
          <section className="group-card" style={cardStyle}>
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

            <div className="group-content">
              {avatarNode}

              <div className="group-header-copy">
                <div className="group-meta">
                  <h1 style={{ ...titleStyle, margin: 0 }}>{group.name ?? ""}</h1>

                  {!!group.description && (
                    <div className="group-description" style={textStyle}>
                      {group.description}
                    </div>
                  )}

                  <div className="group-visibility" style={microText}>
                    {visibilityLabel(String(group.visibility ?? ""))}
                  </div>

                  {effectiveIsMember && (
                    <div className="group-subnav-wrap">
                      <GroupSubnav
                        activeTab={activeTab}
                        onChange={setActiveTab}
                        canManage={isOwner}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="group-actions-wrap">
                <div className="group-actions-row">
                  {!isOwner && !effectiveIsMember && visibility === "public" && (
                    <>
                      {memberStatus === "banned" ? (
                        <div
                          style={{
                            ...messageBox,
                            textAlign: "center",
                            border: "1px solid rgba(255,80,80,0.4)",
                            background: "rgba(255,80,80,0.08)",
                            color: "#ffb3b3",
                            fontWeight: 500,
                          }}
                        >
                          🚫 Estás baneado de esta comunidad
                        </div>
                      ) : (
                        <button
                          onClick={handleJoinPublic}
                          disabled={joining}
                          style={{
                            ...primaryButton,
                            opacity: joining ? 0.75 : 1,
                            cursor: joining ? "not-allowed" : "pointer",
                          }}
                        >
                          {joining
                            ? "Uniéndote..."
                            : user
                            ? "Unirme"
                            : "Iniciar sesión para unirme"}
                        </button>
                      )}
                    </>
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

                {!isOwner && effectiveIsMember && enabledOfferings.length > 0 && (
                  <section style={{ ...panelStyle }} className="group-offerings-card">
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
                            flexWrap: "wrap",
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
                            <span style={labelStyle}>¿A quién va dirigido?</span>
                            <input
                              value={toName}
                              onChange={(e) => setToName(e.target.value)}
                              placeholder="Ej. Para Juan"
                              disabled={greetSubmitting}
                              style={inputStyle}
                            />
                          </label>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={labelStyle}>Contexto / instrucciones</span>
                            <textarea
                              value={instructions}
                              onChange={(e) => setInstructions(e.target.value)}
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

                          {greetError && <div style={messageBox}>{greetError}</div>}
                          {greetSuccess && <div style={messageBox}>{greetSuccess}</div>}

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
                            Nota: el creador podrá aceptar o rechazar tu
                            solicitud. Pagos y entrega de video se integran después.
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {canViewPublicFeed && activeTab === "feed" && (
                  <section className="group-feed-wrap">
                    <div className="group-feed-item">
                      <GroupPostsFeed
                        groupId={groupId}
                        isOwner={isOwner}
                        isModerator={isModerator}
                        canCreatePosts={canCreatePosts}
                        canCommentOnPosts={canCommentOnPosts}
                        postBlockedReason={postBlockedReason}
                        commentBlockedReason={commentBlockedReason}
                      />
                    </div>

                    {user?.uid ? (
                      <div className="group-feed-item">
                        <GroupRecommendationsRail
                          currentUserId={user.uid}
                          context="group"
                        />
                      </div>
                    ) : null}
                  </section>
                )}

                {effectiveIsMember && activeTab === "members" && (
                  <GroupMembersTab
                    groupId={groupId}
                    isOwner={isOwner}
                    isModerator={isModerator}
                    canMembersViewList={canMembersViewList}
                  />
                )}

                {activeTab === "settings" && isOwner && user && group.ownerId && (
                  <OwnerAdminPanel
                    groupId={groupId}
                    ownerId={group.ownerId}
                    currentUserId={user.uid}
                    currentName={group.name ?? ""}
                    currentDescription={group.description ?? ""}
                    currentCategory={group.category ?? null}
                    currentTags={group.tags ?? []}
                    currentAvatarUrl={group.avatarUrl ?? null}
                    currentCoverUrl={group.coverUrl ?? null}
                    currentVisibility={group.visibility ?? null}
                    currentMonetization={normalizedCurrentMonetization}
                    currentOfferings={normalizedCurrentOfferings}
                    currentPostingMode={currentPostingMode}
                    currentCommentsEnabled={currentCommentsEnabled}
                  />
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
                flexWrap: "wrap",
              }}
            >
              <div style={subtitleStyle}>
                {cropMode === "avatar"
                  ? "Recortar avatar de la comunidad"
                  : "Recortar portada de la comunidad"}
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
                    flexWrap: "wrap",
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