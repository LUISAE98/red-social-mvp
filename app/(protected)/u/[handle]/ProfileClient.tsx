"use client";

import Image from "next/image";
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
import { onAuthStateChanged, sendPasswordResetEmail, type User } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { updateProfileDisplayName } from "@/lib/profile/updateProfileDisplayName";
import CreatorServicesMenu from "@/components/services/CreatorServicesMenu";
import CreatorServiceModals from "@/components/services/CreatorServiceModals";
import { buildCurrentPathWithSearch } from "@/lib/auth-redirect";
import CopyLinkButton from "@/components/ui/CopyLinkButton";
import {
  createGreetingRequest,
  type GreetingType,
} from "@/lib/greetings/greetingRequests";
import { createMeetGreetRequest } from "@/lib/meetGreet/meetGreetRequests";
import { createExclusiveSessionRequest } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import { getServiceByType, type NormalizedService } from "@/lib/services/normalizeServices";
import type { CreatorServiceType, Currency } from "@/types/group";
import SafeCropper from "@/components/media/SafeCropper";
import { auth, db, storage, functions } from "@/lib/firebase";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";
import ProfilePostsFeed from "./components/ProfilePostsFeed";
import ProfileSubnav, {
  type ProfileTabKey,
} from "./components/ProfileSubnav/ProfileSubnav";
import ProfileGroupsTab from "./components/ProfileSubnav/ProfileGroupsTab";
import ProfileSettingsTab from "./components/ProfileSubnav/ProfileSettingsTab";
import ProfileServicesTab from "./components/ProfileSubnav/ProfileServicesTab";
import ProfileSocialActions from "./components/ProfileSocialActions";
import ProfileMoreMenu from "./components/ProfileMoreMenu";
import DonationViewer from "./components/DonationViewer";
import SharedCommunitiesBadge from "./components/SharedCommunitiesBadge";
import ProfileFollowersOverlay from "./components/ProfileFollowersOverlay";
import GroupPostComposer from "@/app/groups/[groupId]/components/posts/GroupPostComposer";
import LiveComposerModal from "@/app/components/LiveComposer/LiveComposerModal";
import { createMediaPost, createTextPost } from "@/lib/posts/post-service";
import { uploadPostImages } from "@/lib/posts/image-upload";
import { clearAllPostFeedCaches } from "@/lib/posts/post-feed-cache";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import type { PostMedia, PostPremium } from "@/lib/posts/types";
import StoryCircles from "@/app/components/Stories/StoryCircles";
import { useStoryRingState } from "@/lib/stories/useStoryRingState";
import { recordStoryView } from "@/lib/stories/storyService";
import StoryViewer from "@/app/components/Stories/StoryViewer";
import { setLastVisitTimestamp } from "@/lib/utils/visitTimestamps";

type ProfileComposerMediaItem = {
  type: "image" | "video";
  file: File;
  coverFile?: File | null;
};

type ProfileComposerSubmitPayload = {
  text: string;
  contextType: "group" | "profile";
  imageFiles?: File[];
  videoFiles?: File[];
  mediaItems?: ProfileComposerMediaItem[];
  premium?: PostPremium | null;
};

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
  displayNameLastChangedAt?: FirestoreDateLike;
  birthDate?: FirestoreDateLike;
  createdAt?: FirestoreDateLike;
  sex: string;
  photoURL: string | null;
  coverUrl?: string | null;
  showPosts?: boolean;
  showCreatedGroups?: boolean;
  profileRestricted?: boolean;
  profileCommentsEnabled?: boolean;
  bio?: string | null;
  profileGreeting?: {
    enabled: boolean;
    price: number | null;
    currency: "MXN" | "USD" | null;
  };
  offerings?: import("@/types/group").CreatorService[] | null;
  donation?: Record<string, unknown> | null;
  monetization?: Record<string, unknown> | null;
  followersCount?: number;
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
    const img = new window.Image();
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

type CreateMuxDirectUploadResponse = {
  provider: "mux";
  uploadId: string;
  uploadUrl: string;
  postId: string;
  mediaId: string;
  status: string;
};

const VIDEO_MAX_DURATION_SECONDS = 60 * 30;

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);

    video.preload = "metadata";

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(video.duration);
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No se pudo leer la duración del video."));
    };

    video.src = objectUrl;
  });
}

