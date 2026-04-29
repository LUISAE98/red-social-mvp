"use client";

import {
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
  doc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
  collection,
  onSnapshot,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { onAuthStateChanged } from "firebase/auth";
import CreatorServicesMenu from "@/components/services/CreatorServicesMenu";
import CreatorServiceModals from "@/components/services/CreatorServiceModals";
import DonationAccessButton from "@/components/services/DonationAccessButton";

import {
  createGreetingRequest,
  type GreetingType,
} from "@/lib/greetings/greetingRequests";
import { createMeetGreetRequest } from "@/lib/meetGreet/meetGreetRequests";
import { createExclusiveSessionRequest } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import { getServiceByType } from "@/lib/services/normalizeServices";
import type { CreatorServiceType, Currency } from "@/types/group";
import Cropper from "react-easy-crop";

import { auth, db, storage } from "@/lib/firebase";
import ProfilePostsFeed from "./components/ProfilePostsFeed";
import ProfileSubnav, {
  type ProfileTabKey,
} from "./components/ProfileSubnav/ProfileSubnav";
import ProfileGroupsTab from "./components/ProfileSubnav/ProfileGroupsTab";
import ProfileSettingsTab from "./components/ProfileSubnav/ProfileSettingsTab";
import ProfileServicesTab from "./components/ProfileSubnav/ProfileServicesTab";

type FirestoreDateLike =
  | string
  | Date
  | {
      toDate?: () => Date;
    }
  | null
  | undefined;

type UserDoc = {
  uid: string;
  handle: string;
  displayName: string;
  firstName: string;
  lastName: string;
  age?: number;
  birthDate?: FirestoreDateLike;
  createdAt?: FirestoreDateLike;
  sex: string;
  photoURL: string | null;
  coverUrl?: string | null;
  showPosts?: boolean;
  showCreatedGroups?: boolean;
  profileRestricted?: boolean;
  profileGreeting?: {
    enabled: boolean;
    price: number | null;
    currency: "MXN" | "USD" | null;
  };
  offerings?: any[] | null;
  donation?: any | null;
  monetization?: any | null;
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

function normalizeDateValue(value?: FirestoreDateLike): string | Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate();
  }
  if (typeof value === "string") return value;
  return null;
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
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

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
  const [savingProfileRestricted, setSavingProfileRestricted] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [avatarRenderUrl, setAvatarRenderUrl] = useState<string | null>(null);
  const [coverRenderUrl, setCoverRenderUrl] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ProfileTabKey>("posts");
  const [greetOpen, setGreetOpen] = useState(false);
const [greetSubmitting, setGreetSubmitting] = useState(false);
const [greetType, setGreetType] = useState<GreetingType>("saludo");
const [toName, setToName] = useState("");
const [instructions, setInstructions] = useState("");
const [greetError, setGreetError] = useState<string | null>(null);
const [greetSuccess, setGreetSuccess] = useState<string | null>(null);

const [meetGreetOpen, setMeetGreetOpen] = useState(false);
const [meetGreetSubmitting, setMeetGreetSubmitting] = useState(false);
const [meetGreetMessage, setMeetGreetMessage] = useState("");
const [meetGreetError, setMeetGreetError] = useState<string | null>(null);

const [exclusiveSessionOpen, setExclusiveSessionOpen] = useState(false);
const [exclusiveSessionSubmitting, setExclusiveSessionSubmitting] = useState(false);
const [exclusiveSessionMessage, setExclusiveSessionMessage] = useState("");
const [exclusiveSessionError, setExclusiveSessionError] = useState<string | null>(null);

const [serviceToast, setServiceToast] = useState<string | null>(null);

  const [cropOpen, setCropOpen] = useState(false);
  const [cropMode, setCropMode] = useState<CropMode>("avatar");
  const [cropImageSrc, setCropImageSrc] = useState<string>("");

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const cropAspect = cropMode === "avatar" ? 1 / 1 : 16 / 9;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const isOwner = !!viewer && !!userDoc && viewer.uid === userDoc.uid;

  const ownerShowPosts = userDoc?.showPosts ?? true;
  const ownerShowGroups = userDoc?.showCreatedGroups ?? true;
  const profileRestricted = userDoc?.profileRestricted ?? false;

  const isProfileRestrictedForVisitor = !isOwner && profileRestricted;

  const visitorCanSeePosts =
    !isProfileRestrictedForVisitor && (userDoc?.showPosts ?? true);

  const visitorCanSeeGroups = userDoc?.showCreatedGroups ?? true;

  const showPostsTab = isOwner ? true : visitorCanSeePosts;
  const showGroupsTab = isOwner ? true : visitorCanSeeGroups;

  const shouldShowSubnav = isOwner ? true : showPostsTab || showGroupsTab;

  useEffect(() => {
    if (!userDoc) return;

    if (isOwner) {
      if (
        activeTab === "posts" ||
        activeTab === "groups" ||
        activeTab === "services" ||
        activeTab === "settings"
      ) {
        return;
      }
      setActiveTab("posts");
      return;
    }

    if (!showPostsTab && !showGroupsTab) {
      if (activeTab !== "posts") {
        setActiveTab("posts");
      }
      return;
    }

    if (activeTab === "posts" && !showPostsTab && showGroupsTab) {
      setActiveTab("groups");
      return;
    }

    if (activeTab === "groups" && !showGroupsTab && showPostsTab) {
      setActiveTab("posts");
      return;
    }

    if (activeTab === "services" || activeTab === "settings") {
      setActiveTab(showPostsTab ? "posts" : "groups");
    }
  }, [activeTab, isOwner, showPostsTab, showGroupsTab, userDoc]);

  function redirectToLogin() {
    router.push(`/login?next=${encodeURIComponent(pathname || `/u/${handle}`)}`);
  }

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
    } as CSSProperties,
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
    } as CSSProperties,
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
    } as CSSProperties,
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
    } as CSSProperties,
    label: {
      fontSize: ui.label,
      fontWeight: 500,
      lineHeight: 1.3,
      color: "#fff",
    } as CSSProperties,
    message: {
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      fontSize: ui.micro,
      lineHeight: 1.45,
    } as CSSProperties,
    title: {
      fontSize: ui.title,
      fontWeight: 600,
      lineHeight: 1.16,
      color: "#fff",
      letterSpacing: 0,
    } as CSSProperties,
    subtitle: {
      fontSize: ui.subtitle,
      fontWeight: 600,
      lineHeight: 1.2,
      color: "#fff",
      letterSpacing: 0,
    } as CSSProperties,
    microText: {
      fontSize: ui.micro,
      fontWeight: 400,
      lineHeight: 1.4,
      color: "rgba(255,255,255,0.70)",
    } as CSSProperties,
    ctaCard: {
      maxWidth: 640,
      margin: "18px auto 0",
      borderRadius: ui.panelRadius,
      border: ui.borderFaint,
      background: ui.panelBg,
      padding: 14,
    } as CSSProperties,
    tabPlaceholder: {
      borderRadius: 18,
      border: ui.borderSoft,
      background: ui.cardBg,
      boxShadow: ui.shadow,
      backdropFilter: "blur(10px)",
      padding: 18,
      width: "100%",
      minWidth: 0,
      overflow: "hidden",
      boxSizing: "border-box",
    } as CSSProperties,
    tabContentWrap: {
      width: "100%",
      minWidth: 0,
      overflow: "hidden",
      boxSizing: "border-box",
    } as CSSProperties,
  };

  function closeServiceQueryParam() {
  router.replace(pathname || `/u/${handle}`, { scroll: false });
}

