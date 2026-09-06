"use client";

import { useTranslations, useLocale } from "next-intl";
import { IMAGE_CACHE_CONTROL } from "@/lib/storage/cacheControl";
import { useCfError } from "@/lib/i18n/cfError";
import { capitalizeFirst, intlLocale } from "@/i18n/locales";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { useScreenReady } from "@/lib/useScreenReady";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import Image from "next/image";
import {
  CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  getDoc,
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
import { updateProfileDisplayName } from "@/lib/profile/updateProfileDisplayName";
import { updateMessagePolicy } from "@/lib/chat/messagePolicyService";
import { usePrivateProfile } from "@/lib/auth/usePrivateProfile";
import { DEFAULT_MESSAGE_POLICY, type MessagePolicy } from "@/lib/chat/types";
import CreatorExperiencesSection from "@/components/services/CreatorExperiencesSection";
import ProfileHeaderSkeleton from "@/components/profile/ProfileHeaderSkeleton";
import EditTextButton, { avatarEditButtonStyle } from "@/components/ui/EditTextButton";
// Mismo tono y tamaño que el "Editar" del avatar (EditTextButton no es más que
// esto con sombra, que solo hace falta encima de una foto).
import { TextButton } from "@/components/ui";
import PostReveal from "@/app/components/PostSkeleton/PostReveal";
import CreatorServiceModals from "@/components/services/CreatorServiceModals";
import { buildCurrentPathWithSearch } from "@/lib/auth-redirect";
import CopyLinkButton from "@/components/ui/CopyLinkButton";
import CoverSearchBar from "@/app/components/CoverSearch/CoverSearchBar";
import {
  createGreetingRequest,
  type GreetingType,
} from "@/lib/greetings/greetingRequests";
import StripePaymentModal from "@/components/payments/StripePaymentModal";
import { createGreetingStripeIntent, createServiceStripeIntent } from "@/lib/stripe/stripePayments";
import { createMeetGreetRequest } from "@/lib/meetGreet/meetGreetRequests";
import { registrarCompraGeo } from "@/lib/wallet/registrarCompraGeo";
import { createExclusiveSessionRequest } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import { getServiceByType, type NormalizedService } from "@/lib/services/normalizeServices";
import type { CreatorServiceType } from "@/types/group";
import SafeCropper from "@/components/media/SafeCropper";
import { auth, db, storage } from "@/lib/firebase";
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
import { fetchProfilePostsCount } from "@/lib/posts/post-service";
import { createProfilePost } from "@/lib/posts/createProfilePost";
import StatsRow from "@/components/ui/StatsRow";
import SocialLinksRow from "@/components/profile/SocialLinksRow";
import { updateProfileSocialLinks } from "@/lib/profile/updateProfileSocialLinks";
import type { SocialLinks } from "@/lib/profile/socialNetworks";
import { clearAllPostFeedCaches } from "@/lib/posts/post-feed-cache";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { clearMediaGalleryCache } from "@/app/groups/[groupId]/components/posts/MediaGallery";
import type { Post, PostPremium } from "@/lib/posts/types";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import StoryCircles from "@/app/components/Stories/StoryCircles";
import { useStoryRingState } from "@/lib/stories/useStoryRingState";
import { recordStoryView } from "@/lib/stories/storyService";
import StoryViewer from "@/app/components/Stories/StoryViewer";
import { setLastVisitTimestamp } from "@/lib/utils/visitTimestamps";
import { useLiveRingState } from "@/lib/live/useLiveRingState";
import { useSetMobileHeader } from "@/app/contexts/MobileHeaderContext";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";
import CurrencySwitcher from "@/app/components/CurrencySwitcher";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import type { DisplayCurrency } from "@/lib/currency/catalog";
import { FIXED_SERVICE_FEE_USD, SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import {
  type FirestoreDateLike,
  type CropMode,
  type Area,
  initials,
  dataUrlFromFile,
  normalizeDateValue,
  getCroppedBlob,
} from "./ProfileClient.utils";

const LiveViewerModal = dynamic(
  () => import("@/app/components/LiveViewerModal/LiveViewerModal"),
  { ssr: false }
);

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
  messagePolicy?: MessagePolicy;
  bio?: string | null;
  profileGreeting?: {
    enabled: boolean;
    price: number | null;
    currency: "MXN" | "USD" | null;
  };
  offerings?: import("@/types/group").CreatorService[] | null;
  donation?: Record<string, unknown> | null;
  monetization?: Record<string, unknown> | null;
  interests?: import("@/types/group").CanonicalGroupCategory[] | null;
  followersCount?: number;
  socialLinks?: SocialLinks | null;
  /**
   * Ventas del creador, de cualquiera de los once servicios. Lo lleva el ledger
   * en el backend; el cliente solo lo lee.
   */
  experiencesCount?: number;
  /**
   * Publicaciones del perfil. Lo lleva el servidor (entityCounters.ts) porque
   * contarlas desde el cliente exige poder LEERLAS, y un perfil restringido no
   * lo permite: el dato quedaba en blanco justo para quien no ha entrado.
   */
  postsCount?: number;
};

// ─── Module-level profile cache ───────────────────────────────────────────────
/**
 * Tope del lado mayor de avatar y portada al subirlos.
 *
 * Antes no había: el recorte se guardaba al tamaño del origen normalizado, hasta
 * 2 000 px. Un feed pinta decenas de avatares de 32–40 px, y cada uno se traía
 * ese archivo entero. 512 px cubre la ficha del perfil (~150 px) en pantallas de
 * densidad 3x; la portada es una banda ancha y se queda en 1 600.
 *
 * Solo afecta a lo que se sube DESDE AHORA. Los avatares ya guardados siguen
 * pesando lo que pesaban — para esos hace falta un backfill aparte.
 */
const AVATAR_MAX_PX = 512;
const COVER_MAX_PX = 1600;

const PROFILE_CACHE_TTL = 1000 * 60 * 30; // 30 minutes

type ProfileCacheEntry = {
  userDoc: UserDoc;
  updatedAt: number;
};

const profileCache = new Map<string, ProfileCacheEntry>();
// ──────────────────────────────────────────────────────────────────────────────

// ─── Module-level block status cache ──────────────────────────────────────────
const BLOCK_STATUS_TTL_MS = 2 * 60 * 1000; // 2 minutes

type BlockStatusEntry = {
  viewerHasBlocked: boolean;
  viewerIsBlocked: boolean;
  cachedAt: number;
};

const blockStatusCache = new Map<string, BlockStatusEntry>();
// ──────────────────────────────────────────────────────────────────────────────

// ─── Conteo de publicaciones del perfil ───────────────────────────────────────
// El feed pagina de diez en diez y nunca sabe el total, así que el número del
// card sale de una lectura agregada aparte. Se guarda por uid para que entrar y
// salir del mismo perfil no vuelva a contar; el TTL es corto porque publicar
// mueve el número y verlo desfasado media hora se sentiría roto.
const PROFILE_POSTS_COUNT_TTL_MS = 2 * 60 * 1000;

const profilePostsCountCache = new Map<string, { count: number; cachedAt: number }>();

function peekProfilePostsCount(uid: string): number | null {
  const hit = profilePostsCountCache.get(uid);
  if (!hit || Date.now() - hit.cachedAt > PROFILE_POSTS_COUNT_TTL_MS) return null;
  return hit.count;
}
// ──────────────────────────────────────────────────────────────────────────────

// ─── Orden de pestañas para animar el slide del subnav (misma UX que Wallet) ──
const PROFILE_TAB_ORDER: Record<ProfileTabKey, number> = {
  posts: 0,
  groups: 1,
  services: 2,
  settings: 3,
};
// ──────────────────────────────────────────────────────────────────────────────

// Botón circular de la portada (mismo look que copiar link / cambiar portada).
const COVER_CIRCLE_BTN_STYLE: React.CSSProperties = {
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
  cursor: "pointer",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(255,255,255,0.02), 0 12px 24px rgba(0,0,0,0.5)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
};

function CoverSearchLupaIcon() {
  return (
    <svg
      aria-hidden="true"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export default function ProfileClient() {
  const tProfile = useTranslations("profile");
  const tGroups = useTranslations("groups");

  const locale = useLocale();
  const tCommon = useTranslations("common");
  const cfError = useCfError();
  const tServices = useTranslations("services");
  const priceFmt = usePriceFormat();

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

  const [userDoc, setUserDoc] = useState<UserDoc | null>(() => {
    const cached = profileCache.get(handle);
    if (cached && Date.now() - cached.updatedAt < PROFILE_CACHE_TTL) {
      return cached.userDoc;
    }
    return null;
  });
  const [loading, setLoading] = useState(() => {
    const cached = profileCache.get(handle);
    return !(cached && Date.now() - cached.updatedAt < PROFILE_CACHE_TTL);
  });
  const [msg, setMsg] = useState<string | null>(null);

  // Avisa al splash de arranque cuando el perfil ya tiene datos para pintar.
  useScreenReady(!!userDoc);
  const { toast: profileToast, showToast: showProfileToast } = useVibraToast();

  const [profileBlockedByViewer, setProfileBlockedByViewer] = useState<boolean>(() => {
    const viewerUid = auth.currentUser?.uid;
    const profileUid = profileCache.get(handle)?.userDoc?.uid;
    if (!viewerUid || !profileUid || viewerUid === profileUid) return false;
    const e = blockStatusCache.get(`${viewerUid}:${profileUid}`);
    return (e && Date.now() - e.cachedAt < BLOCK_STATUS_TTL_MS) ? e.viewerHasBlocked : false;
  });
  const [viewerBlockedByProfile, setViewerBlockedByProfile] = useState<boolean>(() => {
    const viewerUid = auth.currentUser?.uid;
    const profileUid = profileCache.get(handle)?.userDoc?.uid;
    if (!viewerUid || !profileUid || viewerUid === profileUid) return false;
    const e = blockStatusCache.get(`${viewerUid}:${profileUid}`);
    return (e && Date.now() - e.cachedAt < BLOCK_STATUS_TTL_MS) ? e.viewerIsBlocked : false;
  });
  const [blockStatusLoading, setBlockStatusLoading] = useState<boolean>(() => {
    const viewerUid = auth.currentUser?.uid;
    const profileUid = profileCache.get(handle)?.userDoc?.uid;
    if (!viewerUid || !profileUid || viewerUid === profileUid) return false;
    const e = blockStatusCache.get(`${viewerUid}:${profileUid}`);
    return !(e && Date.now() - e.cachedAt < BLOCK_STATUS_TTL_MS);
  });
  const [pendingUnblock, setPendingUnblock] = useState(false);
  const prevBlockedByViewerRef = useRef(false);

  const [uploading, setUploading] = useState(false);
  const [savingProfileRestricted, setSavingProfileRestricted] = useState(false);
  const [savingMessagePolicy, setSavingMessagePolicy] = useState(false);
  const [savingProfileComments, setSavingProfileComments] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  // Refs a las <img> de portada/avatar: en algunos navegadores el onLoad no dispara
  // para imágenes ya cacheadas, así que también comprobamos `.complete` por ref para
  // que el skeleton nunca se quede pegado.
  const coverImgRef = useRef<HTMLImageElement | null>(null);
  const avatarImgRef = useRef<HTMLImageElement | null>(null);

  const [avatarRenderUrl, setAvatarRenderUrl] = useState<string | null>(null);
  const [coverRenderUrl, setCoverRenderUrl] = useState<string | null>(null);
  // Skeleton mientras cargan la portada y la foto (se ocultan al onLoad de la imagen).
  const [coverLoaded, setCoverLoaded] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);

  // Alimentar el header contextual del layout con avatar y nombre del perfil
  const mobileHeaderAvatar = avatarRenderUrl || userDoc?.photoURL || null;
  const mobileHeaderName = userDoc
    ? userDoc.displayName ||
      `${userDoc.firstName ?? ""} ${userDoc.lastName ?? ""}`.trim() ||
      null
    : null;
  useSetMobileHeader(mobileHeaderAvatar, mobileHeaderName);

  const [activeTab, setActiveTab] = useState<ProfileTabKey>("posts");
  const tabSwitchScrollY = useRef<number | null>(null);

  // Búsqueda dentro del perfil (lupa en la portada).
  const [coverSearchOpen, setCoverSearchOpen] = useState(false);
  const [postSearchQuery, setPostSearchQuery] = useState("");
  const postsFeedAnchorRef = useRef<HTMLDivElement | null>(null);

  const handleCoverSearchSubmit = useCallback((query: string) => {
    setPostSearchQuery(query);
    setActiveTab("posts");
    // Deja renderizar y hace scroll a donde inician las publicaciones. Si hay
    // card de donación activo (arriba del feed), baja un poco más para saltarlo.
    window.setTimeout(() => {
      const anchor = postsFeedAnchorRef.current;
      if (!anchor) return;
      const HEADER_OFFSET = 64;
      const banner = document.querySelector(
        '[data-cover-donation-banner="true"]'
      ) as HTMLElement | null;
      const donationOffset = banner ? banner.offsetHeight + 12 : 0;
      const top =
        window.scrollY +
        anchor.getBoundingClientRect().top -
        HEADER_OFFSET +
        donationOffset;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }, 130);
  }, []);

  const closeCoverSearch = useCallback(() => {
    setCoverSearchOpen(false);
    setPostSearchQuery("");
  }, []);

  const handleTabChange = useCallback((tab: ProfileTabKey) => {
    tabSwitchScrollY.current = window.scrollY;
    setActiveTab(tab);
  }, []);

  useLayoutEffect(() => {
    if (tabSwitchScrollY.current !== null) {
      window.scrollTo({ top: tabSwitchScrollY.current, behavior: "instant" });
      tabSwitchScrollY.current = null;
    }
  }, [activeTab]);

  // Dirección del slide entre pestañas (misma UX que Wallet):
  // +1 = la pestaña nueva entra desde la derecha, -1 = desde la izquierda.
  const prevTabRef = useRef<ProfileTabKey>(activeTab);
  const tabSlideDirection = useMemo(() => {
    const prev = prevTabRef.current;
    if (prev === activeTab) return 0;
    return PROFILE_TAB_ORDER[activeTab] > PROFILE_TAB_ORDER[prev] ? 1 : -1;
  }, [activeTab]);
  useEffect(() => {
    prevTabRef.current = activeTab;
  }, [activeTab]);

  const [donationViewerOpen, setDonationViewerOpen] = useState(false);
  const [greetOpen, setGreetOpen] = useState(false);
const [greetSubmitting, setGreetSubmitting] = useState(false);
// Pago del saludo (segundo modal con el Payment Brick de MP).
const [payGreetOpen, setPayGreetOpen] = useState(false);
const [payGreetId, setPayGreetId] = useState<string | null>(null);
const [payGreetAmount, setPayGreetAmount] = useState<number | null>(null);
const [payGreetLabel, setPayGreetLabel] = useState<string | undefined>(undefined);
// Pago de sesión exclusiva (segundo modal con el Payment Brick).
const [paySessionOpen, setPaySessionOpen] = useState(false);
const [paySessionId, setPaySessionId] = useState<string | null>(null);
const [paySessionAmount, setPaySessionAmount] = useState<number | null>(null);
const [paySessionLabel, setPaySessionLabel] = useState<string | undefined>(undefined);
const [paySessionDuration, setPaySessionDuration] = useState<number | null>(null);
// Pago de "Tiempo contigo" (segundo modal con el Payment Brick).
const [payMeetOpen, setPayMeetOpen] = useState(false);
const [payMeetId, setPayMeetId] = useState<string | null>(null);
const [payMeetAmount, setPayMeetAmount] = useState<number | null>(null);
const [payMeetLabel, setPayMeetLabel] = useState<string | undefined>(undefined);
const [payMeetDuration, setPayMeetDuration] = useState<number | null>(null);
const [greetType, setGreetType] = useState<GreetingType>("saludo");
const [toName, setToName] = useState("");
const [instructions, setInstructions] = useState("");
const [isRetry, setIsRetry] = useState(false);
// Reintento: cobra en un clic con la tarjeta guardada al abrir la pasarela (sin que el
// usuario la toque). Se captura al enviar y se resetea al cerrar la pasarela.
const [autoConfirmPay, setAutoConfirmPay] = useState(false);
const [allowCreatorStory, setAllowCreatorStory] = useState(true);
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
const liveDotOuter = mobileRefreshEnabled ? "clamp(18px, 3.8vw, 30px)" : "clamp(14px, 2.8vw, 24px)";
const liveDotInner = mobileRefreshEnabled ? "clamp(10px, 2.1vw, 16px)" : "clamp(8px, 1.6vw, 13px)";
const liveDotShell = mobileRefreshEnabled ? "clamp(22px, 4.8vw, 34px)" : "clamp(18px, 3.6vw, 28px)";
const avatarOffsetTopSz = mobileRefreshEnabled ? "calc(clamp(146px, 31.2vw, 286px) / -2)" : "calc(clamp(112px, 24vw, 220px) / -2)";
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
    'inherit';

  const isOwner = !!viewer && !!userDoc && viewer.uid === userDoc.uid;
  const profileUid = userDoc?.uid ?? null;

  // El hueco bajo el avatar solo tiene que dar cabida al "Editar" cuando el
  // perfil es tuyo; a quien visita no le sobra espacio muerto.
  const avatarBottomReserve = isOwner ? (mobileRefreshEnabled ? 40 : 36) : 22;
  const contentTopPaddingSz = mobileRefreshEnabled
    ? `calc((clamp(146px, 31.2vw, 286px) / 2) + ${avatarBottomReserve}px)`
    : `calc((clamp(112px, 24vw, 220px) / 2) + ${avatarBottomReserve}px)`;

  // Datos personales del perfil (fecha de nacimiento, sexo, correo). Solo los
  // puede leer su dueño: viven fuera del documento público.
  const privateProfile = usePrivateProfile(profileUid, isOwner);

  // Track last visit so the sidebar can show new-post counts
  useEffect(() => {
    if (profileUid) setLastVisitTimestamp(profileUid);
  }, [profileUid]);

  const { ring: profileRing, stories: profileRingStories, startIndex: profileRingStart } =
    useStoryRingState(
      !isOwner && (blockStatusLoading || profileBlockedByViewer || viewerBlockedByProfile || pendingUnblock)
        ? null
        : profileUid,
      "profile",
      viewer?.uid ?? null,
    );
  const { isLive: profileIsLive, livePostId: profileLivePostId } = useLiveRingState(
    !isOwner && (blockStatusLoading || profileBlockedByViewer || viewerBlockedByProfile || pendingUnblock)
      ? null
      : profileUid,
    "profile"
  );
  const [profileLivePost, setProfileLivePost] = useState<Post | null>(null);
  const [profileLiveViewerOpen, setProfileLiveViewerOpen] = useState(false);
  const [profileStoriesOpen, setProfileStoriesOpen] = useState(false);
  const [profileStoriesSourceRect, setProfileStoriesSourceRect] = useState<DOMRect | null>(null);
  const profileAvatarBtnRef = useRef<HTMLButtonElement>(null);

  const ownerShowPosts = userDoc?.showPosts ?? true;
  const ownerShowGroups = userDoc?.showCreatedGroups ?? true;
  const profileRestricted = userDoc?.profileRestricted ?? false;
  const profileCommentsEnabled = userDoc?.profileCommentsEnabled !== false;
  const messagePolicy: MessagePolicy = userDoc?.messagePolicy ?? DEFAULT_MESSAGE_POLICY;

  const isProfileRestrictedForVisitor = !isOwner && profileRestricted;

  const profileBlockedByRelationship =
    !isOwner && (profileBlockedByViewer || viewerBlockedByProfile);

  const checkingProfileBlock =
    authReady && !!viewer && !!profileUid && !isOwner && blockStatusLoading;

  const shouldHideProfileSocialContent =
    !isOwner && (checkingProfileBlock || profileBlockedByRelationship || pendingUnblock);

  const visitorCanSeePosts =
    !shouldHideProfileSocialContent &&
    !isProfileRestrictedForVisitor &&
    (userDoc?.showPosts ?? true);

  const visitorCanSeeGroups =
    !shouldHideProfileSocialContent && (userDoc?.showCreatedGroups ?? true);

  const showPostsTab = isOwner ? true : visitorCanSeePosts;
  const showGroupsTab = isOwner ? true : visitorCanSeeGroups;

  // El subnav de secciones es SOLO del dueño: es quien tiene algo que elegir
  // (publicaciones, comunidades, servicios, ajustes). Quien visita ve las
  // publicaciones directamente, y va a las comunidades por el texto morado que
  // se pinta bajo el subnav de medios.
  const shouldShowSubnav = isOwner;

  // Quien visita puede saltar a las comunidades de este perfil, y volver. Las
  // dos direcciones dependen de lo mismo: que el perfil las tenga a la vista.
  const visitorCanJumpToGroups = !isOwner && visitorCanSeeGroups;

  const followersCount =
    typeof userDoc?.followersCount === "number" && userDoc.followersCount > 0
      ? userDoc.followersCount
      : 0;

  // La cifra y su palabra van por separado: en la fila de datos ocupan renglones
  // distintos, y `followersLabel` sigue armado para leerse de corrido en el
  // lector de pantalla, donde partirlo en dos no significaría nada.
  const followersCountText = followersCount.toLocaleString(intlLocale(locale));
  const followersWord =
    followersCount === 1 ? tProfile("follower") : tProfile("followers");
  // La etiqueta accesible va en minúscula, como se dice: "1,234 seguidores". La
  // mayúscula es solo del renglón de la fila, donde la palabra va sola.
  const followersLabel = `${followersCountText} ${followersWord}`;

  // Publicaciones del perfil. `null` mientras no se sabe: el card enseña un
  // guion en vez de un cero, que se leería como "no ha publicado nada".
  const [profilePostsCount, setProfilePostsCount] = useState<number | null>(null);

  // El numero guardado en el documento manda, y es el que hace que el dato se
  // vea tambien desde fuera: un perfil restringido no deja CONTAR sus
  // publicaciones —la consulta pasa por las reglas de lectura— pero su documento
  // si es publico. Lo mantiene el servidor (backend/src/entityCounters.ts).
  const postsCountFromDoc =
    typeof userDoc?.postsCount === "number" && userDoc.postsCount >= 0
      ? userDoc.postsCount
      : null;

  useEffect(() => {
    // Con el numero del documento no hace falta preguntar. La consulta se queda
    // de respaldo para los perfiles que aun no pasaron por el backfill, y solo
    // donde las reglas la permiten.
    if (!profileUid || postsCountFromDoc !== null || !showPostsTab) {
      setProfilePostsCount(null);
      return;
    }

    const cached = peekProfilePostsCount(profileUid);
    if (cached !== null) {
      setProfilePostsCount(cached);
      return;
    }

    let alive = true;
    fetchProfilePostsCount(profileUid)
      .then((count) => {
        profilePostsCountCache.set(profileUid, { count, cachedAt: Date.now() });
        if (alive) setProfilePostsCount(count);
      })
      .catch(() => {
        // Que falle el conteo no debe tumbar la portada: el card se queda con el
        // guion y todo lo demás sigue igual.
        if (alive) setProfilePostsCount(null);
      });

    return () => {
      alive = false;
    };
  }, [profileUid, showPostsTab]);

  // El guion mientras el conteo va en camino (o si falló): un cero se leería
  // como "no ha publicado nada", que es una afirmación y no una espera.
  const postsCountShown = postsCountFromDoc ?? profilePostsCount;
  const postsCountText =
    postsCountShown === null
      ? "—"
      : postsCountShown.toLocaleString(intlLocale(locale));
  const postsWord =
    postsCountShown === 1 ? tCommon("publication") : tCommon("publications");

  // El dato de experiencias NO aparece hasta la primera venta. Un "0
  // Experiencias" en cada perfil nuevo diría lo contrario de lo que el dato
  // busca decir.
  const experiencesCount =
    typeof userDoc?.experiencesCount === "number" && userDoc.experiencesCount > 0
      ? userDoc.experiencesCount
      : 0;

function openFollowersOverlay() {
  if (!isOwner) return;
  setFollowersOverlayOpen(true);
}

const handleProfilePullRefresh = useCallback(async () => {
  clearAllPostFeedCaches();
  clearMediaGalleryCache();
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

    // Usuario NO logueado: solo publicaciones (sin subnav ni comunidades).
    if (!viewer) {
      if (activeTab !== "posts") setActiveTab("posts");
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
    viewer,
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
      fontWeight: 500,
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

const formatMoney = (value: number, currency?: string) =>
  priceFmt.format(value, { baseCurrency: (currency ?? SETTLEMENT_CURRENCY) as DisplayCurrency, code: true });

// Igual que formatMoney pero con IVA INCLUIDO (total según país del comprador). Para
// los labels de los botones "Continuar al pago" de los paneles de solicitud, que deben
// mostrar el total todo-incluido (la pasarela sigue recibiendo el monto base aparte).
const formatMoneyWithTax = (value: number, currency?: string) =>
  priceFmt.formatWithTax(value, { baseCurrency: (currency ?? SETTLEMENT_CURRENCY) as DisplayCurrency, code: true }).total;

function getProfileService(type: CreatorServiceType) {
  return getServiceByType(userDoc?.offerings ?? null, type, "profile");
}

function getServicePriceLabel(type: CreatorServiceType) {
  const service = getProfileService(type);
  const price = service?.publicPrice ?? service?.memberPrice ?? null;
  const currency = service?.currency ?? SETTLEMENT_CURRENCY;

  if (typeof price !== "number") return tServices("priceToConfirm");
  // Total todo-incluido (base del creador + cargo fijo + impuesto del país): es lo que el botón
  // "Continuar al pago" del panel de solicitud debe mostrar.
  return formatMoneyWithTax(price + FIXED_SERVICE_FEE_USD, currency);
}

function getServiceDurationLabel(type: CreatorServiceType) {
  const service = getProfileService(type);
  const minutes = service?.durationMinutes ?? null;
  if (typeof minutes !== "number") return tServices("durationToConfirm");
  return `${minutes} ${tCommon("minutes")}`;
}

function resetGreetingModal() {
  setGreetOpen(false);
  setGreetSubmitting(false);
  setGreetError(null);
  setGreetSuccess(null);
  setToName("");
  setInstructions("");
  setAllowCreatorStory(true);
  setIsRetry(false);
}

function resetMeetGreetModal() {
  setMeetGreetOpen(false);
  setMeetGreetSubmitting(false);
  setMeetGreetError(null);
  setMeetGreetMessage("");
  setIsRetry(false);
}

function resetExclusiveSessionModal() {
  setExclusiveSessionOpen(false);
  setExclusiveSessionSubmitting(false);
  setExclusiveSessionError(null);
  setExclusiveSessionMessage("");
  setIsRetry(false);
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
        setMsg(tProfile("userNotFound"));
        setLoading(false);
        return;
      }

      const hdata = hs.docs[0].data() as { uid?: string };
      const uid = hdata?.uid;

      if (!uid) {
        setUserDoc(null);
        setMsg(tProfile("invalidHandle"));
        setLoading(false);
        return;
      }

      const uref = doc(db, "users", uid);

      unsubProfile = onSnapshot(
        uref,
        (usnap) => {
          if (!usnap.exists()) {
            setUserDoc(null);
            setMsg(tProfile("profileNotFound"));
            setLoading(false);
            return;
          }

          const nextUserDoc: UserDoc = {
            uid,
            ...(usnap.data() as Omit<UserDoc, "uid">),
          };

          profileCache.set(handle, { userDoc: nextUserDoc, updatedAt: Date.now() });

          setUserDoc(nextUserDoc);
          setMsg(null);
          setLoading(false);
        },
        (error) => {
          setUserDoc(null);
          setMsg(error?.message ?? tProfile("profileLoadError"));
          setLoading(false);
        }
      );
    } catch (e: unknown) {
      if (cancelled) return;

      setMsg((e instanceof Error ? e.message : null) ?? tProfile("profileLoadError"));
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
    return;
  }

  setBlockStatusLoading(true);

  let viewerBlockReady = false;
  let profileBlockReady = false;
  // Track latest values so we can write to cache once both are resolved
  const resolved = { viewerHasBlocked: false, viewerIsBlocked: false };
  const blockCacheKey = `${viewer.uid}:${profileUid}`;

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
      resolved.viewerHasBlocked = snap.exists();
      setProfileBlockedByViewer(snap.exists());

      if (viewerBlockReady && profileBlockReady) {
        blockStatusCache.set(blockCacheKey, { ...resolved, cachedAt: Date.now() });
        setBlockStatusLoading(false);
      }
    },
    () => {
      viewerBlockReady = true;
      resolved.viewerHasBlocked = false;
      setProfileBlockedByViewer(false);

      if (viewerBlockReady && profileBlockReady) {
        blockStatusCache.set(blockCacheKey, { ...resolved, cachedAt: Date.now() });
        setBlockStatusLoading(false);
      }
    }
  );

  const unsubProfileBlockedViewer = onSnapshot(
    profileBlockedViewerRef,
    (snap) => {
      profileBlockReady = true;
      resolved.viewerIsBlocked = snap.exists();
      setViewerBlockedByProfile(snap.exists());

      if (viewerBlockReady && profileBlockReady) {
        blockStatusCache.set(blockCacheKey, { ...resolved, cachedAt: Date.now() });
        setBlockStatusLoading(false);
      }
    },
    () => {
      profileBlockReady = true;
      resolved.viewerIsBlocked = false;
      setViewerBlockedByProfile(false);

      if (viewerBlockReady && profileBlockReady) {
        blockStatusCache.set(blockCacheKey, { ...resolved, cachedAt: Date.now() });
        setBlockStatusLoading(false);
      }
    }
  );

  return () => {
    unsubViewerBlockedProfile();
    unsubProfileBlockedViewer();
  };
}, [authReady, viewer, profileUid, isOwner]);

// Detect block→unblock transition to prevent race condition:
// Firestore local snapshot fires before batch.commit() is confirmed by server,
// so we gate the feed behind pendingUnblock until the server write is confirmed.
useEffect(() => {
  if (prevBlockedByViewerRef.current && !profileBlockedByViewer && !viewerBlockedByProfile) {
    setPendingUnblock(true);
  }
  prevBlockedByViewerRef.current = profileBlockedByViewer;
}, [profileBlockedByViewer, viewerBlockedByProfile]);

/**
 * Baja el compás de espera venga el desbloqueo de donde venga.
 *
 * `pendingUnblock` existe para aguantar hasta que el servidor confirme el
 * borrado, pero solo lo bajaba el menú de ESTA página. Al desbloquear desde el
 * chat o desde ajustes, la transición se detectaba aquí y ya no la bajaba nadie:
 * el perfil se quedaba restringido para siempre, sin ninguna forma de salir de
 * ese estado desde la interfaz.
 */
useEffect(() => {
  if (!pendingUnblock) return;
  if (profileBlockedByViewer || viewerBlockedByProfile) return;

  const timer = setTimeout(() => {
    setPendingUnblock(false);
    setProfilePostsRefreshKey((v) => v + 1);
  }, 600);

  return () => clearTimeout(timer);
}, [pendingUnblock, profileBlockedByViewer, viewerBlockedByProfile]);

function handleUnblockConfirmed() {
  setPendingUnblock(false);
  setProfilePostsRefreshKey((v) => v + 1);
}

function handleUnblockFailed() {
  setPendingUnblock(false);
}

  useEffect(() => {
  if (!authReady || !userDoc) return;

  const service = searchParams.get("service") as CreatorServiceType | null;
  if (!service) return;

  if (!viewer) {
    redirectToLogin();
    return;
  }

  if (viewer.uid === userDoc.uid) {
    setServiceToast(tGroups("ownCommunityService"));
    closeServiceQueryParam();
    return;
  }

  const retry = searchParams.get("retry") === "true";
  const prefillToName = searchParams.get("toName") ?? "";
  const prefillInstructions = searchParams.get("instructions") ?? "";
  const prefillMessage = searchParams.get("message") ?? "";

  if (service === "saludo" || service === "consejo") {
    setGreetType(service as GreetingType);
    if (retry) {
      setIsRetry(true);
      if (prefillToName) setToName(prefillToName);
      if (prefillInstructions) setInstructions(prefillInstructions);
    }
    setGreetOpen(true);
    closeServiceQueryParam();
    return;
  }

  if (service === "meet_greet_digital") {
    if (retry) {
      setIsRetry(true);
      if (prefillMessage) setMeetGreetMessage(prefillMessage);
    }
    setMeetGreetOpen(true);
    closeServiceQueryParam();
    return;
  }

  if (service === "clase_personalizada") {
    if (retry) {
      setIsRetry(true);
      if (prefillMessage) setExclusiveSessionMessage(prefillMessage);
    }
    setExclusiveSessionOpen(true);
    closeServiceQueryParam();
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [authReady, searchParams, userDoc, viewer]);

// Deep-link desde el onboarding de la Wallet ("Comenzar ahora"): abre la
// pestaña de servicios y centra en pantalla la card del servicio indicado para
// animar a activarlo. Solo aplica al dueño de su propio perfil.
useEffect(() => {
  if (!authReady || !userDoc || !isOwner) return;
  const configure = searchParams.get("configure");
  if (!configure) return;
  setActiveTab("services");

  // La pestaña se monta tras el cambio de estado (con animación de slide) y las
  // cards pueden cambiar de alto tras la primera medición (data async, la última
  // card sobre todo). Por eso hacemos un bucle CONVERGENTE: recalculamos la
  // posición cada ~120ms y re-centramos hasta que el objetivo se estabilice.
  // Usamos scroll de ventana porque el contenedor de pestañas es overflow:hidden
  // y scrollIntoView es poco fiable ahí.
  let cancelled = false;
  const timers: number[] = [];
  let lastTop = -1;
  let stable = 0;
  let attempts = 0;
  const tick = () => {
    if (cancelled) return;
    attempts++;
    const el = document.getElementById(`exp-${configure}`);
    if (el) {
      const rect = el.getBoundingClientRect();
      const target = Math.max(
        0,
        window.scrollY + rect.top - window.innerHeight / 2 + rect.height / 2
      );
      if (Math.abs(target - lastTop) > 2) {
        window.scrollTo({ top: target, behavior: "smooth" });
        lastTop = target;
        stable = 0;
      } else {
        stable++;
      }
      if (stable < 4 && attempts < 60) timers.push(window.setTimeout(tick, 120));
      return;
    }
    if (attempts < 60) timers.push(window.setTimeout(tick, 120));
  };
  timers.push(window.setTimeout(tick, 150));
  return () => {
    cancelled = true;
    timers.forEach((t) => window.clearTimeout(t));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [authReady, userDoc, isOwner, searchParams]);

// Deep-link "Crea tu primera transmisión" desde el onboarding: abre el composer
// de live del perfil. El modal vive en la pestaña de posts (la predeterminada).
useEffect(() => {
  if (!authReady || !userDoc || !isOwner) return;
  if (searchParams.get("compose") !== "live") return;
  setActiveTab("posts");
  const timer = window.setTimeout(() => setIsProfileLiveModalOpen(true), 180);
  return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [authReady, userDoc, isOwner, searchParams]);

// Deep-link "Crea tu primera publicación premium": asegura la pestaña de posts
// para que el composer (que abre premium por su prop autoOpenPremium) esté montado.
useEffect(() => {
  if (!authReady || !userDoc || !isOwner) return;
  if (searchParams.get("compose") !== "premium") return;
  setActiveTab("posts");
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [authReady, userDoc, isOwner, searchParams]);

// Deep-link desde la notificación colectiva de nuevos seguidores: abre la lista
// de seguidores (solo el dueño puede verla) y limpia la URL.
useEffect(() => {
  if (!authReady || !userDoc || !isOwner) return;
  if (searchParams.get("followers") !== "1") return;
  setFollowersOverlayOpen(true);
  router.replace(pathname || `/u/${handle}`, { scroll: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [authReady, userDoc, isOwner, searchParams]);

  useEffect(() => {
    setAvatarRenderUrl(userDoc?.photoURL ?? null);
    setCoverRenderUrl(userDoc?.coverUrl ?? null);
  }, [userDoc?.photoURL, userDoc?.coverUrl]);

  // Re-mostrar el skeleton cuando cambia la fuente de la portada/foto (carga inicial
  // o subida de una nueva); se oculta con el onLoad de la <Image>.
  useEffect(() => {
    setCoverLoaded(false);
    // Si la imagen ya está cacheada, onLoad puede no dispararse: detectamos
    // completitud por ref, reintentamos unos frames, y como último recurso un
    // fallback por tiempo garantiza que el skeleton NUNCA se quede pegado.
    let cancelled = false;
    const settle = () => {
      if (cancelled) return;
      const img = coverImgRef.current;
      if (img && img.complete && img.naturalWidth > 0) setCoverLoaded(true);
    };
    settle();
    const raf = requestAnimationFrame(settle);
    const polls = [150, 400, 900].map((ms) => setTimeout(settle, ms));
    const fb = setTimeout(() => { if (!cancelled) setCoverLoaded(true); }, 2500);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      polls.forEach(clearTimeout);
      clearTimeout(fb);
    };
  }, [coverRenderUrl, userDoc?.coverUrl]);
  useEffect(() => {
    setAvatarLoaded(false);
    let cancelled = false;
    const settle = () => {
      if (cancelled) return;
      const img = avatarImgRef.current;
      if (img && img.complete && img.naturalWidth > 0) setAvatarLoaded(true);
    };
    settle();
    const raf = requestAnimationFrame(settle);
    const polls = [150, 400, 900].map((ms) => setTimeout(settle, ms));
    const fb = setTimeout(() => { if (!cancelled) setAvatarLoaded(true); }, 2500);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      polls.forEach(clearTimeout);
      clearTimeout(fb);
    };
  }, [avatarRenderUrl, userDoc?.photoURL]);

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
        // `cfError` y no `.message`: los avisos de `image-normalizer` se
        // lanzan en español y este mapa es quien los traduce.
        showProfileToast((e instanceof Error ? cfError(e) : null) ?? tCommon("imageReadError"), "error");
      }
    },
    [isOwner]
  );

  const handleProfileLiveClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!profileLivePostId) return;
    try {
      const snap = await getDoc(doc(db, "posts", profileLivePostId));
      if (snap.exists()) {
        setProfileLivePost({ id: snap.id, ...snap.data() } as Post);
        setProfileLiveViewerOpen(true);
      }
    } catch {
      // silencioso — el live puede haber terminado justo antes del clic
    }
  }, [profileLivePostId]);

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

    // La subida vive en lib/posts/createProfilePost para poder publicar también
    // desde el home. Aquí solo queda conectar textos, progreso y errores.
    const result = await createProfilePost({
      profileUid: userDoc.uid,
      payload,
      labels: {
        validatingVideos: tProfile("validatingVideos"),
        uploadingCovers: tProfile("uploadingCovers"),
        preparingUpload: tProfile("preparingUpload"),
        preparePostError: tProfile("preparePostError"),
        creatingPost: tProfile("creatingPost"),
        uploadingVideo: (index, total) => tProfile("uploadingVideo", { index, total }),
        videosUploaded: tProfile("videosUploaded"),
      },
      onStatus: setProfileVideoUploadStatus,
      onProgress: setProfileVideoUploadProgress,
    });

    if (!result.ok) {
      setProfileComposerError(
        result.reason === "tooManyVideos"
          ? tProfile("maxVideosError")
          : tProfile("videoDurationError")
      );
      return;
    }

    clearAllPostFeedCaches();
    setProfilePostsRefreshKey((value) => value + 1);
    showProfileToast(tProfile("postCreated"), "success");

    window.setTimeout(() => {
      setProfileVideoUploadProgress(null);
      setProfileVideoUploadStatus(null);
    }, 2500);
  } catch (e: unknown) {
    setProfileComposerError((e instanceof Error ? e.message : null) ?? tProfile("postError"));
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

      showProfileToast(nextValue ? tProfile("profileReservedActive") : tProfile("profilePublicActive"), "success");
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string } | null;
      showProfileToast(
        err?.code === "permission-denied"
          ? tProfile("firestorePermissionError")
          : tProfile("privacyUpdateError"),
        "error"
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

  async function handleChangeMessagePolicy(next: MessagePolicy) {
    if (!userDoc || !isOwner) return;

    setSavingMessagePolicy(true);

    try {
      await updateMessagePolicy(userDoc.uid, next);

      setUserDoc((prev) => (prev ? { ...prev, messagePolicy: next } : prev));
    } catch (e: unknown) {
      throw e;
    } finally {
      setSavingMessagePolicy(false);
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

async function handleUpdateSocialLinks(draft: Record<string, string>) {
  if (!userDoc || !isOwner) return;
  const saved = await updateProfileSocialLinks(draft);
  setUserDoc((prev) => (prev ? { ...prev, socialLinks: saved } : prev));
}

async function handleSendPasswordReset() {
  const email = viewer?.email;

  if (!email) {
    throw new Error(tCommon("noEmailFound"));
  }

  await sendPasswordResetEmail(auth, email);
}

  async function uploadCropped(mode: CropMode) {
    if (!userDoc || !isOwner) return;

    if (!cropImageSrc || !croppedAreaPixels) {
      showProfileToast(tCommon("cropError"), "error");
      return;
    }

    setUploading(true);

    try {
      const uid = userDoc.uid;

      // El avatar se pinta como mucho a ~150 px (la ficha del perfil); 512
      // cubre pantallas de densidad 3x con margen. La portada es una banda
      // ancha, así que se le deja 1 600.
      const blob = await getCroppedBlob(
        cropImageSrc,
        croppedAreaPixels,
        "image/jpeg",
        mode === "avatar" ? AVATAR_MAX_PX : COVER_MAX_PX
      );

      const path =
        mode === "avatar"
          ? `users/${uid}/avatar/avatar.jpg`
          : `users/${uid}/cover/cover.jpg`;

      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, blob, { contentType: "image/jpeg", cacheControl: IMAGE_CACHE_CONTROL });

      const rawUrl = await getDownloadURL(fileRef);
      const freshUrl = `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;

      const uref = doc(db, "users", uid);

      if (mode === "avatar") {
        setAvatarRenderUrl(freshUrl);
        setUserDoc((prev) => (prev ? { ...prev, photoURL: freshUrl } : prev));
        await updateDoc(uref, { photoURL: freshUrl });
        showProfileToast(tProfile("photoUpdated"), "success");
      } else {
        setCoverRenderUrl(freshUrl);
        setUserDoc((prev) => (prev ? { ...prev, coverUrl: freshUrl } : prev));
        await updateDoc(uref, { coverUrl: freshUrl });
        showProfileToast(tProfile("coverUpdated"), "success");
      }

      setCropOpen(false);
      setCropImageSrc("");
      setCroppedAreaPixels(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);

    } catch (e: unknown) {
      const err = e as { code?: string; message?: string } | null;
      showProfileToast(
        err?.code === "permission-denied"
          ? tCommon("storagePermissionError")
          : tCommon("imageUploadError"),
        "error"
      );
    } finally {
      setUploading(false);
    }
  }

async function handleSubmitGreeting() {
  if (!userDoc || !viewer) return;

  if (!toName.trim()) {
    setGreetError(tProfile("greetingToHint"));
    return;
  }
  if (!instructions.trim()) {
    setGreetError(tProfile("greetingInstructionsHint"));
    return;
  }

  setGreetSubmitting(true);
  setGreetError(null);
  setGreetSuccess(null);

  try {
const res = await createGreetingRequest({
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

    // El saludo queda en awaiting_payment; abrimos el segundo modal (Brick) para
    // cobrar. La geo/éxito se registra cuando el pago aprueba (onPaid).
    const svc = getProfileService(greetType);
    const amount =
      res.priceSnapshot ?? svc?.publicPrice ?? svc?.memberPrice ?? null;
    const currency = svc?.currency ?? SETTLEMENT_CURRENCY;

    setGreetOpen(false);
    setToName("");
    setInstructions("");
    setGreetSuccess(null);
    setPayGreetId(res.requestId);
    setPayGreetAmount(amount);
    setPayGreetLabel(typeof amount === "number" ? formatMoney(amount, currency) : undefined);
    setAutoConfirmPay(isRetry); // reintento → cobro un-clic con tarjeta guardada
    setPayGreetOpen(true);
  } catch (e: unknown) {
    setGreetError((e instanceof Error ? e.message : null) ?? tServices("requestError"));
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

const res = (await createMeetGreetRequest({
  source: "profile",
  requestSource: "profile",
  profileUserId: userDoc.uid,
  creatorId: userDoc.uid,
  groupId: null,
  buyerMessage: meetGreetMessage,
  priceSnapshot: service?.publicPrice ?? service?.memberPrice ?? null,
  durationMinutes: (service as (NormalizedService & { durationMinutes?: number }) | null)?.durationMinutes ?? null,
})) as { requestId: string; priceSnapshot?: number | null };

    // Solicitud en awaiting_payment → abrir el segundo modal (Brick) para cobrar.
    const amount = res.priceSnapshot ?? service?.publicPrice ?? service?.memberPrice ?? null;
    const currency = service?.currency ?? SETTLEMENT_CURRENCY;

    setMeetGreetOpen(false);
    setMeetGreetMessage("");
    setPayMeetId(res.requestId);
    setPayMeetAmount(amount);
    setPayMeetLabel(typeof amount === "number" ? formatMoney(amount, currency) : undefined);
    setPayMeetDuration(
      (service as (NormalizedService & { durationMinutes?: number }) | null)?.durationMinutes ?? null
    );
    setAutoConfirmPay(isRetry); // reintento → cobro un-clic con tarjeta guardada
    setPayMeetOpen(true);
  } catch (e: unknown) {
    setMeetGreetError((e instanceof Error ? e.message : null) ?? tServices("requestError"));
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

const res = (await createExclusiveSessionRequest({
  source: "profile",
  requestSource: "profile",
  profileUserId: userDoc.uid,
  creatorId: userDoc.uid,
  groupId: null,
  buyerMessage: exclusiveSessionMessage,
  priceSnapshot: service?.publicPrice ?? service?.memberPrice ?? null,
  durationMinutes: (service as (NormalizedService & { durationMinutes?: number }) | null)?.durationMinutes ?? null,
})) as { requestId: string; priceSnapshot?: number | null };

    // Sesión en awaiting_payment → abrir el segundo modal (Brick) para cobrar.
    const amount = res.priceSnapshot ?? service?.publicPrice ?? service?.memberPrice ?? null;
    const currency = service?.currency ?? SETTLEMENT_CURRENCY;

    setExclusiveSessionOpen(false);
    setExclusiveSessionMessage("");
    setPaySessionId(res.requestId);
    setPaySessionAmount(amount);
    setPaySessionLabel(typeof amount === "number" ? formatMoney(amount, currency) : undefined);
    setPaySessionDuration(
      (service as (NormalizedService & { durationMinutes?: number }) | null)?.durationMinutes ?? null
    );
    setAutoConfirmPay(isRetry); // reintento → cobro un-clic con tarjeta guardada
    setPaySessionOpen(true);
  } catch (e: unknown) {
    setExclusiveSessionError((e instanceof Error ? e.message : null) ?? tServices("requestError"));
  } finally {
    setExclusiveSessionSubmitting(false);
  }
}

  if (loading) {
    // Sin spinner: skeleton del encabezado (portada, avatar, nombre, datos,
    // descripción, botón, historias y cards de servicios) con la base canónica
    // .vb-skel. Al llegar los datos, el contenido real entra con fade (ver
    // .profile-card en el styled-jsx del render principal).
    return (
      <main style={{ minHeight: "var(--vb-alto-pantalla)", background: "#000", fontFamily: fontStack }}>
        <ProfileHeaderSkeleton maxWidth={ui.pageMaxWidth} />
      </main>
    );
  }

  if (!userDoc) {
    return (
      <main
        style={{
          minHeight: "var(--vb-alto-pantalla)",
          background: "#000",
          color: "#fff",
          // Clearance del bottom-nav lo aporta `.mainCol` del layout; no duplicar.
          padding: "0 0 0",
          fontFamily: fontStack,
        }}
      >
        <div style={{ maxWidth: ui.pageMaxWidth, margin: "0 auto", padding: "0" }}>
          {msg ?? tProfile("profileUnavailable")}
        </div>
      </main>
    );
  }

  const fullName =
    userDoc.displayName || `${userDoc.firstName} ${userDoc.lastName}`.trim();

  // El adjetivo suelto: en la fila de datos va debajo de la palabra "Perfil",
  // en renglón aparte. Partir la frase completa por el espacio no serviría —
  // en alemán el orden se invierte y en chino no hay espacio que partir.
  const profileVisibilityWord = profileRestricted
    ? tProfile("reserved")
    : tProfile("public");

  // La fecha de nacimiento salió del documento público del perfil (lo lee
  // cualquiera y Firestore no oculta campos sueltos). Se lee del documento
  // privado, solo cuando quien mira es el dueño. El fallback a `userDoc`
  // sostiene a los perfiles que aún no pasaron por la migración.
  const normalizedBirthDate = normalizeDateValue(
    privateProfile?.birthDate ?? userDoc.birthDate ?? null
  );
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
    // SIN min-height de pantalla completa. Este <main> es transparente, así que
    // estirarlo no pintaba nada: el fondo negro ya lo garantiza `body` en
    // globals.css (`min-height: 100dvh` + `background-color: #000`). Lo único
    // que hacía era empujar altura, y en las pestañas cortas —comunidades,
    // seguidos— dejaba media pantalla de vacío al final del scroll.
    // Clearance del bottom-nav lo aporta `.mainCol` del layout; no duplicar.
    padding: "0 0 0",
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
            /* El contenido real no aparece de golpe tras el skeleton: fade-in
               suave al montar (cuando ya llegaron los datos del perfil). */
            animation: vbProfileReveal var(--duration-slow, 400ms) var(--ease-out, ease) both;
          }
          @keyframes vbProfileReveal {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .profile-card {
              animation: none;
            }
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
  padding: 0 18px 8px;
  min-width: 0;
  overflow: visible;
}

/* Las cards de experiencias del encabezado igualan el ANCHO DE LA PORTADA:
   rompen el padding lateral de .profile-content para llegar a los bordes de la
   .profile-card (donde vive la portada). En ≤559px el propio componente ya hace
   full-bleed al viewport (que ahí coincide con la card), así que aquí solo
   corregimos de 560px hacia arriba, igualando el padding en cada breakpoint. */
@media (min-width: 560px) {
  .profile-content :global(.exp-cards) {
    margin-inline-start: -18px;
    margin-inline-end: -18px;
  }
}
@media (min-width: 560px) and (max-width: 640px) {
  .profile-content :global(.exp-cards) {
    margin-inline-start: -12px;
    margin-inline-end: -12px;
  }
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
  inset-inline-start: 18px;
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
    border-inline-start: 0 !important;
    border-inline-end: 0 !important;
  }

.profile-content {
  padding: 0 12px 8px;
}

/* Solo la pestaña de experiencias (celular): el área de contenido va SIN padding
   lateral aquí; el margen lo da un contenedor transparente dentro de la propia
   pestaña (.services-tab-margins), que es la única fuente del margen simétrico y
   centrado. El subnav se re-alinea a ese mismo margen para que quede parejo. */
/* Antes esta regla le quitaba el padding lateral a TODO .profile-content al
   entrar en experiencias, y con ello la card de arriba y el subnav se movían
   al cambiar de pestaña. El contenedor ya no se toca: las cards que quieran
   llegar al borde lo hacen con margen negativo (ver ProfileServicesTab). */

.shared-communities-cover {
  inset-inline-start: 12px;
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
              {/* Base de skeleton (vibra_style.md) para portada y foto de perfil. */}
              <style>{`
              `}</style>
              <Image
                key={coverSrc}
                ref={coverImgRef}
                src={coverSrc}
                alt="cover"
                fill
                onLoad={() => setCoverLoaded(true)}
                onError={() => setCoverLoaded(true)}
                style={{ objectFit: "cover", opacity: 0.96 }}
              />

              {/* Skeleton mientras carga la portada (se desvanece al cargar). */}
              <div
                className="vb-skel"
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 1,
                  opacity: coverLoaded ? 0 : 1,
                  transition: "opacity 380ms ease",
                  pointerEvents: "none",
                }}
              />


<div
  style={{
    position: "absolute",
    insetInlineStart: 0,
    insetInlineEnd: 0,
    bottom: 0,
    height: "82%",
    zIndex: 10,
    pointerEvents: "none",
    background:
      "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.12) 14%, rgba(0,0,0,0.26) 28%, rgba(0,0,0,0.44) 44%, rgba(0,0,0,0.62) 60%, rgba(0,0,0,0.78) 76%, rgba(0,0,0,0.9) 90%, rgba(0,0,0,0.96) 100%)",
  }}
/>

{/* Misma opacidad que el botón de copiar link (0.65 desktop / 0.85 móvil). */}
<style>{`.cover-corner-muted{opacity:0.65}@media(max-width:900px){.cover-corner-muted{opacity:0.85}}`}</style>

{!coverSearchOpen && (
<div
  className="shared-communities-cover"
  aria-label={tProfile("sharedCommunitiesLabel")}
>
  <SharedCommunitiesBadge
    profileUid={userDoc.uid}
    viewerUid={viewer?.uid ?? null}
  />
</div>
)}


{!coverSearchOpen && (
<>
  {!isOwner && !!userDoc && (
    <div
    style={{
      position: "absolute",
      insetInlineEnd: 18,
      top: 18,
      zIndex: 40,
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    }}
  >
    {!shouldHideProfileSocialContent && (
      <button
        type="button"
        onClick={() => setCoverSearchOpen(true)}
        aria-label={tCommon("searchInThisProfile")}
        title={tCommon("searchInThisProfile")}
        className="cover-corner-muted vibra-pop"
        style={{ ...COVER_CIRCLE_BTN_STYLE, color: "#fff" }}
      >
        <CoverSearchLupaIcon />
      </button>
    )}
    {!shouldHideProfileSocialContent && (
      <CopyLinkButton
        href={profileShareHref}
        copiedLabel={tCommon("linkCopiedToClipboard")}
        title={tCommon("copyProfileLink")}
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "none",
          background:
            "linear-gradient(135deg, rgb(3,3,6) 0%, rgb(8,5,13) 48%, rgb(0,0,0) 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(255,255,255,0.02), 0 12px 24px rgba(0,0,0,0.5)",
          backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        }}
      />
    )}
    <ProfileMoreMenu
      viewerUid={viewer?.uid}
      profileUid={userDoc.uid}
      onUnblockSuccess={handleUnblockConfirmed}
      onUnblockError={handleUnblockFailed}
      buttonClassName="cover-corner-muted"
      buttonStyle={{ ...COVER_CIRCLE_BTN_STYLE, color: "#fff" }}
    />
  </div>
  )}

  {isOwner && (
    <>
    {/* Los selectores de moneda e idioma ya no viven aquí. En celular pasaron
        a Configuración, dentro del menú del avatar, con el mismo formato que
        "Cuentas bloqueadas"; en laptop siguen en la cabecera. La portada del
        perfil no es sitio para ajustes de la aplicación.

        Con ellos fuera, la lupa y el copiar ya no tienen que apartarse en
        móvil: vuelven al mismo canto en los dos tamaños. */}
    <style>{`.profile-owner-cover-actions{inset-inline-end:14px}`}</style>
    <div
      className="profile-owner-cover-actions"
      style={{
        position: "absolute",
        top: 14,
        zIndex: 41,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      <button
        type="button"
        onClick={() => setCoverSearchOpen(true)}
        aria-label={tCommon("searchInThisProfile")}
        title={tCommon("searchInThisProfile")}
        className="cover-corner-muted vibra-pop"
        style={{ ...COVER_CIRCLE_BTN_STYLE, color: "#fff" }}
      >
        <CoverSearchLupaIcon />
      </button>
      <CopyLinkButton
        href={profileShareHref}
        copiedLabel={tCommon("linkCopiedToClipboard")}
        title={tCommon("copyProfileLink")}
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: "none",
          background:
            "linear-gradient(135deg, rgb(3,3,6) 0%, rgb(8,5,13) 48%, rgb(0,0,0) 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(255,255,255,0.02), 0 12px 24px rgba(0,0,0,0.5)",
          backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        }}
      />
    </div>
    {/* Esquina inferior derecha de la portada. */}
    <EditTextButton
      onClick={handlePickCover}
      disabled={uploading}
      ariaLabel={tProfile("ariaChangeCover")}
      title={tProfile("ariaChangeCover")}
      style={{
        position: "absolute",
        insetInlineEnd: 14,
        bottom: 14,
        zIndex: 40,
        fontSize: 12,
      }}
    >
      {uploading && cropMode === "cover" ? "..." : tCommon("edit")}
    </EditTextButton>
    </>
  )}
</>
)}

{coverSearchOpen && (
  <CoverSearchBar
    onSubmit={handleCoverSearchSubmit}
    onClose={closeCoverSearch}
    placeholder={tCommon("searchInThisProfile")}
  />
)}
            </div>

            <div
              className={`profile-content${
                activeTab === "services" ? " profile-content--services" : ""
              }`}
            >
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
                  {/* Live ring (priority) or story ring */}
                  {(profileIsLive || profileRing !== "none") && (
                    <div
                      style={{
                        position: "absolute",
                        inset: -6,
                        borderRadius: "50%",
                        background: profileIsLive
                          ? "#ef4444"
                          : profileRing === "vibra"
                            ? "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)"
                            : "rgba(255,255,255,0.28)",
                        zIndex: 0,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  {/* Dot pulsante de live — centro del aro en la parte inferior (6 en punto) */}
                  {profileIsLive && (
                    <>
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: "50%",
                          transform: "translate(-50%, calc(50% + 3px))",
                          width: liveDotShell,
                          height: liveDotShell,
                          borderRadius: "50%",
                          background: "rgb(10,10,14)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          pointerEvents: "none",
                          zIndex: 2,
                        }}
                      >
                        <div style={{
                          position: "absolute",
                          width: liveDotOuter,
                          height: liveDotOuter,
                          borderRadius: "50%",
                          background: "#ef4444",
                          animation: "profLiveOuter 1.6s ease-in-out infinite",
                        }} />
                        <div style={{
                          position: "absolute",
                          width: liveDotInner,
                          height: liveDotInner,
                          borderRadius: "50%",
                          background: "#ef4444",
                          animation: "profLiveInner 1.6s ease-in-out infinite",
                        }} />
                      </div>
                      <style>{`
                        @keyframes profLiveOuter { 0%,100%{transform:scale(1);opacity:0.5} 50%{transform:scale(1.5);opacity:0.15} }
                        @keyframes profLiveInner { 0%,100%{transform:scale(1)} 50%{transform:scale(0.8)} }
                      `}</style>
                    </>
                  )}
                  <button
                    ref={profileAvatarBtnRef}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (profileIsLive) {
                        void handleProfileLiveClick(e);
                      } else if (profileRing !== "none" && profileRingStories.length > 0) {
                        setProfileStoriesSourceRect(profileAvatarBtnRef.current?.getBoundingClientRect() ?? null);
                        setProfileStoriesOpen(true);
                      } else if (isOwner) {
                        handlePickAvatar();
                      }
                    }}
                    disabled={(!isOwner && !profileIsLive && profileRing === "none") || uploading}
                    style={{
                      width: avatarSz,
                      height: avatarSz,
                      borderRadius: "50%",
                      overflow: "hidden",
                      border: "4px solid rgba(0,0,0,0.96)",
                      boxShadow: "none",
                      display: "grid",
                      placeItems: "center",
                      background: "#0c0c0c",
                      userSelect: "none",
                      padding: 0,
                      margin: 0,
                      cursor: (isOwner || profileIsLive || profileRing !== "none") && !uploading ? "pointer" : "default",
                      position: "relative",
                      zIndex: 1,
                    }}
                    aria-label={
                      profileIsLive
                        ? tProfile("ariaLiveView", { name: fullName })
                        : profileRing !== "none" && profileRingStories.length > 0
                          ? tProfile("ariaStoriesView", { name: fullName })
                          : isOwner
                            ? tProfile("ariaChangeAvatar")
                            : undefined
                    }
                    title={isOwner && !profileIsLive && profileRing === "none" ? tProfile("ariaChangeAvatar") : undefined}
                  >
                    {avatarSrc ? (
                      <>
                        <Image
                          key={avatarSrc}
                          ref={avatarImgRef}
                          src={avatarSrc}
                          alt="avatar"
                          fill
                          onLoad={() => setAvatarLoaded(true)}
                          onError={() => setAvatarLoaded(true)}
                          style={{ objectFit: "cover" }}
                        />
                        {/* Skeleton mientras carga la foto (se desvanece al cargar). */}
                        <span
                          className="vb-skel"
                          aria-hidden="true"
                          style={{
                            position: "absolute",
                            inset: 0,
                            opacity: avatarLoaded ? 0 : 1,
                            transition: "opacity 380ms ease",
                            pointerEvents: "none",
                          }}
                        />
                      </>
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

                  {/* Debajo del avatar, no encima. Va en posición absoluta para
                      no empujar nada: el avatar está montado sobre la portada y
                      el hueco de abajo ya está calculado. */}
                  {isOwner && (
                    <EditTextButton
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handlePickAvatar();
                      }}
                      disabled={uploading}
                      title={tProfile("ariaChangeAvatar")}
                      ariaLabel={tProfile("ariaChangeAvatar")}
                      style={avatarEditButtonStyle({
                        mobile: mobileRefreshEnabled,
                        live: profileIsLive,
                      })}
                    >
                      {uploading && cropMode === "avatar" ? "..." : tCommon("edit")}
                    </EditTextButton>
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

                  {/* Solo íconos. Cada liga se arma desde el catálogo, nunca
                      sale del documento tal cual. */}
                  <SocialLinksRow links={userDoc.socialLinks} />

                  <StatsRow
                    items={[
                      // La fila SIEMPRE lleva tres datos. El primer hueco es el
                      // que cambia: hasta la primera venta muestra el estado del
                      // perfil, y a partir de ahí lo cede a las experiencias, que
                      // dicen más de un creador que si su perfil es público.
                      //
                      // Una sola línea en el estado: la palabra "Perfil" encima no
                      // decía nada que el estado no dijera ya.
                      experiencesCount > 0
                        ? {
                            key: "experiences",
                            top: experiencesCount.toLocaleString(intlLocale(locale)),
                            bottom: capitalizeFirst(
                              experiencesCount === 1
                                ? tCommon("experience")
                                : tCommon("experiences"),
                              locale
                            ),
                          }
                        : {
                            key: "visibility",
                            top: profileVisibilityWord,
                            paired: true,
                          },
                      {
                        key: "followers",
                        top: followersCountText,
                        bottom: capitalizeFirst(followersWord, locale),
                        // Solo el dueño puede abrir su lista de seguidores; para
                        // el resto es un dato y no un botón.
                        onClick: isOwner ? openFollowersOverlay : undefined,
                        ariaLabel: isOwner ? followersLabel : undefined,
                      },
                      {
                        key: "posts",
                        top: postsCountText,
                        bottom: capitalizeFirst(postsWord, locale),
                      },
                    ]}
                  />

                  <ProfileSocialActions
                    viewerUid={viewer?.uid ?? null}
                    profileUid={userDoc.uid}
                    profileRestricted={profileRestricted}
                    profileName={userDoc.displayName ?? userDoc.handle ?? null}
                    profileHandle={userDoc.handle ?? null}
                    profilePhotoURL={userDoc.photoURL ?? null}
                    profileMessagePolicy={messagePolicy}
                  />

                  {shouldHideProfileSocialContent ? (
                    <div
                      style={{
                        marginTop: 18,
                        marginInlineStart: "auto",
                        marginInlineEnd: "auto",
                        textAlign: "center",
                        maxWidth: 460,
                        fontSize: 12.5,
                        lineHeight: 1.5,
                        color: "rgba(255,255,255,0.6)",
                      }}
                    >
                      {/* Cada rama afirma algo COMPROBADO. Antes el último caso
                          era un "si no, es que te bloquearon", y ahí caían
                          también los estados de espera (`pendingUnblock`): el
                          perfil acusaba a la otra persona de haberte bloqueado
                          cuando lo único que pasaba era que se estaba
                          confirmando TU desbloqueo. */}
                      {profileBlockedByViewer
                        ? tProfile("blockedByViewer")
                        : viewerBlockedByProfile
                          ? tProfile("blockedByProfile")
                          : tProfile("checkingAccess")}
                    </div>
                  ) : null}

                </div>

                {/* Experiencias FUERA de .profile-meta (grid centrado que encoge al
                    contenido). Aquí, como hermano en el wrapper de ancho completo,
                    la sección ocupa todo el ancho y sus .exp-cards igualan la portada
                    (ver regla .profile-content .exp-cards con margen negativo). */}
                {!isProfileRestrictedForVisitor && !shouldHideProfileSocialContent ? (
  <PostReveal>
    <CreatorExperiencesSection
      services={(userDoc.offerings ?? []) as import("@/types/group").CreatorService[]}
      creatorName={userDoc.firstName || fullName.split(" ")[0] || fullName}
      contextType="profile"
      creatorHandle={userDoc.handle}
      viewerCanRequest={true}
    />
  </PostReveal>
) : null}
              </div>

            </div>
          </div>

{profileUid && !shouldHideProfileSocialContent && (
  <PostReveal>
    <StoryCircles creatorId={profileUid} currentUserId={viewer?.uid ?? null} />
  </PostReveal>
)}

{shouldShowSubnav && (
  <div className="profile-subnav-wrap" style={{ marginTop: 8 }}>
    <ProfileSubnav
                activeTab={activeTab}
                onChange={handleTabChange}
                isOwner={isOwner}
                showPostsTab={showPostsTab}
                showGroupsTab={showGroupsTab}
                showServicesTab={isOwner}
                showSettingsTab={isOwner}
              />
            </div>
          )}

          <div className="profile-tab-content" style={styles.tabContentWrap}>
            <motion.div
              key={activeTab}
              initial={{
                x:
                  tabSlideDirection > 0
                    ? "100%"
                    : tabSlideDirection < 0
                      ? "-100%"
                      : 0,
              }}
              animate={{ x: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.9 }}
              style={{ width: "100%", minWidth: 0 }}
            >
            {!shouldHideProfileSocialContent &&
              (isOwner || showPostsTab || isProfileRestrictedForVisitor) &&
              activeTab === "posts" && (
                <div className="profile-tab-panel">
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 720,
                      marginInlineStart: "auto",
                      marginInlineEnd: "auto",
                      boxSizing: "border-box",
                    }}
                  >
{isOwner && (
  <div style={{ marginBottom: 12 }}>
    <GroupPostComposer
      contextType="profile"
      onSubmit={handleCreateProfilePost}
      onLiveClick={() => setIsProfileLiveModalOpen(true)}
      isOwner={isOwner}
      autoOpenPremium={isOwner && searchParams.get("compose") === "premium"}
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

<div ref={postsFeedAnchorRef} aria-hidden="true" style={{ scrollMarginTop: 72 }} />
<ProfilePostsFeed
  key={`profile-posts-${userDoc.uid}-${profilePostsRefreshKey}`}
  profileUid={userDoc.uid}
  viewerUid={viewer?.uid ?? null}
  isOwner={isOwner}
  showPosts={isOwner ? ownerShowPosts : visitorCanSeePosts}
  profileRestricted={profileRestricted}
  commentsEnabled={profileCommentsEnabled}
  searchQuery={postSearchQuery}
  belowMediaTabs={
    visitorCanJumpToGroups ? (
      // `flex-end` y no "right": en arabe la linea corre al reves y el enlace
      // tiene que irse al otro lado con ella. El margen negativo se come parte
      // del `marginBottom: 12` del subnav de medios, para que quede pegado a el.
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: -6,
          padding: "0 4px 10px",
        }}
      >
        <TextButton
          tone="brand"
          size="sm"
          onClick={() => handleTabChange("groups")}
          style={{ fontSize: 13 }}
        >
          {tGroups("profileSeeCommunities")}
        </TextButton>
      </div>
    ) : null
  }
  donation={userDoc.donation as { mode?: string; enabled?: boolean; visible?: boolean; message?: string | null; playbackId?: string | null; suggestedAmounts?: number[] | null; currency?: string | null } | null}
  donationCreatorName={userDoc.displayName ?? userDoc.handle ?? null}
  donationProfilePhoto={userDoc.photoURL ?? null}
  donationProfileHandle={userDoc.handle ?? null}
  donationViewerOpen={donationViewerOpen}
  onDonate={() => setDonationViewerOpen(true)}
  onDonationClose={() => setDonationViewerOpen(false)}
  onDonationPay={() => setDonationViewerOpen(false)}
/>
                  </div>
                </div>
              )}

            {!shouldHideProfileSocialContent &&
              (isOwner || showGroupsTab) &&
              activeTab === "groups" && (
              <div className="profile-tab-panel">
                <ProfileGroupsTab
                  titleAction={
                    visitorCanJumpToGroups ? (
                      // El subnav de secciones no existe para quien visita, asi
                      // que esta es la unica salida de vuelta a publicaciones.
                      // Va en el renglon del titulo: suelto encima quedaba muy
                      // arriba y despegado de lo que acompana.
                      <TextButton
                        tone="brand"
                        size="sm"
                        onClick={() => handleTabChange("posts")}
                        style={{ fontSize: 13, flexShrink: 0 }}
                      >
                        {tGroups("profileBackToPosts")}
                      </TextButton>
                    ) : null
                  }
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
  style={{
    ...styles.tabPlaceholder,
    border: "none",
    background: "transparent",
    boxShadow: "none",
    backdropFilter: "none",
    WebkitBackdropFilter: "none",
    borderRadius: 0,
    overflow: "visible",
    padding: 0,
    marginTop: 8,
  }}
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
  style={{
    ...styles.tabPlaceholder,
    marginTop: 8,
    border: "none",
    background: "transparent",
    boxShadow: "none",
    backdropFilter: "none",
    WebkitBackdropFilter: "none",
    borderRadius: 0,
    padding: "0 16px",
  }}
>
                <ProfileSettingsTab
  isSaving={savingProfileRestricted}
  isRestricted={profileRestricted}
  onToggleRestricted={handleToggleProfileRestricted}
  commentsEnabled={profileCommentsEnabled}
  onToggleCommentsEnabled={handleToggleProfileCommentsEnabled}
  isSavingComments={savingProfileComments}
  messagePolicy={messagePolicy}
  onChangeMessagePolicy={handleChangeMessagePolicy}
  isSavingMessagePolicy={savingMessagePolicy}
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
  socialLinks={userDoc.socialLinks ?? null}
  onUpdateSocialLinks={handleUpdateSocialLinks}
  onSendPasswordReset={handleSendPasswordReset}
/>
              </section>
            )}
            </motion.div>
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

{/* Saludo/consejo: pasarela STRIPE (cableada). Sesión y meet&greet siguen en MP por ahora. */}
<StripePaymentModal
  open={payGreetOpen}
  amount={payGreetAmount != null ? payGreetAmount + FIXED_SERVICE_FEE_USD : null}
  amountCurrency={SETTLEMENT_CURRENCY}
  externalReference={payGreetId ? `greetingRequest__${payGreetId}` : null}
  createIntent={(args) => createGreetingStripeIntent({ greetingRequestId: payGreetId ?? "", saveCard: args.saveCard, taxCountry: args.taxCountry, savedPaymentMethodId: args.savedPaymentMethodId, applyCredit: args.applyCredit })}
  priceLabel={payGreetLabel}
  productType={greetType === "consejo" ? "Consejo" : "Saludo"}
  providerName={fullName}
  avatarUrl={userDoc.photoURL}
  description={tServices(greetType === "consejo" ? "payDescConsejo" : "payDescSaludo", { name: fullName })}
  successMessage={tServices(greetType === "consejo" ? "paySuccessConsejo" : "paySuccessSaludo", { name: fullName })}
  holdSuccessMessage={`Tu solicitud fue enviada. Todavía no te cobramos, el cargo se hace hasta que ${fullName} grabe y envíe tu ${greetType === "consejo" ? "consejo" : "saludo"}.`}
  autoConfirm={autoConfirmPay}
  onClose={() => { setPayGreetOpen(false); setAutoConfirmPay(false); setIsRetry(false); }}
  onPaid={() => {
    // El panel NO se cierra: muestra la pantalla de éxito. Solo registramos la compra.
    registrarCompraGeo({
      creatorId: userDoc.uid,
      serviceType: greetType === "consejo" ? "advice" : "greeting",
      grossAmount: payGreetAmount ?? undefined,
    });
  }}
/>

<StripePaymentModal
  open={paySessionOpen}
  amount={paySessionAmount != null ? paySessionAmount + FIXED_SERVICE_FEE_USD : null}
  amountCurrency={SETTLEMENT_CURRENCY}
  externalReference={paySessionId ? `exclusiveSessionRequest__${paySessionId}` : null}
  createIntent={(args) => createServiceStripeIntent({ externalReference: `exclusiveSessionRequest__${paySessionId ?? ""}`, saveCard: args.saveCard, taxCountry: args.taxCountry, savedPaymentMethodId: args.savedPaymentMethodId, applyCredit: args.applyCredit })}
  priceLabel={paySessionLabel}
  productType="Sesión exclusiva"
  providerName={fullName}
  avatarUrl={userDoc.photoURL}
  durationMinutes={paySessionDuration}
  successMessage={tServices("paySuccessScheduled", { name: fullName })}
  holdSuccessMessage={`Tu solicitud fue enviada. Todavía no te cobramos, el cargo se hace hasta que ${fullName} agende la sesión.`}
  autoConfirm={autoConfirmPay}
  onClose={() => { setPaySessionOpen(false); setAutoConfirmPay(false); setIsRetry(false); }}
  onPaid={() => {
    // El panel NO se cierra: muestra la pantalla de éxito. Solo registramos la compra.
    registrarCompraGeo({
      creatorId: userDoc.uid,
      serviceType: "exclusive_session",
      grossAmount: paySessionAmount ?? undefined,
    });
  }}
/>

<StripePaymentModal
  open={payMeetOpen}
  amount={payMeetAmount != null ? payMeetAmount + FIXED_SERVICE_FEE_USD : null}
  amountCurrency={SETTLEMENT_CURRENCY}
  externalReference={payMeetId ? `meetGreetRequest__${payMeetId}` : null}
  createIntent={(args) => createServiceStripeIntent({ externalReference: `meetGreetRequest__${payMeetId ?? ""}`, saveCard: args.saveCard, taxCountry: args.taxCountry, savedPaymentMethodId: args.savedPaymentMethodId, applyCredit: args.applyCredit })}
  priceLabel={payMeetLabel}
  productType="Tiempo contigo"
  providerName={fullName}
  avatarUrl={userDoc.photoURL}
  durationMinutes={payMeetDuration}
  successMessage={tServices("paySuccessScheduled", { name: fullName })}
  holdSuccessMessage={`Tu solicitud fue enviada. Todavía no te cobramos, el cargo se hace hasta que ${fullName} agende tu sesión.`}
  autoConfirm={autoConfirmPay}
  onClose={() => { setPayMeetOpen(false); setAutoConfirmPay(false); setIsRetry(false); }}
  onPaid={() => {
    // El panel NO se cierra: muestra la pantalla de éxito. Solo registramos la compra.
    registrarCompraGeo({
      creatorId: userDoc.uid,
      serviceType: "live_session",
      grossAmount: payMeetAmount ?? undefined,
    });
  }}
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
  greetPriceLabel={(() => {
    const s = getProfileService(greetType);
    const price = s?.publicPrice ?? s?.memberPrice ?? null;
    const currency = s?.currency ?? SETTLEMENT_CURRENCY;
    // Total todo-incluido (base + cargo fijo + impuesto del país) para el botón "Continuar al pago".
    return typeof price === "number" ? formatMoneyWithTax(price + FIXED_SERVICE_FEE_USD, currency) : undefined;
  })()}
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
  isRetry={isRetry}
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
    height: "var(--vb-alto-pantalla)",
    zIndex: 10000,
    background: "rgba(0,0,0,0.72)",
    display: "grid",
    placeItems: "center",
    paddingTop: "max(14px, env(safe-area-inset-top, 0px))",
    paddingBottom: 14,
    paddingInlineStart: 14,
    paddingInlineEnd: 14,
    fontFamily: fontStack,
  }}
  serviceModalCardStyle={{
  width: "min(720px, calc(100vw - 28px))",
  maxHeight: "calc(var(--vb-alto-pantalla) - 28px)",
  background:
    "linear-gradient(180deg, rgba(18,18,18,0.98), rgba(8,8,8,0.98))",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 18,
  // Con `overflow: "hidden"` a secas la tarjeta no hacía scroll nunca. No se
  // notaba sin teclado porque el contenido cabía; con el teclado abierto se
  // quedaba clavada y no se llegaba a los campos de abajo.
  overflowX: "hidden",
  overflowY: "auto",
  boxShadow: "0 24px 80px rgba(0,0,0,0.72)",
  color: "#fff",
  backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
}}
  serviceToastStyle={{
    position: "fixed",
    left: "50%",
    bottom: "calc(24px + var(--vb-safe-bottom, 0px))",
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

      {/* DonationViewer removed — viewer is now handled inside DonationFeedBanner with the same video element */}

      {profileStoriesOpen && profileRingStories.length > 0 && (
        <StoryViewer
          stories={profileRingStories}
          initialIndex={profileRingStart}
          onClose={() => setProfileStoriesOpen(false)}
          onStoryViewed={(storyId) => {
            if (viewer?.uid) recordStoryView(viewer.uid, storyId).catch(console.error);
          }}
          sourceRect={profileStoriesSourceRect}
        />
      )}

      {profileLiveViewerOpen && profileLivePost && (
        <LiveViewerModal
          open={profileLiveViewerOpen}
          onClose={() => {
            setProfileLiveViewerOpen(false);
            setProfileLivePost(null);
          }}
          post={profileLivePost}
        />
      )}

      {!cropOpen ? null : (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            height: "var(--vb-alto-pantalla)",
            zIndex: 10000,
            background: "rgba(0,0,0,0.72)",
            display: "grid",
            placeItems: "center",
            paddingTop: "max(14px, env(safe-area-inset-top, 0px))",
            paddingBottom: 14,
            paddingInlineStart: 14,
            paddingInlineEnd: 14,
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
                  ? tProfile("cropAvatar")
                  : tProfile("cropCover")}
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

                <div
                  style={{
                    marginInlineStart: "auto",
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
                    {tCommon("cancel")}
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
                    {uploading ? tCommon("uploading") : tCommon("save")}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 10, ...styles.microText }}>
                {cropMode === "avatar" ? tProfile("cropTipAvatar") : tProfile("cropTipCover")}
              </div>
            </div>
          </div>
        </div>
      )}

      <VibraToast toast={profileToast} />
    </>
  );
}