function uploadVideoFileToMux(params: {
  uploadUrl: string;
  file: File;
  onProgress: (progress: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      params.onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      reject(new Error(`Mux upload falló con status ${xhr.status}.`));
    };

xhr.onerror = () => {
  reject(new Error("Error de red al subir el video a Mux."));
};

    xhr.open("PUT", params.uploadUrl);
    xhr.setRequestHeader("Content-Type", params.file.type || "video/mp4");
    xhr.send(params.file);
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

  const [viewer, setViewer] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [profileBlockedByViewer, setProfileBlockedByViewer] = useState(false);
  const [viewerBlockedByProfile, setViewerBlockedByProfile] = useState(false);
  const [blockStatusLoading, setBlockStatusLoading] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [savingProfileRestricted, setSavingProfileRestricted] = useState(false);
  const [savingProfileComments, setSavingProfileComments] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [avatarRenderUrl, setAvatarRenderUrl] = useState<string | null>(null);
  const [coverRenderUrl, setCoverRenderUrl] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ProfileTabKey>("posts");
  const [donationViewerOpen, setDonationViewerOpen] = useState(false);
  const [greetOpen, setGreetOpen] = useState(false);
const [greetSubmitting, setGreetSubmitting] = useState(false);
const [greetType, setGreetType] = useState<GreetingType>("saludo");
const [toName, setToName] = useState("");
const [instructions, setInstructions] = useState("");
const [allowCreatorStory, setAllowCreatorStory] = useState(false);
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
const [profileComposerError, setProfileComposerError] = useState<string | null>(null);
const [isProfileLiveModalOpen, setIsProfileLiveModalOpen] = useState(false);
const [profilePostsRefreshKey, setProfilePostsRefreshKey] = useState(0);
const [mobileRefreshEnabled, setMobileRefreshEnabled] = useState(false);
const avatarSz = mobileRefreshEnabled ? "clamp(146px, 31.2vw, 286px)" : "clamp(112px, 24vw, 220px)";
const avatarOffsetTopSz = mobileRefreshEnabled ? "calc(clamp(146px, 31.2vw, 286px) / -2)" : "calc(clamp(112px, 24vw, 220px) / -2)";
const contentTopPaddingSz = mobileRefreshEnabled ? "calc((clamp(146px, 31.2vw, 286px) / 2) + 22px)" : "calc((clamp(112px, 24vw, 220px) / 2) + 22px)";
const [profileVideoUploadProgress, setProfileVideoUploadProgress] = useState<number | null>(null);
const [profileVideoUploadStatus, setProfileVideoUploadStatus] = useState<string | null>(null);
const [followersOverlayOpen, setFollowersOverlayOpen] = useState(false);

useEffect(() => {
  if (!serviceToast) return;

  const timeout = window.setTimeout(() => {
    setServiceToast(null);
  }, 3500);

  return () => window.clearTimeout(timeout);
}, [serviceToast]);

useEffect(() => {
  const mediaQuery = window.matchMedia("(max-width: 768px)");

  const syncMobileRefresh = () => {
    setMobileRefreshEnabled(mediaQuery.matches);
  };

  syncMobileRefresh();

  mediaQuery.addEventListener("change", syncMobileRefresh);

  return () => {
    mediaQuery.removeEventListener("change", syncMobileRefresh);
  };
}, []);

  const [cropOpen, setCropOpen] = useState(false);
  const [cropMode, setCropMode] = useState<CropMode>("avatar");
  const [cropImageSrc, setCropImageSrc] = useState<string>("");

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const cropAspect = cropMode === "avatar" ? 1 / 1 : 16 / 9;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

  const isOwner = !!viewer && !!userDoc && viewer.uid === userDoc.uid;
  const profileUid = userDoc?.uid ?? null;

  // Track last visit so the sidebar can show new-post counts
  useEffect(() => {
    if (profileUid) setLastVisitTimestamp(profileUid);
  }, [profileUid]);

  const { ring: profileRing, stories: profileRingStories, startIndex: profileRingStart } =
    useStoryRingState(profileUid, "profile", viewer?.uid ?? null);
  const [profileStoriesOpen, setProfileStoriesOpen] = useState(false);

  const ownerShowPosts = userDoc?.showPosts ?? true;
  const ownerShowGroups = userDoc?.showCreatedGroups ?? true;
  const profileRestricted = userDoc?.profileRestricted ?? false;
  const profileCommentsEnabled = userDoc?.profileCommentsEnabled !== false;

  const isProfileRestrictedForVisitor = !isOwner && profileRestricted;

  const profileBlockedByRelationship =
    !isOwner && (profileBlockedByViewer || viewerBlockedByProfile);

  const checkingProfileBlock =
    authReady && !!viewer && !!profileUid && !isOwner && blockStatusLoading;

  const shouldHideProfileSocialContent =
    !isOwner && (checkingProfileBlock || profileBlockedByRelationship);

  const visitorCanSeePosts =
    !shouldHideProfileSocialContent &&
    !isProfileRestrictedForVisitor &&
    (userDoc?.showPosts ?? true);

  const visitorCanSeeGroups =
    !shouldHideProfileSocialContent && (userDoc?.showCreatedGroups ?? true);

  const showPostsTab = isOwner ? true : visitorCanSeePosts;
  const showGroupsTab = isOwner ? true : visitorCanSeeGroups;

  const shouldShowSubnav = isOwner ? true : showPostsTab || showGroupsTab;

  const followersCount =
    typeof userDoc?.followersCount === "number" && userDoc.followersCount > 0
      ? userDoc.followersCount
      : 0;

  const followersLabel = `${followersCount.toLocaleString("es-MX")} ${
    followersCount === 1 ? "seguidor" : "seguidores"
  }`;

function openFollowersOverlay() {
  if (!isOwner) return;
  setFollowersOverlayOpen(true);
}

const handleProfilePullRefresh = useCallback(async () => {
  clearAllPostFeedCaches();
  setProfilePostsRefreshKey((value) => value + 1);
  router.refresh();
}, [router]);

  useEffect(() => {
    if (!userDoc) return;

    if (shouldHideProfileSocialContent) {
      if (activeTab !== "posts") {
        setActiveTab("posts");
      }
      return;
    }

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
  }, [
    activeTab,
    isOwner,
    shouldHideProfileSocialContent,
    showPostsTab,
    showGroupsTab,
    userDoc,
  ]);

function redirectToLogin() {
  const nextPath = buildCurrentPathWithSearch(
    pathname || `/u/${handle}`,
    searchParams
  );

  router.push(`/login?next=${encodeURIComponent(nextPath)}`);
}

const ui = {
  pageMaxWidth: 1080,
  coverHeight: "clamp(240px, 38vw, 360px)",
  avatarSize: "clamp(112px, 24vw, 220px)",
  avatarOffsetTop: "calc(clamp(112px, 24vw, 220px) / -2)",
  contentTopPadding: "calc((clamp(112px, 24vw, 220px) / 2) + 22px)",
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
  shadow: "0 18px 54px rgba(0,0,0,0.68)",
  borderSoft: "1px solid rgba(168,85,255,0.08)",
  borderFaint: "1px solid rgba(255,255,255,0.10)",
  cardBg:
    "linear-gradient(135deg, rgb(3,3,6) 0%, rgb(8,5,13) 48%, rgb(0,0,0) 100%)",
  panelBg: "rgba(255,255,255,0.03)",
};

  const styles = {
    card: {
      borderRadius: ui.cardRadius,
      border: ui.borderSoft,
      background: ui.cardBg,
      boxShadow: ui.shadow,
      backdropFilter: "none",
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
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
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
      backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
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
      backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
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
  const raw = getProfileService(type) as (NormalizedService & { durationMinutes?: number; duration?: number }) | null;
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
  setAllowCreatorStory(false);
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

      const hdata = hs.docs[0].data() as { uid?: string };
      const uid = hdata?.uid;

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
    } catch (e: unknown) {
      if (cancelled) return;

      setMsg((e instanceof Error ? e.message : null) ?? "Error cargando perfil");
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
  if (!authReady || !viewer || !profileUid || isOwner) {
    setProfileBlockedByViewer(false);
    setViewerBlockedByProfile(false);
    setBlockStatusLoading(false);
    return;
  }

  setBlockStatusLoading(true);

  let viewerBlockReady = false;
  let profileBlockReady = false;

  const viewerBlockedProfileRef = doc(
    db,
    "users",
    viewer.uid,
    "blockedUsers",
    profileUid
  );

  const profileBlockedViewerRef = doc(
    db,
    "users",
    profileUid,
    "blockedUsers",
    viewer.uid
  );

  const unsubViewerBlockedProfile = onSnapshot(
    viewerBlockedProfileRef,
    (snap) => {
      viewerBlockReady = true;
      setProfileBlockedByViewer(snap.exists());

      if (viewerBlockReady && profileBlockReady) {
        setBlockStatusLoading(false);
      }
    },
    () => {
      viewerBlockReady = true;
      setProfileBlockedByViewer(false);

      if (viewerBlockReady && profileBlockReady) {
        setBlockStatusLoading(false);
      }
    }
  );

  const unsubProfileBlockedViewer = onSnapshot(
    profileBlockedViewerRef,
    (snap) => {
      profileBlockReady = true;
      setViewerBlockedByProfile(snap.exists());

      if (viewerBlockReady && profileBlockReady) {
        setBlockStatusLoading(false);
      }
    },
    () => {
      profileBlockReady = true;
      setViewerBlockedByProfile(false);

      if (viewerBlockReady && profileBlockReady) {
        setBlockStatusLoading(false);
      }
    }
  );

  return () => {
    unsubViewerBlockedProfile();
    unsubProfileBlockedViewer();
  };
}, [authReady, viewer, profileUid, isOwner]);

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
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [authReady, searchParams, userDoc, viewer]);

  useEffect(() => {
    setAvatarRenderUrl(userDoc?.photoURL ?? null);
    setCoverRenderUrl(userDoc?.coverUrl ?? null);
  }, [userDoc?.photoURL, userDoc?.coverUrl]);

  const openCropWithFile = useCallback(
    async (mode: CropMode, file: File) => {
      if (!isOwner) return;

      setMsg(null);

      try {
        const normalized = await normalizeImageFile(file, {
  maxSizeBytes: 150 * 1024 * 1024,
});

        const src = await dataUrlFromFile(normalized.file);

        setCropMode(mode);
        setCropImageSrc(src);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCroppedAreaPixels(null);
        setCropOpen(true);
      } catch (e: unknown) {
        setMsg((e instanceof Error ? e.message : null) ?? "❌ No se pudo leer la imagen.");
      }
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
    (_croppedArea: unknown, croppedAreaPixelsArg: Area) => {
      setCroppedAreaPixels(croppedAreaPixelsArg);
    },
    []
  );

async function handleCreateProfilePost(payload: ProfileComposerSubmitPayload) {
  if (!userDoc || !isOwner) return;

  try {
    setMsg(null);
    setProfileComposerError(null);
    setProfileVideoUploadProgress(null);
    setProfileVideoUploadStatus(null);

    const cleanText = payload.text.trim();

    const orderedMediaItems: ProfileComposerMediaItem[] =
      Array.isArray(payload.mediaItems) && payload.mediaItems.length > 0
        ? payload.mediaItems
        : [
            ...(payload.imageFiles ?? []).map<ProfileComposerMediaItem>((file) => ({
              type: "image",
              file,
              coverFile: null,
            })),
            ...(payload.videoFiles ?? []).map<ProfileComposerMediaItem>((file) => ({
              type: "video",
              file,
              coverFile: null,
            })),
          ];

    const imageItems = orderedMediaItems
      .map((item, mediaIndex) => ({ ...item, mediaIndex }))
      .filter((item) => item.type === "image");

    const videoItems = orderedMediaItems
      .map((item, mediaIndex) => ({ ...item, mediaIndex }))
      .filter((item) => item.type === "video");

    if (videoItems.length > 3) {
      setProfileComposerError("Puedes agregar máximo 3 videos por publicación.");
      return;
    }

    if (videoItems.length > 0) {
      setProfileVideoUploadProgress(0);
      setProfileVideoUploadStatus("Validando videos...");

      for (const videoItem of videoItems) {
        const duration = await getVideoDuration(videoItem.file);

        if (duration > VIDEO_MAX_DURATION_SECONDS) {
          setProfileVideoUploadProgress(null);
          setProfileVideoUploadStatus(null);
          setProfileComposerError("Cada video no puede durar más de 30 minutos.");
          return;
        }
      }
    }

    const uploadedImages: PostMedia[] =
      imageItems.length > 0
        ? (
            await uploadPostImages({
              groupId: `profile-${userDoc.uid}`,
              files: imageItems.map((item) => item.file),
            })
          ).map((media, index) => ({
            ...media,
            index: imageItems[index]?.mediaIndex ?? index,
          }))
        : [];

    const videoCoverItems = videoItems.filter(
      (item) => item.coverFile instanceof File
    );

    const uploadedVideoCovers =
      videoCoverItems.length > 0
        ? (setProfileVideoUploadStatus("Subiendo portadas de videos..."),
          await uploadPostImages({
            groupId: `profile-${userDoc.uid}`,
            files: videoCoverItems.map((item) => item.coverFile as File),
          })).map((media, index) => ({
            mediaIndex: videoCoverItems[index]?.mediaIndex ?? index,
            thumbnailUrl: media.thumbnailUrl ?? media.url,
            thumbnailPath: media.thumbnailPath ?? media.path ?? null,
          }))
        : [];

    const videoCoversByMediaIndex = new Map(
      uploadedVideoCovers.map((cover) => [cover.mediaIndex, cover])
    );

    if (videoItems.length > 0) {
      setProfileVideoUploadStatus("Preparando subida de videos...");

      const callable = httpsCallable<
        {
          contextType: "profile";
          profileId: string;
          postId?: string;
          mediaIndex?: number;
        },
        CreateMuxDirectUploadResponse
      >(functions, "createMuxDirectUpload");

      const muxUploads: Array<{
        uploadUrl: string;
        uploadId: string;
        postId: string;
        mediaId: string;
        file: File;
        mediaIndex: number;
        thumbnailUrl: string | null;
        thumbnailPath: string | null;
      }> = [];

      let sharedPostId: string | null = null;

      for (const videoItem of videoItems) {
        const uploadResult = await callable({
          contextType: "profile",
          profileId: userDoc.uid,
          postId: sharedPostId ?? undefined,
          mediaIndex: videoItem.mediaIndex,
        });

        const uploadData = uploadResult.data as CreateMuxDirectUploadResponse;

        if (!sharedPostId) {
          sharedPostId = uploadData.postId;
        }

        const cover = videoCoversByMediaIndex.get(videoItem.mediaIndex) ?? null;

        muxUploads.push({
          uploadUrl: uploadData.uploadUrl,
          uploadId: uploadData.uploadId,
          postId: uploadData.postId,
          mediaId: uploadData.mediaId,
          file: videoItem.file,
          mediaIndex: videoItem.mediaIndex,
          thumbnailUrl: cover?.thumbnailUrl ?? null,
          thumbnailPath: cover?.thumbnailPath ?? null,
        });
      }

      if (!sharedPostId) {
        throw new Error("No se pudo preparar la publicación de video.");
      }

      setProfileVideoUploadStatus("Creando publicación con media...");

      const videoUploadsPayload = muxUploads.map((upload) => ({
        uploadId: upload.uploadId,
        mediaId: upload.mediaId,
        mediaIndex: upload.mediaIndex,
        thumbnailUrl: upload.thumbnailUrl,
        thumbnailPath: upload.thumbnailPath,
      }));

      await createMediaPost({
        contextType: "profile",
        profileId: userDoc.uid,
        postId: sharedPostId,
        text: cleanText,
        imageMedia: uploadedImages,
        videoUploads: videoUploadsPayload,
        premium: payload.premium ?? null,
      });

      for (let index = 0; index < muxUploads.length; index += 1) {
        const upload = muxUploads[index];

        setProfileVideoUploadStatus(
          `Subiendo video ${index + 1} de ${muxUploads.length} a Mux...`
        );

        await uploadVideoFileToMux({
          uploadUrl: upload.uploadUrl,
          file: upload.file,
          onProgress: setProfileVideoUploadProgress,
        });
      }

      setProfileVideoUploadStatus(
        "Videos subidos. Mux los está procesando; aparecerán listos en unos momentos."
      );
    } else if (uploadedImages.length > 0) {
      await createMediaPost({
        contextType: "profile",
        profileId: userDoc.uid,
        text: cleanText,
        imageMedia: uploadedImages,
        videoUploads: [],
        premium: null,
      });
    } else {
      await createTextPost({
        contextType: "profile",
        profileId: userDoc.uid,
        text: cleanText,
      });
    }

    clearAllPostFeedCaches();
    setProfilePostsRefreshKey((value) => value + 1);
    setMsg("✅ Publicación creada en tu perfil.");

    window.setTimeout(() => {
      setProfileVideoUploadProgress(null);
      setProfileVideoUploadStatus(null);
    }, 2500);
  } catch (e: unknown) {
    setProfileComposerError((e instanceof Error ? e.message : null) ?? "No se pudo publicar en tu perfil.");
    setProfileVideoUploadProgress(null);
    setProfileVideoUploadStatus(null);
    throw e;
  }
}

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
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string } | null;
      setMsg(
        err?.code === "permission-denied"
          ? "❌ Permiso denegado. Revisa reglas de Firestore."
          : `❌ No se pudo actualizar la privacidad del perfil: ${err?.message ?? "error"}`
      );
      throw e;
    } finally {
      setSavingProfileRestricted(false);
    }
  }

  async function handleToggleProfileCommentsEnabled(nextValue: boolean) {
    if (!userDoc || !isOwner) return;

    setSavingProfileComments(true);

    try {
      const userRef = doc(db, "users", userDoc.uid);

      await updateDoc(userRef, {
        profileCommentsEnabled: nextValue,
      });

      setUserDoc((prev) =>
        prev ? { ...prev, profileCommentsEnabled: nextValue } : prev
      );
    } catch (e: unknown) {
      throw e;
    } finally {
      setSavingProfileComments(false);
    }
  }