function formatMoney(value: number, currency: Currency) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function getProfileService(type: CreatorServiceType) {
  return getServiceByType(userDoc?.offerings ?? null, type, "profile");
}

function getServicePriceLabel(type: CreatorServiceType) {
  const service = getProfileService(type);
  const price = service?.publicPrice ?? service?.memberPrice ?? null;
  const currency = service?.currency ?? "MXN";

  if (typeof price !== "number") return "Precio por confirmar";
  return formatMoney(price, currency);
}

function getServiceDurationLabel(type: CreatorServiceType) {
  const raw = getProfileService(type) as any;
  const minutes = raw?.durationMinutes ?? raw?.duration ?? null;

  if (typeof minutes !== "number") return "Duración por confirmar";
  return `${minutes} min`;
}

function resetGreetingModal() {
  setGreetOpen(false);
  setGreetSubmitting(false);
  setGreetError(null);
  setGreetSuccess(null);
  setToName("");
  setInstructions("");
}

function resetMeetGreetModal() {
  setMeetGreetOpen(false);
  setMeetGreetSubmitting(false);
  setMeetGreetError(null);
  setMeetGreetMessage("");
}

function resetExclusiveSessionModal() {
  setExclusiveSessionOpen(false);
  setExclusiveSessionSubmitting(false);
  setExclusiveSessionError(null);
  setExclusiveSessionMessage("");
}

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setViewer(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
  if (!handle) return;

  let unsubProfile: (() => void) | null = null;
  let cancelled = false;

  async function subscribeProfile() {
    setLoading(true);
    setMsg(null);

    try {
      const hq = query(
        collection(db, "handles"),
        where("__name__", "==", handle),
        limit(1)
      );

      const hs = await getDocs(hq);

      if (cancelled) return;

      if (hs.empty) {
        setUserDoc(null);
        setMsg("No existe este usuario.");
        setLoading(false);
        return;
      }

      const hdata = hs.docs[0].data() as any;
      const uid = hdata?.uid as string;

      if (!uid) {
        setUserDoc(null);
        setMsg("Handle inválido.");
        setLoading(false);
        return;
      }

      const uref = doc(db, "users", uid);

      unsubProfile = onSnapshot(
        uref,
        (usnap) => {
          if (!usnap.exists()) {
            setUserDoc(null);
            setMsg("Perfil no encontrado.");
            setLoading(false);
            return;
          }

          setUserDoc({
            uid,
            ...(usnap.data() as Omit<UserDoc, "uid">),
          });

          setMsg(null);
          setLoading(false);
        },
        (error) => {
          setUserDoc(null);
          setMsg(error?.message ?? "Error cargando perfil");
          setLoading(false);
        }
      );
    } catch (e: any) {
      if (cancelled) return;

      setMsg(e?.message ?? "Error cargando perfil");
      setUserDoc(null);
      setLoading(false);
    }
  }

  subscribeProfile();

  return () => {
    cancelled = true;
    if (unsubProfile) unsubProfile();
  };
}, [handle]);

  useEffect(() => {
  if (!authReady || !userDoc) return;

  const service = searchParams.get("service") as CreatorServiceType | null;
  if (!service) return;

  if (!viewer) {
    redirectToLogin();
    return;
  }

  if (viewer.uid === userDoc.uid) {
    setServiceToast("No puedes solicitar tus propios servicios.");
    closeServiceQueryParam();
    return;
  }

  if (service === "saludo" || service === "consejo") {
    setGreetType(service);
    setGreetOpen(true);
    closeServiceQueryParam();
    return;
  }

  if (service === "meet_greet_digital") {
    setMeetGreetOpen(true);
    closeServiceQueryParam();
    return;
  }

  if (service === "clase_personalizada") {
    setExclusiveSessionOpen(true);
    closeServiceQueryParam();
  }
}, [authReady, searchParams, userDoc, viewer]);

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

  async function handleToggleProfileRestricted(nextValue: boolean) {
    if (!userDoc || !isOwner) return;

    setSavingProfileRestricted(true);
    setMsg(null);

    try {
      const userRef = doc(db, "users", userDoc.uid);

      await updateDoc(userRef, {
        profileRestricted: nextValue,
      });

      setUserDoc((prev) =>
        prev ? { ...prev, profileRestricted: nextValue } : prev
      );

      if (nextValue && activeTab === "posts" && !isOwner && showGroupsTab) {
        setActiveTab("groups");
      }

      setMsg(
        nextValue
          ? "✅ Perfil reservado activado."
          : "✅ Perfil público activado."
      );
    } catch (e: any) {
      setMsg(
        e?.code === "permission-denied"
          ? "❌ Permiso denegado. Revisa reglas de Firestore."
          : `❌ No se pudo actualizar la privacidad del perfil: ${e?.message ?? "error"}`
      );
      throw e;
    } finally {
      setSavingProfileRestricted(false);
    }
  }

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

async function handleSubmitGreeting() {
  if (!userDoc || !viewer) return;

  setGreetSubmitting(true);
  setGreetError(null);
  setGreetSuccess(null);

  try {
    await createGreetingRequest({
      source: "profile",
      profileUserId: userDoc.uid,
      creatorId: userDoc.uid,
      groupId: null,
      type: greetType,
      toName,
      instructions,
    });

    setGreetOpen(false);
    setToName("");
    setInstructions("");
    setGreetSuccess(null);
    setServiceToast("Solicitud enviada al creador.");
  } catch (e: any) {
    setGreetError(e?.message ?? "No se pudo enviar la solicitud.");
  } finally {
    setGreetSubmitting(false);
  }
}
async function handleSubmitMeetGreet() {
  if (!userDoc || !viewer) return;

  setMeetGreetSubmitting(true);
  setMeetGreetError(null);

  try {
    const service = getProfileService("meet_greet_digital");

    await createMeetGreetRequest({
      source: "profile",
      profileUserId: userDoc.uid,
      creatorId: userDoc.uid,
      groupId: null,
      buyerMessage: meetGreetMessage,
      priceSnapshot: service?.publicPrice ?? service?.memberPrice ?? null,
      durationMinutes: (service as any)?.durationMinutes ?? null,
    });

    setMeetGreetOpen(false);
    setMeetGreetMessage("");
    setServiceToast("Solicitud de meet & greet enviada.");
  } catch (e: any) {
    setMeetGreetError(e?.message ?? "No se pudo enviar la solicitud.");
  } finally {
    setMeetGreetSubmitting(false);
  }
}