async function handleUpdateDisplayName(nextName: string) {
  if (!userDoc || !isOwner) return;

  const result = await updateProfileDisplayName(nextName);

  setUserDoc((prev) =>
    prev
      ? {
          ...prev,
          displayName: result.displayName,
          displayNameLastChangedAt: result.displayNameLastChangedAt,
        }
      : prev
  );
}

async function handleUpdateBio(nextBio: string) {
  if (!userDoc || !isOwner) return;
  const uref = doc(db, "users", userDoc.uid);
  await updateDoc(uref, { bio: nextBio.trim() });
  setUserDoc((prev) => (prev ? { ...prev, bio: nextBio.trim() } : prev));
}

async function handleSendPasswordReset() {
  const email = viewer?.email;

  if (!email) {
    throw new Error("No encontramos un correo asociado a esta cuenta.");
  }

  await sendPasswordResetEmail(auth, email);
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

    } catch (e: unknown) {
      const err = e as { code?: string; message?: string } | null;
      setMsg(
        err?.code === "permission-denied"
          ? "❌ Permiso denegado. Revisa reglas de Storage/Firestore."
          : `❌ No se pudo subir la imagen: ${err?.message ?? "error"}`
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
  requestSource: "profile",
  profileUserId: userDoc.uid,
  creatorId: userDoc.uid,
  groupId: null,
  type: greetType,
  toName,
  instructions,
  allowCreatorStory,
});

    setGreetOpen(false);
    setToName("");
    setInstructions("");
    setGreetSuccess(null);
    setServiceToast("Solicitud enviada al creador.");
  } catch (e: unknown) {
    setGreetError((e instanceof Error ? e.message : null) ?? "No se pudo enviar la solicitud.");
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
  requestSource: "profile",
  profileUserId: userDoc.uid,
  creatorId: userDoc.uid,
  groupId: null,
  buyerMessage: meetGreetMessage,
  priceSnapshot: service?.publicPrice ?? service?.memberPrice ?? null,
  durationMinutes: (service as (NormalizedService & { durationMinutes?: number }) | null)?.durationMinutes ?? null,
});

    setMeetGreetOpen(false);
    setMeetGreetMessage("");
    setServiceToast("Solicitud de meet & greet enviada.");
  } catch (e: unknown) {
    setMeetGreetError((e instanceof Error ? e.message : null) ?? "No se pudo enviar la solicitud.");
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
  requestSource: "profile",
  profileUserId: userDoc.uid,
  creatorId: userDoc.uid,
  groupId: null,
  buyerMessage: exclusiveSessionMessage,
  priceSnapshot: service?.publicPrice ?? service?.memberPrice ?? null,
  durationMinutes: (service as (NormalizedService & { durationMinutes?: number }) | null)?.durationMinutes ?? null,
});

    setExclusiveSessionOpen(false);
    setExclusiveSessionMessage("");
    setServiceToast("Solicitud de sesión exclusiva enviada.");
  } catch (e: unknown) {
    setExclusiveSessionError((e instanceof Error ? e.message : null) ?? "No se pudo enviar la solicitud.");
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
          padding: "0 0 calc(108px + env(safe-area-inset-bottom))",
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
          padding: "0 0 calc(108px + env(safe-area-inset-bottom))",
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
  const normalizedDisplayNameLastChangedAt = normalizeDateValue(
  userDoc.displayNameLastChangedAt ?? null
);

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
  const profileShareHref = `/u/${userDoc.handle}`;

  return (
    <>
      <RefreshableArea
        onRefresh={handleProfilePullRefresh}
        enabled={mobileRefreshEnabled}
      >
<main
  style={{
    minHeight: "calc(100dvh - 70px)",
    padding: "0 0 calc(120px + env(safe-area-inset-bottom))",
    background: "transparent",
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
            position: relative;
            overflow: hidden;
            min-width: 0;
          }

          .profile-card::before,
          .profile-card::after {
            display: none;
          }

          .profile-card > * {
            position: relative;
            z-index: 2;
          }

.profile-content {
  position: relative;
  padding: 0 18px 20px;
  min-width: 0;
  overflow: visible;
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

.shared-communities-cover {
  position: absolute;
  left: 18px;
  top: 18px;
  z-index: 45;
  display: flex;
  align-items: center;
  pointer-events: auto;
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

          @media (max-width: 640px) {
            .profile-card button[aria-label="Cambiar foto de perfil"][title="Cambiar foto de perfil"] {
              right: -10px !important;
              bottom: -2px !important;
            }
          }

@media (max-width: 900px) {
  .profile-shell {
    max-width: none;
    padding: 0;
  }
}
@media (max-width: 640px) {
  .profile-shell {
    padding: 0;
  }

  .profile-card {
    border-radius: 0 !important;
    border-left: 0 !important;
    border-right: 0 !important;
  }

.profile-content {
  padding: 0 12px 18px;
}

.shared-communities-cover {
  left: 12px;
  top: 12px;
}

  .profile-handle {
    font-size: 14px;
  }

  .profile-actions-row > button {
    width: 100%;
  }

  .profile-tab-content {
    overflow: visible;
  }

  .profile-tab-panel {
    overflow: visible;
  }
}
        `}</style>

        <div className="profile-shell">
          <div
            className="profile-card"
            style={{
              ...styles.card,
              background: "transparent",
              border: "none",
              boxShadow: "none",
            }}
          >
            <div
              style={{
                position: "relative",
                height: ui.coverHeight,
                background: "#0b0b0b",
              }}
            >
              <Image
                key={coverSrc}
                src={coverSrc}
                alt="cover"
                fill
                style={{ objectFit: "cover", opacity: 0.96 }}
              />


<div
  style={{
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "82%",
    zIndex: 10,
    pointerEvents: "none",
    background:
      "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.12) 14%, rgba(0,0,0,0.26) 28%, rgba(0,0,0,0.44) 44%, rgba(0,0,0,0.62) 60%, rgba(0,0,0,0.78) 76%, rgba(0,0,0,0.9) 90%, rgba(0,0,0,0.96) 100%)",
  }}
/>

<div
  className="shared-communities-cover"
  aria-label="Comunidades compartidas"
>
  <SharedCommunitiesBadge
    profileUid={userDoc.uid}
    viewerUid={viewer?.uid ?? null}
  />
</div>


<>
  {!shouldHideProfileSocialContent && (
    <div
    style={{
      position: "absolute",
      right: 18,
      top: 18,
      zIndex: 40,
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    }}
  >
    <CopyLinkButton
      href={profileShareHref}
      copiedLabel="Link del perfil copiado correctamente"
      title="Copiar link del perfil"
      style={{
        width: 34,
        height: 34,
        borderRadius: "50%",
        border: "none",
        background:
          "linear-gradient(135deg, rgb(3,3,6) 0%, rgb(8,5,13) 48%, rgb(0,0,0) 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(255,255,255,0.016), inset 0 0 11px rgba(168,85,255,0.13), inset 0 0 18px rgba(168,85,255,0.085), inset 0 0 26px rgba(126,34,206,0.065), 0 0 7px rgba(168,85,255,0.05), 0 12px 24px rgba(0,0,0,0.5)",
        backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
      }}
    />
    <ProfileMoreMenu
      viewerUid={viewer?.uid}
      profileUid={userDoc.uid}
    />
  </div>
  )}

  {isOwner && (
    <button
      onClick={handlePickCover}
      disabled={uploading}
      type="button"
      aria-label="Elegir portada"
      title="Elegir portada"
      style={{
        position: "absolute",
        right: 14,
        bottom: 14,
        zIndex: 40,
        width: 34,
        height: 34,
        borderRadius: "50%",
        border: "none",
        background:
          "linear-gradient(135deg, rgb(3,3,6) 0%, rgb(8,5,13) 48%, rgb(0,0,0) 100%)",
        color: "rgba(168,85,247,0.98)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        opacity: uploading ? 0.7 : 1,
        cursor: uploading ? "not-allowed" : "pointer",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(255,255,255,0.016), inset 0 0 11px rgba(168,85,255,0.13), inset 0 0 18px rgba(168,85,255,0.085), inset 0 0 26px rgba(126,34,206,0.065), 0 0 7px rgba(168,85,255,0.05), 0 12px 24px rgba(0,0,0,0.5)",
        backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontSize: 17,
          lineHeight: 1,
          transform:
            uploading && cropMode === "cover" ? "scale(0.9)" : "scale(1)",
          transition: "transform 160ms ease",
        }}
      >
        ✎
      </span>
    </button>
  )}
</>
            </div>

            <div className="profile-content">
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: avatarOffsetTopSz,
                  transform: "translateX(-50%)",
                  zIndex: 20,
                }}
              >
                <div style={{ position: "relative" }}>
                  {/* Vibra ring when profile has active stories */}
                  {profileRing !== "none" && (
                    <div
                      style={{
                        position: "absolute",
                        inset: -6,
                        borderRadius: "50%",
                        background: profileRing === "vibra"
                          ? "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)"
                          : "rgba(255,255,255,0.28)",
                        zIndex: 0,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (profileRing !== "none" && profileRingStories.length > 0) {
                        setProfileStoriesOpen(true);
                      } else if (isOwner) {
                        handlePickAvatar();
                      }
                    }}
                    disabled={(!isOwner && profileRing === "none") || uploading}
                    style={{
                      width: avatarSz,
                      height: avatarSz,
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
                      cursor: (isOwner || profileRing !== "none") && !uploading ? "pointer" : "default",
                      position: "relative",
                      zIndex: 1,
                    }}
                    aria-label={
                      profileRing !== "none" && profileRingStories.length > 0
                        ? `Ver historias de ${fullName}`
                        : isOwner
                          ? "Cambiar foto de perfil"
                          : undefined
                    }
                    title={isOwner && profileRing === "none" ? "Cambiar foto de perfil" : undefined}
                  >
                    {avatarSrc ? (
                      <Image
                        key={avatarSrc}
                        src={avatarSrc}
                        alt="avatar"
                        fill
                        style={{ objectFit: "cover" }}
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
                        borderRadius: "50%",
                        border: "none",
                        background:
                          "linear-gradient(135deg, rgb(3,3,6) 0%, rgb(8,5,13) 48%, rgb(0,0,0) 100%)",
                        color: "rgba(168,85,247,0.98)",
                        cursor: uploading ? "not-allowed" : "pointer",
                        fontSize: 17,
                        fontWeight: 600,
                        display: "grid",
                        placeItems: "center",
                        boxShadow:
                          "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(255,255,255,0.016), inset 0 0 11px rgba(168,85,255,0.13), inset 0 0 18px rgba(168,85,255,0.085), inset 0 0 26px rgba(126,34,206,0.065), 0 0 7px rgba(168,85,255,0.05), 0 12px 24px rgba(0,0,0,0.5)",
                        backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                        zIndex: 200,
                        pointerEvents: "auto",
                        fontFamily: fontStack,
                        lineHeight: 1,
                        padding: 0,
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
    paddingTop: contentTopPaddingSz,
    position: "relative",
    zIndex: 1,
  }}
>
                <div className="profile-meta">
                  <h1 style={{ ...styles.title, margin: 0 }}>{fullName}</h1>

                  <div className="profile-handle">@{userDoc.handle}</div>

                  {!!userDoc.bio?.trim() && (
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 14,
                        fontWeight: 400,
                        lineHeight: 1.5,
                        color: "rgba(255,255,255,0.82)",
                        maxWidth: 560,
                        wordBreak: "break-word",
                        overflowWrap: "anywhere",
                        textAlign: "center",
                      }}
                    >
                      {userDoc.bio}
                    </div>
                  )}

                                    <div
                    className="profile-visibility"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <span>{profileVisibilityLabel}</span>

                    <span aria-hidden="true">·</span>

                    {isOwner ? (
                      <button
                        type="button"
                        onClick={openFollowersOverlay}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "rgba(255,255,255,0.72)",
                          padding: 0,
                          margin: 0,
                          font: "inherit",
                          cursor: "pointer",
                          textDecoration: "none",
                        }}
                      >
                        {followersLabel}
                      </button>
                    ) : (
                      <span>{followersLabel}</span>
                    )}
                  </div>

                  <ProfileSocialActions
                    viewerUid={viewer?.uid ?? null}
                    profileUid={userDoc.uid}
                    profileRestricted={profileRestricted}
                    profileName={userDoc.displayName ?? userDoc.handle ?? null}
                    donation={userDoc.donation as { mode: "none" | "general" | "wedding"; enabled?: boolean; visible?: boolean; suggestedAmounts?: number[] | null } | null | undefined}
                    onDonate={() => {
                      if (!viewer) { redirectToLogin(); return; }
                      setDonationViewerOpen(true);
                    }}
                  />

                  {shouldHideProfileSocialContent ? (
                    <div
                      style={{
                        ...styles.message,
                        marginTop: 18,
                        textAlign: "center",
                        maxWidth: 520,
                      }}
                    >
                      {checkingProfileBlock
                        ? "Validando acceso al perfil..."
                        : profileBlockedByViewer
                          ? "Bloqueaste este perfil. Puedes desbloquearlo desde el menú de opciones."
                          : "Este perfil no está disponible."}
                    </div>
                  ) : null}

                  {!isProfileRestrictedForVisitor && !shouldHideProfileSocialContent ? (
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
      services={(userDoc.offerings ?? []) as import("@/types/group").CreatorService[]}
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

              {authReady && !viewer && !shouldHideProfileSocialContent && (
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

{profileUid && (
  <StoryCircles creatorId={profileUid} currentUserId={viewer?.uid ?? null} />
)}

{shouldShowSubnav && (
  <div style={{ marginTop: 8 }}>
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
            {!shouldHideProfileSocialContent &&
              (isOwner || showPostsTab || isProfileRestrictedForVisitor) &&
              activeTab === "posts" && (
                <div className="profile-tab-panel">
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 720,
                      marginLeft: "auto",
                      marginRight: "auto",
                      boxSizing: "border-box",
                    }}
                  >
{isOwner && (
  <div style={{ marginBottom: 12 }}>
    <GroupPostComposer
      contextType="profile"
      onSubmit={handleCreateProfilePost}
      onLiveClick={() => setIsProfileLiveModalOpen(true)}
    />

    <LiveComposerModal
      open={isProfileLiveModalOpen}
      onClose={() => setIsProfileLiveModalOpen(false)}
      onSuccess={() => {
        clearAllPostFeedCaches();
        setProfilePostsRefreshKey((v) => v + 1);
      }}
      contextType="profile"
      profileId={userDoc.uid}
    />

    {profileVideoUploadStatus ? (
      <div
        style={{
          marginTop: 10,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(15, 23, 42, 0.72)",
          padding: 12,
          color: "rgba(255,255,255,0.84)",
          fontSize: 13,
        }}
      >
        <div style={{ marginBottom: 8 }}>{profileVideoUploadStatus}</div>

        {profileVideoUploadProgress !== null ? (
          <div
            style={{
              height: 8,
              width: "100%",
              overflow: "hidden",
              borderRadius: 999,
              background: "rgba(255,255,255,0.1)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${profileVideoUploadProgress}%`,
                borderRadius: 999,
                background: "rgba(96,165,250,0.95)",
                transition: "width 160ms ease",
              }}
            />
          </div>
        ) : null}

        {profileVideoUploadProgress !== null ? (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            {profileVideoUploadProgress}%
          </div>
        ) : null}
      </div>
    ) : null}

    {profileComposerError ? (
      <div
        style={{
          ...styles.message,
          marginTop: 10,
          borderColor: "rgba(248,113,113,0.22)",
          background: "rgba(248,113,113,0.08)",
          color: "#fecaca",
        }}
      >
        {profileComposerError}
      </div>
    ) : null}
  </div>
)}

<ProfilePostsFeed
  key={`profile-posts-${userDoc.uid}-${profilePostsRefreshKey}`}
  profileUid={userDoc.uid}
  viewerUid={viewer?.uid ?? null}
  isOwner={isOwner}
  showPosts={isOwner ? ownerShowPosts : visitorCanSeePosts}
  profileRestricted={profileRestricted}
  commentsEnabled={profileCommentsEnabled}
/>
                  </div>
                </div>
              )}

            {!shouldHideProfileSocialContent &&
              (isOwner || showGroupsTab) &&
              activeTab === "groups" && (
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
  style={{ ...styles.tabPlaceholder, marginTop: 8 }}
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
  style={{ ...styles.tabPlaceholder, marginTop: 8 }}
>
                <ProfileSettingsTab
  isSaving={savingProfileRestricted}
  isRestricted={profileRestricted}
  onToggleRestricted={handleToggleProfileRestricted}
  commentsEnabled={profileCommentsEnabled}
  onToggleCommentsEnabled={handleToggleProfileCommentsEnabled}
  isSavingComments={savingProfileComments}
  uid={userDoc.uid}
  email={viewer?.email ?? null}
  displayName={fullName}
  username={userDoc.handle}
  birthDate={normalizedBirthDate}
  appCreatedAt={normalizedCreatedAt}
  displayNameLastChangedAt={normalizedDisplayNameLastChangedAt}
  onUpdateDisplayName={handleUpdateDisplayName}
  bio={userDoc.bio ?? null}
  onUpdateBio={handleUpdateBio}
  onSendPasswordReset={handleSendPasswordReset}
/>
              </section>
            )}
          </div>

          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*,.heic,.heif"
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
            accept="image/*,.heic,.heif"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await openCropWithFile("cover", f);
              e.currentTarget.value = "";
            }}
          />
        </div>
      </main>
      </RefreshableArea>