async function handleSubmitExclusiveSession() {
  if (!userDoc || !viewer) return;

  setExclusiveSessionSubmitting(true);
  setExclusiveSessionError(null);

  try {
    const service = getProfileService("clase_personalizada");

    await createExclusiveSessionRequest({
      source: "profile",
      profileUserId: userDoc.uid,
      creatorId: userDoc.uid,
      groupId: null,
      buyerMessage: exclusiveSessionMessage,
      priceSnapshot: service?.publicPrice ?? service?.memberPrice ?? null,
      durationMinutes: (service as any)?.durationMinutes ?? null,
    });

    setExclusiveSessionOpen(false);
    setExclusiveSessionMessage("");
    setServiceToast("Solicitud de sesión exclusiva enviada.");
  } catch (e: any) {
    setExclusiveSessionError(e?.message ?? "No se pudo enviar la solicitud.");
  } finally {
    setExclusiveSessionSubmitting(false);
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
        <div style={{ maxWidth: ui.pageMaxWidth, margin: "0 auto", padding: "0" }}>
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
        <div style={{ maxWidth: ui.pageMaxWidth, margin: "0 auto", padding: "0" }}>
          {msg ?? "Perfil no disponible"}
        </div>
      </main>
    );
  }

  const fullName =
    userDoc.displayName || `${userDoc.firstName} ${userDoc.lastName}`.trim();

  const profileVisibilityLabel = profileRestricted
    ? "Perfil reservado"
    : "Perfil público";

  const normalizedBirthDate = normalizeDateValue(userDoc.birthDate ?? null);
  const normalizedCreatedAt = normalizeDateValue(userDoc.createdAt ?? null);

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
            padding: 0;
            box-sizing: border-box;
            min-width: 0;
          }

          .profile-card {
            overflow: hidden;
            min-width: 0;
          }

          .profile-content {
            position: relative;
            padding: 0 18px 20px;
            min-width: 0;
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
            .profile-services-menu {
             margin-top: 18px;
          }

          .profile-services-menu-inline {
             width: auto !important;
             padding: 0 !important;
            }

            @media (max-width: 640px) {
            .profile-services-menu {
            margin-top: 16px;
           }
         }

          .profile-actions-wrap {
            margin-top: 18px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 14px;
            display: grid;
            gap: 12px;
          }

          .profile-actions-row {
            display: flex;
            justify-content: center;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
          }

          .profile-tab-content {
            width: 100%;
            min-width: 0;
            overflow: hidden;
            box-sizing: border-box;
          }

          .profile-tab-panel {
            width: 100%;
            min-width: 0;
            overflow: hidden;
            box-sizing: border-box;
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

            .profile-handle {
              font-size: 14px;
            }

            .profile-actions-row > button {
              width: 100%;
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
              <DonationAccessButton
  donation={userDoc.donation ?? null}
  disabled={!viewer}
  onClick={() => {
    if (!viewer) {
      redirectToLogin();
      return;
    }

    if (isOwner) {
      setServiceToast("No puedes donar a tu propio perfil.");
      return;
    }

    router.push(`/u/${userDoc.handle}?service=donacion`);
  }}
  style={{
    position: "absolute",
    left: 18,
    top: 18,
    zIndex: 30,
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

                  <div className="profile-visibility">{profileVisibilityLabel}</div>
                 {!isProfileRestrictedForVisitor ? (
  <div
    className="profile-services-menu"
    style={{
      width: "100%",
      display: "flex",
      justifyContent: "center",
      alignItems: "flex-start",
      gap: "clamp(14px, 4vw, 28px)",
      flexWrap: "wrap",
    }}
  >

    <CreatorServicesMenu
      services={userDoc.offerings ?? []}
      contextType="profile"
      profileUid={userDoc.uid}
      creatorHandle={userDoc.handle}
      viewerCanRequest={true}
      className="profile-services-menu-inline"
    />
  </div>
) : null}
                </div>
              </div>

              {authReady && !viewer && (
                <div className="profile-actions-wrap">
                  <div style={styles.ctaCard}>
                    <div
                      style={{
                        ...styles.microText,
                        color: "rgba(255,255,255,0.82)",
                        textAlign: "center",
                      }}
                    >
                      Puedes ver este perfil públicamente. Inicia sesión para
                      interactuar, seguir explorando y usar funciones completas.
                    </div>

                    <div className="profile-actions-row" style={{ marginTop: 14 }}>
                      <button
                        type="button"
                        onClick={redirectToLogin}
                        style={styles.buttonPrimary}
                      >
                        Iniciar sesión
                      </button>
                    </div>
                  </div>
                </div>
              )}

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
            </div>
          </div>

          {shouldShowSubnav && (
            <div style={{ marginTop: 12 }}>
              <ProfileSubnav
                activeTab={activeTab}
                onChange={setActiveTab}
                isOwner={isOwner}
                showPostsTab={showPostsTab}
                showGroupsTab={showGroupsTab}
                showServicesTab={isOwner}
                showSettingsTab={isOwner}
              />
            </div>
          )}

          <div className="profile-tab-content" style={styles.tabContentWrap}>
            {(isOwner || showPostsTab || isProfileRestrictedForVisitor) &&
              activeTab === "posts" && (
                <div className="profile-tab-panel">
                  <ProfilePostsFeed
                    profileUid={userDoc.uid}
                    viewerUid={viewer?.uid ?? null}
                    isOwner={isOwner}
                    showPosts={isOwner ? ownerShowPosts : visitorCanSeePosts}
                  />
                </div>
              )}

            {(isOwner || showGroupsTab) && activeTab === "groups" && (
              <div className="profile-tab-panel">
                <ProfileGroupsTab
                  profileUid={userDoc.uid}
                  isOwner={isOwner}
                  isViewerLoggedIn={!!viewer}
                  canViewerSeeGroups={isOwner ? true : visitorCanSeeGroups}
                  groupsVisibleToVisitors={ownerShowGroups}
                  onGroupsVisibilityChanged={(value) => {
                    setUserDoc((prev) =>
                      prev ? { ...prev, showCreatedGroups: value } : prev
                    );

                    if (!value && !ownerShowPosts && activeTab === "groups") {
                      setActiveTab("settings");
                    }
                  }}
                />
              </div>
            )}

            {activeTab === "services" && isOwner && (
              <section
                className="profile-tab-panel"
                style={{ ...styles.tabPlaceholder, marginTop: 12 }}
              >
                <ProfileServicesTab
  profileUserId={userDoc.uid}
  currentUserId={viewer.uid}
  currentOfferings={userDoc.offerings ?? null}
  currentDonation={userDoc.donation ?? null}
  onProfileServicesChanged={(payload) => {
    setUserDoc((prev) =>
      prev
        ? {
            ...prev,
            offerings:
              payload.offerings !== undefined
                ? payload.offerings
                : prev.offerings,
            donation:
              payload.donation !== undefined
                ? payload.donation
                : prev.donation,
          }
        : prev
    );
  }}
/>
              </section>
            )}

            {activeTab === "settings" && isOwner && (
              <section
                className="profile-tab-panel"
                style={{ ...styles.tabPlaceholder, marginTop: 12 }}
              >
                <ProfileSettingsTab
                  isSaving={savingProfileRestricted}
                  isRestricted={profileRestricted}
                  onToggleRestricted={handleToggleProfileRestricted}
                  displayName={fullName}
                  username={userDoc.handle}
                  birthDate={normalizedBirthDate}
                  appCreatedAt={normalizedCreatedAt}
                />
              </section>
            )}
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

<CreatorServiceModals
  greetOpen={greetOpen}
  greetSubmitting={greetSubmitting}
  greetType={greetType}
  toName={toName}
  instructions={instructions}
  greetError={greetError}
  greetSuccess={greetSuccess}
  onCloseGreeting={resetGreetingModal}
  onSubmitGreeting={handleSubmitGreeting}
  onChangeToName={setToName}
  onChangeInstructions={setInstructions}
  meetGreetOpen={meetGreetOpen}
  meetGreetSubmitting={meetGreetSubmitting}
  meetGreetMessage={meetGreetMessage}
  meetGreetError={meetGreetError}
  meetGreetPriceLabel={getServicePriceLabel("meet_greet_digital")}
  meetGreetDurationLabel={getServiceDurationLabel("meet_greet_digital")}
  onCloseMeetGreet={resetMeetGreetModal}
  onSubmitMeetGreet={handleSubmitMeetGreet}
  onChangeMeetGreetMessage={setMeetGreetMessage}
  exclusiveSessionOpen={exclusiveSessionOpen}
  exclusiveSessionSubmitting={exclusiveSessionSubmitting}
  exclusiveSessionMessage={exclusiveSessionMessage}
  exclusiveSessionError={exclusiveSessionError}
  exclusiveSessionPriceLabel={getServicePriceLabel("clase_personalizada")}
  exclusiveSessionDurationLabel={getServiceDurationLabel("clase_personalizada")}
  onCloseExclusiveSession={resetExclusiveSessionModal}
  onSubmitExclusiveSession={handleSubmitExclusiveSession}
  onChangeExclusiveSessionMessage={setExclusiveSessionMessage}
  serviceToast={serviceToast}
  subtitleStyle={styles.subtitle}
  textStyle={styles.microText}
  microText={styles.microText}
  labelStyle={styles.label}
  primaryButton={styles.buttonPrimary}
  secondaryButton={styles.buttonSecondary}
  panelStyle={{
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.14)",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.025))",
  boxShadow: "0 18px 48px rgba(0,0,0,0.48)",
  backdropFilter: "blur(12px)",
  padding: 18,
  width: "100%",
  minWidth: 0,
  overflow: "hidden",
  boxSizing: "border-box",
}}
  inputStyle={{
    width: "100%",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    padding: "10px 12px",
    fontSize: 14,
    fontFamily: fontStack,
    boxSizing: "border-box",
  }}
  messageBox={styles.message}
  serviceModalBackdropStyle={{
    position: "fixed",
    inset: 0,
    zIndex: 10000,
    background: "rgba(0,0,0,0.72)",
    display: "grid",
    placeItems: "center",
    padding: 14,
    fontFamily: fontStack,
  }}
  serviceModalCardStyle={{
  width: "min(720px, calc(100vw - 28px))",
  maxHeight: "calc(100dvh - 28px)",
  background:
    "linear-gradient(180deg, rgba(18,18,18,0.98), rgba(8,8,8,0.98))",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 18,
  overflow: "hidden",
  boxShadow: "0 24px 80px rgba(0,0,0,0.72)",
  color: "#fff",
  backdropFilter: "blur(14px)",
}}
  serviceToastStyle={{
    position: "fixed",
    left: "50%",
    bottom: "calc(24px + env(safe-area-inset-bottom))",
    transform: "translateX(-50%)",
    zIndex: 11000,
    maxWidth: "min(520px, calc(100vw - 28px))",
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(12,12,12,0.94)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    boxShadow: ui.shadow,
    backdropFilter: "blur(10px)",
  }}
  formatMoney={formatMoney}
/>

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