<ProfileFollowersOverlay
  open={followersOverlayOpen}
  currentUserId={viewer?.uid ?? null}
  profileUserId={userDoc.uid}
  onClose={() => setFollowersOverlayOpen(false)}
/>

<CreatorServiceModals
  greetOpen={greetOpen}
  greetSubmitting={greetSubmitting}
  greetType={greetType}
  creatorName={fullName}
  toName={toName}
  instructions={instructions}
  greetError={greetError}
  greetSuccess={greetSuccess}
  onCloseGreeting={resetGreetingModal}
  onSubmitGreeting={handleSubmitGreeting}
  onChangeToName={setToName}
  onChangeInstructions={setInstructions}
  allowCreatorStory={allowCreatorStory}
  onChangeAllowCreatorStory={setAllowCreatorStory}
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
  backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
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
    paddingTop: "max(14px, env(safe-area-inset-top, 0px))",
    paddingBottom: 14,
    paddingLeft: 14,
    paddingRight: 14,
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
  backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
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
    backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
  }}
  formatMoney={formatMoney}
/>

      <DonationViewer
        open={donationViewerOpen}
        donation={userDoc.donation ?? null}
        profileName={userDoc.displayName ?? userDoc.handle ?? null}
        profilePhoto={userDoc.photoURL ?? null}
        profileHandle={userDoc.handle ?? null}
        onClose={() => setDonationViewerOpen(false)}
        onDonate={() => {
          // Payment integration — coming soon
          setDonationViewerOpen(false);
        }}
      />

      {profileStoriesOpen && profileRingStories.length > 0 && (
        <StoryViewer
          stories={profileRingStories}
          initialIndex={profileRingStart}
          onClose={() => setProfileStoriesOpen(false)}
          onStoryViewed={(storyId) => {
            if (viewer?.uid) recordStoryView(viewer.uid, storyId).catch(console.error);
          }}
        />
      )}

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
            paddingTop: "max(14px, env(safe-area-inset-top, 0px))",
            paddingBottom: 14,
            paddingLeft: 14,
            paddingRight: 14,
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
              backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
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