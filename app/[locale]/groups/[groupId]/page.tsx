"use client";

import Image from "next/image";
import CreatorServiceModals from "@/components/services/CreatorServiceModals";
import GroupImageCropModal from "./components/GroupImageCropModal";
import OwnerAdminServices from "./components/owner-admin-panel/OwnerAdminServices";

import { collection, doc, getCountFromServer, updateDoc } from "firebase/firestore";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import {
  joinGroup,
  joinGroupWithSubscription,
  leaveGroup,
} from "@/lib/groups/membership";
import { requestToJoin, cancelJoinRequest } from "@/lib/groups/joinRequests";
import { registrarCompraGeo } from "@/lib/wallet/registrarCompraGeo";
import OwnerAdminPanel from "./components/OwnerAdminPanel";
import GroupSubnav from "./components/GroupSubnav";
import GroupStoryCircles from "@/app/components/Stories/GroupStoryCircles";
import GroupMembersTab from "./components/GroupMembersTab";
import GroupPostsFeed from "./components/posts/GroupPostsFeed";
import GroupRecommendationsRail from "@/app/components/GroupRecommendations/GroupRecommendationsRail";
import CreatorExperiencesSection from "@/components/services/CreatorExperiencesSection";
import DonationFeedBanner from "@/app/components/DonationFeedBanner/DonationFeedBanner";
import SessionCountdownBanner from "@/app/components/SessionCountdownBanner/SessionCountdownBanner";
import CreatorSessionCountdownBanner from "@/app/components/SessionCountdownBanner/CreatorSessionCountdownBanner";
import CopyLinkButton from "@/components/ui/CopyLinkButton";
import CoverSearchBar from "@/app/components/CoverSearch/CoverSearchBar";
import {
  createGreetingRequest,
  type GreetingType,
} from "@/lib/greetings/greetingRequests";
import { createMeetGreetRequest } from "@/lib/meetGreet/meetGreetRequests";
import { createExclusiveSessionRequest } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import {
  mergeMonetizationWithCatalog,
  mergeWithDefaultCatalog,
  normalizeDonationSettings,
} from "@/lib/groups/groupServiceCatalog";
import {
  dataUrlFromFile,
  getCroppedBlob,
  type GroupCropArea,
} from "@/lib/groups/groupImageHelpers";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import type {
  Currency,
  CreatorServiceMeta,
  CreatorServiceType,
  GroupDonationSettings,
  GroupMonetizationSettings,
  GroupOffering,
} from "@/types/group";

import {
  isGreetingType,
  normalizeCurrency,
  normalizeMonetization,
  normalizeDonationInput,
  normalizePostingMode,
  normalizeCommentsEnabled,
  isJoinedStatus,
  normalizeVisibility,
  toCatalogOfferings,
  visibilityLabel,
} from "@/lib/groups/groupAdapters";

import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { useGroupRealtime } from "@/lib/groups/useGroupRealtime";
import { useLiveRingState } from "@/lib/live/useLiveRingState";
import { setLastVisitTimestamp } from "@/lib/utils/visitTimestamps";
import { useSetMobileHeader } from "@/app/contexts/MobileHeaderContext";
import { buildCurrentPathWithSearch } from "@/lib/auth-redirect";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import {
  groupPageFontStack,
  groupPageUi,
  pageWrap,
  container,
  cardStyle,
  panelStyle,
  titleStyle,
  subtitleStyle,
  textStyle,
  microText,
  labelStyle,
  primaryButton,
  secondaryButton,
  coverDonationButton,
  inputStyle,
  messageBox,
  serviceModalBackdropStyle,
  serviceModalCardStyle,
} from "@/lib/groups/groupPageStyles";
import {
  type InteractionBlockedReason,
  type CropMode,
  type GroupDoc,
  formatDeletedAt,
} from "./page.utils";

// ─── Orden de pestañas para animar el slide del subnav (misma UX que Wallet) ──
type GroupTabKey = "feed" | "members" | "services" | "settings";
const GROUP_TAB_ORDER: Record<GroupTabKey, number> = {
  feed: 0,
  members: 1,
  services: 2,
  settings: 3,
};
// ──────────────────────────────────────────────────────────────────────────────

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const locale = useLocale();
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("groups");
  const tFeed = useTranslations("feed");
  const tServices = useTranslations("services");

  const priceFmt = usePriceFormat();
  const formatMoney = (value: number, currency?: string) =>
    priceFmt.format(value, { baseCurrency: currency ?? "MXN", code: true });

  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Búsqueda dentro de la comunidad (lupa en la portada).
  const [coverSearchOpen, setCoverSearchOpen] = useState(false);
  const [postSearchQuery, setPostSearchQuery] = useState("");
  const groupPostsAnchorRef = useRef<HTMLDivElement | null>(null);

  const handleCoverSearchSubmit = useCallback((query: string) => {
    setPostSearchQuery(query);
    window.setTimeout(() => {
      groupPostsAnchorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);
  }, []);

  const closeCoverSearch = useCallback(() => {
    setCoverSearchOpen(false);
    setPostSearchQuery("");
  }, []);

  const [isEmbed, setIsEmbed] = useState(false);
  useEffect(() => {
    try { setIsEmbed(window.self !== window.top); } catch { setIsEmbed(true); }
  }, []);

  // Track last visit so the sidebar can show new-post counts
  useEffect(() => {
    if (groupId) setLastVisitTimestamp(groupId);
  }, [groupId]);
  const searchParams = useSearchParams();

  const {
    group,
    loading,
    error: realtimeError,
    isMember,
    memberStatus,
    memberRole,
    membershipAccessType,
    membershipRequiresSubscription,
    membershipLegacyComplimentary,
    membershipTransitionPendingAction,
    membershipTransitionReason,
    joinReqStatus,
  } = useGroupRealtime({
    groupId,
    userId: user?.uid ?? null,
  });

const { isLive: groupIsLive } = useLiveRingState(groupId, "group");

// Alimentar el header contextual del layout con avatar y nombre del grupo
useSetMobileHeader(group?.avatarUrl ?? null, group?.name ?? null);

const [joining, setJoining] = useState(false);
const [actionError, setActionError] = useState<string | null>(null);
const [leaveOverlayOpen, setLeaveOverlayOpen] = useState(false);
const [leaving, setLeaving] = useState(false);
const [leaveError, setLeaveError] = useState<string | null>(null);
const [mobileRefreshEnabled, setMobileRefreshEnabled] = useState(false);
const [groupPageRefreshKey, setGroupPageRefreshKey] = useState(0);
  const [memberCount, setMemberCount] = useState<number | null>(null);

useEffect(() => {
  let cancelled = false;

  async function loadMemberCount() {
    if (!groupId) return;

    try {
      const membersRef = collection(db, "groups", groupId, "members");
      const snapshot = await getCountFromServer(membersRef);

      if (!cancelled) {
        setMemberCount(snapshot.data().count);
      }
    } catch (error) {
      console.error("Error loading group member count:", error);

      if (!cancelled) {
        setMemberCount(null);
      }
    }
  }

  loadMemberCount();

  return () => {
    cancelled = true;
  };
}, [groupId, groupPageRefreshKey]);

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

const handleGroupPullRefresh = useCallback(async () => {
  setGroupPageRefreshKey((value) => value + 1);
  router.refresh();
}, [router]);

const formattedMemberCount = useMemo(() => {
  if (memberCount == null) return null;

  return new Intl.NumberFormat(locale).format(memberCount);
}, [memberCount, locale]);

  const error = actionError ?? realtimeError;

    const currentGroupState = group as GroupDoc | null;

  const groupIsPausedForAccess =
    currentGroupState?.isActive === false &&
    currentGroupState?.isDeleted !== true &&
    !Boolean(currentGroupState?.deletedAt);

  const isOwner = useMemo(
    () => !!user && !!group?.ownerId && group.ownerId === user.uid,
    [user, group]
  );

  const isModerator = useMemo(() => {
    if (isOwner) return false;
    return memberRole === "mod" && isJoinedStatus(memberStatus);
  }, [isOwner, memberRole, memberStatus]);

  const hasJoinedMembership =
  isMember && isJoinedStatus(memberStatus);

const hasLegacyServiceAccess =
  membershipAccessType === "legacy_free" || membershipLegacyComplimentary;

const effectiveIsMember = isOwner || hasJoinedMembership;

// When a group switches from public to private mid-session, force a refresh
// so any stale Firestore cache doesn't keep showing the full-page view.
const prevGroupVisibilityRef = useRef<string | undefined>(undefined);
useEffect(() => {
  const prev = prevGroupVisibilityRef.current;
  const curr = group?.visibility;
  prevGroupVisibilityRef.current = curr;

  if (
    prev === "public" &&
    (curr === "private" || curr === "hidden") &&
    !isOwner &&
    !effectiveIsMember &&
    !loading
  ) {
    router.refresh();
  }
}, [group?.visibility, isOwner, effectiveIsMember, loading, router]);

const canRequestCreatorServices =
  !groupIsPausedForAccess &&
  (isOwner ||
    hasJoinedMembership ||
    (isMember &&
      memberStatus !== "banned" &&
      memberStatus !== "removed" &&
      hasLegacyServiceAccess));

const canRequestMeetGreet =
  !isOwner &&
  canRequestCreatorServices &&
  memberStatus !== "banned" &&
  memberStatus !== "removed";

  const canRequestExclusiveSession =
  !isOwner &&
  canRequestCreatorServices &&
  memberStatus !== "banned" &&
  memberStatus !== "removed";

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

  const normalizedCurrentOfferings = useMemo<GroupOffering[]>(() => {
    if (!group) return [];
    return mergeWithDefaultCatalog(
      toCatalogOfferings(group.offerings),
      normalizeCurrency(group.monetization?.currency) ?? "MXN"
    );
  }, [group]);

  const normalizedCurrentMonetization =
    useMemo<GroupMonetizationSettings | null>(() => {
      if (!group) return null;
      return mergeMonetizationWithCatalog({
        monetization: normalizeMonetization(group.monetization),
        catalog: normalizedCurrentOfferings,
        legacyGreetingsEnabled:
          typeof group.greetingsEnabled === "boolean"
            ? group.greetingsEnabled
            : undefined,
      });
    }, [group, normalizedCurrentOfferings]);

  const normalizedCurrentDonation =
    useMemo<GroupDonationSettings | null>(() => {
      if (!group) return null;
      return normalizeDonationSettings(normalizeDonationInput(group.donation));
    }, [group]);

  const subscriptionEnabled = useMemo(() => {
    if (!normalizedCurrentMonetization) return false;
    return normalizedCurrentMonetization.subscriptionsEnabled === true;
  }, [normalizedCurrentMonetization]);

  const subscriptionPrice = useMemo(() => {
    if (!normalizedCurrentMonetization) return null;
    return (
      normalizedCurrentMonetization.subscriptionPriceMonthly ??
      normalizedCurrentMonetization.priceMonthly ??
      null
    );
  }, [normalizedCurrentMonetization]);

  const subscriptionCurrency = useMemo<Currency>(() => {
    if (!normalizedCurrentMonetization) return "MXN";
    return (
      normalizedCurrentMonetization.subscriptionCurrency ??
      normalizedCurrentMonetization.currency ??
      "MXN"
    );
  }, [normalizedCurrentMonetization]);

  const meetGreetOffering = useMemo(() => {
    return (
      normalizedCurrentOfferings.find(
        (offering) => offering.type === "meet_greet_digital"
      ) ?? null
    );
  }, [normalizedCurrentOfferings]);

  const meetGreetPrice = useMemo(() => {
    if (!meetGreetOffering) return null;

    if (typeof meetGreetOffering.memberPrice === "number") {
      return meetGreetOffering.memberPrice;
    }

    if (typeof meetGreetOffering.publicPrice === "number") {
      return meetGreetOffering.publicPrice;
    }

    if (typeof meetGreetOffering.price === "number") {
      return meetGreetOffering.price;
    }

    return null;
  }, [meetGreetOffering]);

  const meetGreetCurrency = useMemo<Currency>(() => {
    return meetGreetOffering?.currency ?? subscriptionCurrency ?? "MXN";
  }, [meetGreetOffering, subscriptionCurrency]);

  const meetGreetDurationMinutes = useMemo(() => {
  const meta = meetGreetOffering?.meta as Record<string, Record<string, unknown>> | null;
  const meetGreetMeta = meta?.meetGreet ?? null;

  if (
    meetGreetMeta &&
    typeof meetGreetMeta.durationMinutes === "number" &&
    Number.isFinite(meetGreetMeta.durationMinutes)
  ) {
    return meetGreetMeta.durationMinutes;
  }

  return null;
}, [meetGreetOffering]);

  const exclusiveSessionOffering = useMemo(() => {
    return (
      normalizedCurrentOfferings.find(
        (offering) => offering.type === "clase_personalizada"
      ) ?? null
    );
  }, [normalizedCurrentOfferings]);

  const exclusiveSessionPrice = useMemo(() => {
    if (!exclusiveSessionOffering) return null;

    if (typeof exclusiveSessionOffering.memberPrice === "number") {
      return exclusiveSessionOffering.memberPrice;
    }

    if (typeof exclusiveSessionOffering.publicPrice === "number") {
      return exclusiveSessionOffering.publicPrice;
    }

    if (typeof exclusiveSessionOffering.price === "number") {
      return exclusiveSessionOffering.price;
    }

    return null;
  }, [exclusiveSessionOffering]);

  const exclusiveSessionCurrency = useMemo<Currency>(() => {
    return exclusiveSessionOffering?.currency ?? subscriptionCurrency ?? "MXN";
  }, [exclusiveSessionOffering, subscriptionCurrency]);

  const exclusiveSessionDurationMinutes = useMemo(() => {
    const meta = exclusiveSessionOffering?.meta as Record<string, Record<string, unknown>> | null;
    const customClassMeta = meta?.customClass ?? null;

    if (
      customClassMeta &&
      typeof customClassMeta.durationMinutes === "number" &&
      Number.isFinite(customClassMeta.durationMinutes)
    ) {
      return customClassMeta.durationMinutes;
    }

    return null;
  }, [exclusiveSessionOffering]);

  const removedBySubscriptionTransition = useMemo(() => {
    return (
      membershipTransitionPendingAction &&
      (membershipTransitionReason === "subscription_required_after_transition" ||
        membershipTransitionReason === "subscription_transition")
    );
  }, [membershipTransitionPendingAction, membershipTransitionReason]);

  const shouldShowSubscriptionRecovery =
    !groupIsPausedForAccess &&
    !isOwner &&
    !effectiveIsMember &&
    subscriptionEnabled &&
    (group?.visibility === "private" || group?.visibility === "hidden") &&
    (membershipRequiresSubscription ||
      removedBySubscriptionTransition ||
      searchParams.get("service") === "suscripcion");

  const isSubscriptionGroup =
    !groupIsPausedForAccess &&
    !isOwner &&
    !effectiveIsMember &&
    (group?.visibility === "private" || group?.visibility === "hidden") &&
    subscriptionEnabled;

  const [greetOpen, setGreetOpen] = useState(false);
  const [greetType, setGreetType] = useState<GreetingType>("saludo");
  const [toName, setToName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [allowCreatorStory, setAllowCreatorStory] = useState(true);
  const [greetSubmitting, setGreetSubmitting] = useState(false);
  const [greetError, setGreetError] = useState<string | null>(null);
  const [greetSuccess, setGreetSuccess] = useState<string | null>(null);

  const [meetGreetOpen, setMeetGreetOpen] = useState(false);
  const [meetGreetMessage, setMeetGreetMessage] = useState("");
  const [meetGreetSubmitting, setMeetGreetSubmitting] = useState(false);
  const [meetGreetError, setMeetGreetError] = useState<string | null>(null);

  const [exclusiveSessionOpen, setExclusiveSessionOpen] = useState(false);
  const [exclusiveSessionMessage, setExclusiveSessionMessage] = useState("");
  const [exclusiveSessionSubmitting, setExclusiveSessionSubmitting] = useState(false);
  const [exclusiveSessionError, setExclusiveSessionError] = useState<string | null>(null);

  const [isRetry, setIsRetry] = useState(false);

  const greetOffering = useMemo(() => {
    return normalizedCurrentOfferings.find((o) => o.type === greetType) ?? null;
  }, [normalizedCurrentOfferings, greetType]);

  const greetPriceLabel = useMemo(() => {
    const price = greetOffering?.memberPrice ?? greetOffering?.publicPrice ?? (greetOffering as { price?: number } | null)?.price ?? null;
    const currency = greetOffering?.currency ?? "MXN";
    return typeof price === "number" ? formatMoney(price, currency) : undefined;
  }, [greetOffering]);

  const [serviceToast, setServiceToast] = useState<string | null>(null);

  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [subscriptionSubmitting, setSubscriptionSubmitting] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

  const [groupDonationViewerOpen, setGroupDonationViewerOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<GroupTabKey>("feed");
  // Sub-pestaña de media del feed (Publicaciones/Fotos/Videos/En vivo) reportada
  // por GroupPostsFeed; se usa para ocultar el rail de recomendaciones fuera de
  // "Publicaciones".
  const [feedMediaTab, setFeedMediaTab] = useState<string>("feed");
  // Deep-link `?requests=1` desde la notificación de solicitud de unión: abre la
  // lista de solicitudes dentro de Integrantes.
  const [requestsDeepLinkOpen, setRequestsDeepLinkOpen] = useState(false);

  // Cambio de pestaña preservando el scroll (misma UX que Wallet/Perfil).
  const tabSwitchScrollY = useRef<number | null>(null);
  const handleTabChange = useCallback((tab: GroupTabKey) => {
    tabSwitchScrollY.current = window.scrollY;
    setActiveTab(tab);
  }, []);

  useLayoutEffect(() => {
    if (tabSwitchScrollY.current !== null) {
      window.scrollTo({ top: tabSwitchScrollY.current, behavior: "instant" });
      tabSwitchScrollY.current = null;
    }
  }, [activeTab]);

  // Dirección del slide entre pestañas:
  // +1 = la pestaña nueva entra desde la derecha, -1 = desde la izquierda.
  const prevTabRef = useRef<GroupTabKey>(activeTab);
  const tabSlideDirection = useMemo(() => {
    const prev = prevTabRef.current;
    if (prev === activeTab) return 0;
    return GROUP_TAB_ORDER[activeTab] > GROUP_TAB_ORDER[prev] ? 1 : -1;
  }, [activeTab]);
  useEffect(() => {
    prevTabRef.current = activeTab;
  }, [activeTab]);

  const [uploading, setUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [cropOpen, setCropOpen] = useState(false);
  const [cropMode, setCropMode] = useState<CropMode>("avatar");
  const [cropImageSrc, setCropImageSrc] = useState<string>("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<GroupCropArea | null>(null);
  const cropAspect = cropMode === "avatar" ? 1 / 1 : 16 / 9;

  const canMembersViewList =
    (group?.settings?.membersListVisibility ?? "owner_only") === "members";

function redirectToLogin() {
  const nextPath = buildCurrentPathWithSearch(
    pathname || `/groups/${groupId}`,
    searchParams
  );

  router.push(`/login?next=${encodeURIComponent(nextPath)}`);
}

  function clearServiceQuery() {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("service");
    const nextHref = nextParams.toString()
      ? `${pathname}?${nextParams.toString()}`
      : pathname;
    router.replace(nextHref, { scroll: false });
  }

  function openSubscriptionModal() {
    if (!user) {
      redirectToLogin();
      return;
    }

    setSubscriptionError(null);
    setServiceToast(null);
    setSubscriptionOpen(true);
  }

  function closeSubscriptionModal() {
    if (subscriptionSubmitting) return;
    setSubscriptionOpen(false);
    setSubscriptionError(null);
    clearServiceQuery();
  }

  async function handleSubscriptionCheckout() {
    if (!user) {
      redirectToLogin();
      return;
    }

    if (!group) return;

    if (group.visibility !== "private" && group.visibility !== "hidden") {
      setSubscriptionError(tGroups("subscriptionOnlyPrivate"));
      return;
    }

    if (!subscriptionEnabled) {
      setSubscriptionError(tGroups("subscriptionNotActive"));
      return;
    }

    setSubscriptionSubmitting(true);
    setSubscriptionError(null);
    setActionError(null);

    try {
      await joinGroupWithSubscription(groupId, user.uid, {
        priceMonthly: subscriptionPrice ?? undefined,
        currency: subscriptionCurrency,
      });

      registrarCompraGeo({
        creatorId: group?.ownerId,
        serviceType: "subscription",
        grossAmount: subscriptionPrice ?? undefined,
      });

      const successMessage = tGroups("subscriptionProcessed");
      setSubscriptionOpen(false);
      setServiceToast(successMessage);
      clearServiceQuery();

      window.setTimeout(() => {
        setServiceToast((current) =>
          current === successMessage ? null : current
        );
      }, 4000);
    } catch (e: unknown) {
      setSubscriptionError(
        (e instanceof Error ? e.message : null) ?? tGroups("subscriptionSubmitError")
      );
    } finally {
      setSubscriptionSubmitting(false);
    }
  }

  async function handleJoinPublic() {
    if (!user) {
      redirectToLogin();
      return;
    }

    if (groupIsPausedForAccess) {
      setActionError(tGroups("communityPaused"));
      return;
    }

    setJoining(true);
    setActionError(null);

    try {
      await joinGroup(groupId, user.uid);
    } catch (e: unknown) {
      setActionError((e instanceof Error ? e.message : null) ?? tGroups("joinError"));
    } finally {
      setJoining(false);
    }
  }

  async function handleLeave() {
    if (!user || leaving) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveGroup(groupId, user.uid);
      setLeaveOverlayOpen(false);
    } catch (e: unknown) {
      setLeaveError((e instanceof Error ? e.message : null) ?? tGroups("leaveError"));
    } finally {
      setLeaving(false);
    }
  }

  async function handleRequestPrivate() {
    if (!user) {
      redirectToLogin();
      return;
    }

        if (groupIsPausedForAccess) {
      setActionError(tGroups("communityPausedAccess"));
      return;
    }

    setJoining(true);
    setActionError(null);

    try {
      await requestToJoin(groupId, user.uid);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : null;
      if (errMsg === "GROUP_REQUIRES_SUBSCRIPTION") {
        openSubscriptionModal();
        return;
      }

      setActionError(errMsg ?? tGroups("requestError"));
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
    setActionError(null);

    try {
      await cancelJoinRequest(groupId, user.uid);
    } catch (e: unknown) {
      setActionError((e instanceof Error ? e.message : null) ?? tGroups("cancelRequestError"));
    } finally {
      setJoining(false);
    }
  }

  function openGreetingForm(type: GreetingType) {
    setGreetError(null);
    setGreetSuccess(null);
    setServiceToast(null);
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
    setAllowCreatorStory(true);
    setIsRetry(false);
    clearServiceQuery();
  }

  async function submitGreetingRequest() {
    if (!user) return;

    if (isOwner) {
      setGreetError(tGroups("ownCommunityGreeting"));
      return;
    }

    if (!canRequestCreatorServices) {
      setGreetError(tGroups("noValidMembership"));
      return;
    }

    if (!toName.trim()) {
      setGreetError(tGroups("greetingToHint"));
      return;
    }

    if (!instructions.trim()) {
      setGreetError(tGroups("greetingContextHint"));
      return;
    }

    setGreetSubmitting(true);
    setGreetError(null);
    setGreetSuccess(null);

    try {
      await createGreetingRequest({
        groupId,
        type: greetType,
        toName: toName.trim(),
        instructions: instructions.trim(),
        source: "group",
        allowCreatorStory,
      });

      registrarCompraGeo({
        creatorId: group?.ownerId,
        serviceType: greetType === "consejo" ? "advice" : "greeting",
        grossAmount:
          greetOffering?.memberPrice ?? greetOffering?.publicPrice ?? undefined,
      });

      const successMessage = tGroups("greetSent");

      setServiceToast(successMessage);
      setGreetOpen(false);
      setToName("");
      setInstructions("");
      setGreetSuccess(null);
      clearServiceQuery();

      window.setTimeout(() => {
        setServiceToast((current) =>
          current === successMessage ? null : current
        );
      }, 4000);
    } catch (e: unknown) {
      setGreetError((e instanceof Error ? e.message : null) ?? tGroups("greetRequestError"));
    } finally {
      setGreetSubmitting(false);
    }
  }

  function openMeetGreetForm() {
    setMeetGreetError(null);
    setServiceToast(null);
    setMeetGreetMessage("");
    setMeetGreetOpen(true);
  }

  function closeMeetGreetForm() {
    if (meetGreetSubmitting) return;
    setMeetGreetOpen(false);
    setMeetGreetSubmitting(false);
    setMeetGreetError(null);
    setMeetGreetMessage("");
    setIsRetry(false);
    clearServiceQuery();
  }

  async function submitMeetGreetRequest() {
    if (!user) {
      redirectToLogin();
      return;
    }

    if (isOwner) {
      setMeetGreetError(tGroups("ownCommunityMeetGreet"));
      return;
    }

    if (!canRequestMeetGreet) {
      setMeetGreetError(tGroups("noValidMembershipMeetGreet"));
      return;
    }

    setMeetGreetSubmitting(true);
    setMeetGreetError(null);

    try {
      await createMeetGreetRequest({
        groupId,
        buyerMessage: meetGreetMessage.trim() || null,
        priceSnapshot: meetGreetPrice,
        durationMinutes: meetGreetDurationMinutes,
      });

      registrarCompraGeo({
        creatorId: group?.ownerId,
        serviceType: "live_session",
        grossAmount: meetGreetPrice ?? undefined,
      });

      const successMessage = tGroups("meetGreetSent");

      setMeetGreetOpen(false);
      setMeetGreetMessage("");
      setServiceToast(successMessage);
      clearServiceQuery();

      window.setTimeout(() => {
        setServiceToast((current) =>
          current === successMessage ? null : current
        );
      }, 4000);
    } catch (e: unknown) {
      setMeetGreetError(
        (e instanceof Error ? e.message : null) ?? tGroups("meetGreetError")
      );
    } finally {
      setMeetGreetSubmitting(false);
    }
  }


  function openExclusiveSessionForm() {
    setExclusiveSessionError(null);
    setServiceToast(null);
    setExclusiveSessionMessage("");
    setExclusiveSessionOpen(true);
  }

  function closeExclusiveSessionForm() {
    if (exclusiveSessionSubmitting) return;
    setExclusiveSessionOpen(false);
    setExclusiveSessionSubmitting(false);
    setExclusiveSessionError(null);
    setExclusiveSessionMessage("");
    setIsRetry(false);
    clearServiceQuery();
  }

  async function submitExclusiveSessionRequest() {
    if (!user) {
      redirectToLogin();
      return;
    }

    if (isOwner) {
      setExclusiveSessionError(tGroups("ownCommunitySession"));
      return;
    }

    if (!canRequestExclusiveSession) {
      setExclusiveSessionError(tGroups("noValidMembershipSession"));
      return;
    }
    setExclusiveSessionSubmitting(true);
    setExclusiveSessionError(null);

    try {
      await createExclusiveSessionRequest({
        groupId,
        buyerMessage: exclusiveSessionMessage.trim() || null,
        priceSnapshot: exclusiveSessionPrice,
        durationMinutes: exclusiveSessionDurationMinutes,
      });

      registrarCompraGeo({
        creatorId: group?.ownerId,
        serviceType: "exclusive_session",
        grossAmount: exclusiveSessionPrice ?? undefined,
      });

      const successMessage = tGroups("sessionExclusiveSent");

      setExclusiveSessionOpen(false);
      setExclusiveSessionMessage("");
      setServiceToast(successMessage);
      clearServiceQuery();

      window.setTimeout(() => {
        setServiceToast((current) =>
          current === successMessage ? null : current
        );
      }, 4000);
    } catch (e: unknown) {
      setExclusiveSessionError(
        (e instanceof Error ? e.message : null) ?? tGroups("sessionCreateError")
      );
    } finally {
      setExclusiveSessionSubmitting(false);
    }
  }

  useEffect(() => {
    const requestedService = searchParams.get("service");

    if (!requestedService) return;

    if (requestedService === "suscripcion") {
      if (!user) {
        redirectToLogin();
        return;
      }

      if (isSubscriptionGroup && !effectiveIsMember && !isOwner) {
        openSubscriptionModal();
      }

      return;
    }

    if (isGreetingType(requestedService)) {
      if (!user) {
        redirectToLogin();
        return;
      }

      if (isOwner) {
        setServiceToast(tGroups("ownCommunityService"));
        clearServiceQuery();
        return;
      }

      if (!canRequestCreatorServices) {
        setServiceToast(tGroups("noValidMembership"));
        clearServiceQuery();
        return;
      }

      const retry = searchParams.get("retry") === "true";
      const prefillToName = searchParams.get("toName") ?? "";
      const prefillInstructions = searchParams.get("instructions") ?? "";
      openGreetingForm(requestedService);
      if (retry) {
        setIsRetry(true);
        if (prefillToName) setToName(prefillToName);
        if (prefillInstructions) setInstructions(prefillInstructions);
      }
      return;
    }

    if (requestedService === "meet_greet_digital") {
      if (!user) {
        redirectToLogin();
        return;
      }

      if (isOwner) {
        setServiceToast(tGroups("ownCommunityMeetGreet"));
        clearServiceQuery();
        return;
      }

      if (!canRequestCreatorServices) {
        setServiceToast(tGroups("noValidMembership"));
        clearServiceQuery();
        return;
      }
      const retryMG = searchParams.get("retry") === "true";
      const prefillMsgMG = searchParams.get("message") ?? "";
      openMeetGreetForm();
      if (retryMG) {
        setIsRetry(true);
        if (prefillMsgMG) setMeetGreetMessage(prefillMsgMG);
      }
      return;
    }

    if (requestedService === "clase_personalizada") {
      if (!user) {
        redirectToLogin();
        return;
      }

      if (isOwner) {
        setServiceToast(tGroups("ownCommunitySession"));
        clearServiceQuery();
        return;
      }

      if (!canRequestCreatorServices) {
        setServiceToast(tGroups("noValidMembership"));
        clearServiceQuery();
        return;
      }

      const retryES = searchParams.get("retry") === "true";
      const prefillMsgES = searchParams.get("message") ?? "";
      openExclusiveSessionForm();
      if (retryES) {
        setIsRetry(true);
        if (prefillMsgES) setExclusiveSessionMessage(prefillMsgES);
      }
      return;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
  searchParams,
  user,
  canRequestMeetGreet,
  canRequestExclusiveSession,
  canRequestCreatorServices,
  effectiveIsMember,
  isOwner,
  isSubscriptionGroup,
]);

  // Deep-link desde la notificación de solicitud de unión: abre la pestaña
  // Integrantes y despliega la lista de solicitudes pendientes. Solo owner/mods.
  useEffect(() => {
    if (!user || !(isOwner || isModerator)) return;
    if (searchParams.get("requests") !== "1") return;
    setActiveTab("members");
    setRequestsDeepLinkOpen(true);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("requests");
    const nextHref = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname;
    router.replace(nextHref, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isOwner, isModerator, searchParams]);

  // Deep-link "Comenzar ahora" de suscripciones (onboarding de la Wallet): abre
  // la pestaña de servicios de la comunidad y centra la card de suscripción.
  useEffect(() => {
    if (!user || !isOwner) return;
    if (searchParams.get("configure") !== "subscription") return;
    setActiveTab("services");
    let cancelled = false;
    const timers: number[] = [];
    const centerOnce = () => {
      if (cancelled) return;
      const el = document.getElementById("admin-subscription");
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const top =
        window.scrollY + rect.top - window.innerHeight / 2 + rect.height / 2;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    };
    let tries = 0;
    const waitForCard = () => {
      if (cancelled) return;
      if (document.getElementById("admin-subscription")) {
        centerOnce();
        [250, 550, 900].forEach((d) =>
          timers.push(window.setTimeout(centerOnce, d))
        );
        return;
      }
      if (tries++ < 40) timers.push(window.setTimeout(waitForCard, 100));
    };
    timers.push(window.setTimeout(waitForCard, 150));
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isOwner, searchParams]);

  useEffect(() => {
    if (!serviceToast) return;

    const timeoutId = window.setTimeout(() => {
      setServiceToast(null);
    }, 4000);

    return () => window.clearTimeout(timeoutId);
  }, [serviceToast]);

const openCropWithFile = useCallback(
  async (mode: CropMode, file: File) => {
    if (!isOwner) return;

    setActionError(null);

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
      setActionError((e instanceof Error ? e.message : null) ?? `❌ ${tGroups("groupImageReadError")}`);
    }
  },
  [isOwner, tGroups]
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
    (_croppedArea: unknown, croppedAreaPixelsArg: unknown) => {
      setCroppedAreaPixels(croppedAreaPixelsArg as GroupCropArea);
    },
    []
  );

  async function uploadCropped(mode: CropMode) {
    if (!group) return;
    if (!isOwner) return;
    if (!cropImageSrc || !croppedAreaPixels) {
      setActionError(`❌ ${tGroups("groupCropError")}`);
      return;
    }

    setUploading(true);
    setActionError(null);

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
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string } | null;
      setActionError(
        err?.code === "permission-denied"
          ? `❌ ${tGroups("groupStoragePermissionError")}`
          : `❌ ${tGroups("groupImageUploadError")}: ${err?.message ?? "error"}`
      );
    } finally {
      setUploading(false);
    }
  }

  const groupRoutePageWrap: React.CSSProperties = {
    ...pageWrap,
    background: "transparent",
    minHeight: "auto",
    paddingTop: 0,
    paddingBottom: 0,
  };

  const groupRouteContainer: React.CSSProperties = {
    ...container,
    paddingTop: 0,
    paddingBottom: 0,
    marginTop: 0,
  };

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          background: "#000",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
        }}
      >
        <div className="vibraPullRefreshSpinner refreshing" style={{ width: 32, height: 32 }} />
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.32)", letterSpacing: "0.01em" }}>
          {tGroups("loadingCommunity")}
        </span>
      </main>
    );
  }

  if (error && !group) {
    return (
      <main style={groupRoutePageWrap}>
        <div style={groupRouteContainer}>
          <div style={{ ...cardStyle, padding: 18 }}>
            <div style={{ ...messageBox, color: "#fff" }}>{error}</div>
          </div>
        </div>
      </main>
    );
  }

  if (!group) return null;

  const groupDeletionState = group as GroupDoc;

  const groupIsDeleted =
    groupDeletionState.isDeleted === true ||
    Boolean(groupDeletionState.deletedAt);

  const groupIsPaused = groupDeletionState.isActive === false;

  if (groupIsDeleted && !isEmbed) {
    return (
      <main style={groupRoutePageWrap}>
        <div style={groupRouteContainer}>
          <div style={{ ...cardStyle, padding: 18 }}>
            <div style={{ display: "grid", gap: 10 }}>
              <h1 style={{ ...titleStyle, margin: 0 }}>
                {tGroups("communityNotAvailable")}
              </h1>

              <p style={{ ...textStyle, margin: 0 }}>
                {tGroups("communityDeletedDesc")}
              </p>

              <button
                type="button"
                onClick={() => router.replace("/groups")}
                style={{
                  ...secondaryButton,
                  width: "fit-content",
                  marginTop: 4,
                }}
              >
                {tCommon("back")}
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const deletionBanner = isEmbed && groupIsDeleted ? (
    <div
      style={{
        background: "#1a0505",
        borderBottom: "1px solid #7f1d1d",
        padding: "10px 16px",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#f87171"
        strokeWidth="2"
        style={{ flexShrink: 0, marginTop: 2 }}
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#f87171" }}>
          {tGroups("communityDeletedBanner")}
        </div>
        <div style={{ fontSize: 11, color: "#ef4444", marginTop: 2 }}>
          {formatDeletedAt(groupDeletionState.deletedAt)}
          {groupDeletionState.deletionReason
            ? ` · ${groupDeletionState.deletionReason}`
            : ""}
          {groupDeletionState.deletedBy
            ? tGroups("deletedByPrefix") + groupDeletionState.deletedBy
            : ""}
        </div>
      </div>
    </div>
  ) : null;

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

const groupShareHref = `/groups/${groupId}`;
const canShareGroup = group.visibility !== "hidden";

const groupVisualUi = {
  ...groupPageUi,
  coverHeight: "clamp(240px, 38vw, 360px)",
  avatarSize: mobileRefreshEnabled ? "clamp(146px, 31.2vw, 286px)" : "clamp(112px, 24vw, 220px)",
  avatarOffsetTop: mobileRefreshEnabled ? "calc(clamp(146px, 31.2vw, 286px) / -2)" : "calc(clamp(112px, 24vw, 220px) / -2)",
  contentTopPadding: mobileRefreshEnabled ? "calc((clamp(146px, 31.2vw, 286px) / 2) + 22px)" : "calc((clamp(112px, 24vw, 220px) / 2) + 22px)",
  liveDotOuter: mobileRefreshEnabled ? "clamp(18px, 3.8vw, 30px)" : "clamp(14px, 2.8vw, 24px)",
  liveDotInner: mobileRefreshEnabled ? "clamp(10px, 2.1vw, 16px)" : "clamp(8px, 1.6vw, 13px)",
  liveDotShell: mobileRefreshEnabled ? "clamp(22px, 4.8vw, 34px)" : "clamp(18px, 3.6vw, 28px)",
};

const groupHeaderCardStyle = {
  ...cardStyle,
  borderRadius: 18,
  border: "none",
  background: "transparent",
  boxShadow: "none",
  backdropFilter: "none",
};

const groupRoundIconButtonStyle = {
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
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(255,255,255,0.02), 0 12px 24px rgba(0,0,0,0.5)",
  backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
};

function GroupCoverLupaIcon() {
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

const groupCoverGradientStyle = {
  position: "absolute" as const,
  left: 0,
  right: 0,
  bottom: 0,
  height: "82%",
  zIndex: 10,
  pointerEvents: "none" as const,
  background:
    "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.12) 14%, rgba(0,0,0,0.26) 28%, rgba(0,0,0,0.44) 44%, rgba(0,0,0,0.62) 60%, rgba(0,0,0,0.78) 76%, rgba(0,0,0,0.9) 90%, rgba(0,0,0,0.96) 100%)",
};

const avatarNode = (
  <div
    style={{
      position: "absolute",
      left: "50%",
      top: groupVisualUi.avatarOffsetTop,
      transform: "translateX(-50%)",
      zIndex: 20,
    }}
  >
    <div style={{ position: "relative" }}>
      {groupIsLive && (
        <>
          <div
            style={{
              position: "absolute",
              inset: -6,
              borderRadius: "50%",
              background: "#ef4444",
              zIndex: 0,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: "50%",
              transform: "translate(-50%, calc(50% + 3px))",
              width: groupVisualUi.liveDotShell,
              height: groupVisualUi.liveDotShell,
              borderRadius: "50%",
              background: "rgb(10,10,14)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            <div style={{ position: "absolute", width: groupVisualUi.liveDotOuter, height: groupVisualUi.liveDotOuter, borderRadius: "50%", background: "#ef4444", animation: "grpLiveOuter 1.6s ease-in-out infinite" }} />
            <div style={{ position: "absolute", width: groupVisualUi.liveDotInner, height: groupVisualUi.liveDotInner, borderRadius: "50%", background: "#ef4444", animation: "grpLiveInner 1.6s ease-in-out infinite" }} />
          </div>
          <style>{`
            @keyframes grpLiveOuter { 0%,100%{transform:scale(1);opacity:0.5} 50%{transform:scale(1.5);opacity:0.15} }
            @keyframes grpLiveInner { 0%,100%{transform:scale(1)} 50%{transform:scale(0.8)} }
          `}</style>
        </>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handlePickAvatar();
        }}
        disabled={!isOwner || uploading}
        style={{
          width: groupVisualUi.avatarSize,
          height: groupVisualUi.avatarSize,
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
          cursor: !isOwner || uploading ? "default" : "pointer",
          pointerEvents: isOwner ? "auto" : "none",
          position: "relative",
        }}
        aria-label={tGroups("communityAvatarLabel")}
        title={isOwner ? tGroups("changeAvatarLabel") : undefined}
      >
        {group.avatarUrl ? (
          <Image
            src={group.avatarUrl}
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
              fontFamily: groupPageFontStack,
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
            ...groupRoundIconButtonStyle,
            position: "absolute",
            right: 8,
            bottom: 8,
            cursor: uploading ? "not-allowed" : "pointer",
            fontSize: 17,
            fontWeight: 600,
            display: "grid",
            placeItems: "center",
            zIndex: 200,
            pointerEvents: "auto",
            fontFamily: groupPageFontStack,
            lineHeight: 1,
          }}
          title={tGroups("changeAvatarLabel")}
          aria-label={tGroups("changeAvatarLabel")}
        >
          {uploading && cropMode === "avatar" ? "..." : "✎"}
        </button>
      )}
    </div>
  </div>
);

  const shouldShowRestrictedLanding =
    !isEmbed &&
    !isOwner &&
    !effectiveIsMember &&
    (group.visibility === "private" || group.visibility === "hidden");

  if (shouldShowRestrictedLanding) {
    const pending = joinReqStatus === "pending";
    const rejected = joinReqStatus === "rejected";
    const approved = joinReqStatus === "approved";
    const isBanned = memberStatus === "banned";
    const isPrivate = group.visibility === "private";
    const isHidden = group.visibility === "hidden";
    const hasLegacyAccess =
      membershipAccessType === "legacy_free" || membershipLegacyComplimentary;

    return (
      <>
        <main style={groupRoutePageWrap}>
          <style jsx>{`
            .group-shell {
              width: 100%;
              padding: 0;
              box-sizing: border-box;
              min-width: 0;
            }

            .group-card {
              position: relative;
              overflow: hidden;
              min-width: 0;
            }

            .group-card::before,
            .group-card::after {
              display: none;
            }

            .group-card > * {
              position: relative;
              z-index: 2;
            }

            .group-content {
  position: relative;
  padding: 0 18px 20px;
  min-width: 0;
}

.group-header-copy {
  padding-top: calc((clamp(112px, 24vw, 220px) / 2) + 22px);
  position: relative;
  z-index: 1;
  min-height: 110px;
  min-width: 0;
}
@media (max-width: 768px) {
  .group-header-copy {
    padding-top: calc((clamp(146px, 31.2vw, 286px) / 2) + 22px);
  }
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
              border-top: 0;
              padding-top: 0;
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

@media (max-width: 900px) {
  .group-shell {
    max-width: none;
    padding: 0;
  }
}

@media (max-width: 640px) {
  .group-shell {
    padding: 0;
  }

  .group-card {
    border-radius: 0 !important;
    border-left: 0 !important;
    border-right: 0 !important;
  }

  .group-content {
    padding: 0 12px 18px;
  }

  .group-actions-row > button {
    width: 100%;
  }
}
          `}</style>

          <div style={groupRouteContainer}>
            <section
  className="group-card"
  style={groupHeaderCardStyle}
>
<div
  style={{
    position: "relative",
    height: groupVisualUi.coverHeight,
    background: "#0b0b0b",
  }}
>
                <Image
                  src={coverBg}
                  alt="Cover"
                  fill
                  style={{ objectFit: "cover", opacity: 0.96 }}
                />

                <div style={groupCoverGradientStyle} />
                <style>{`.cover-corner-muted{opacity:0.65}@media(max-width:900px){.cover-corner-muted{opacity:0.85}}`}</style>
                {!coverSearchOpen && (
                  <div
                    style={{
                      position: "absolute",
                      right: 18,
                      top: 18,
                      zIndex: 40,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setCoverSearchOpen(true)}
                      aria-label={tCommon("searchInThisCommunity")}
                      title={tCommon("searchInThisCommunity")}
                      className="cover-corner-muted"
                      style={{ ...groupRoundIconButtonStyle, color: "#fff", cursor: "pointer" }}
                    >
                      <GroupCoverLupaIcon />
                    </button>
                    {canShareGroup && (
                      <CopyLinkButton
                        href={groupShareHref}
                        copiedLabel={tCommon("groupLinkCopied")}
                        title={tCommon("copyGroupLink")}
                        style={{ ...groupRoundIconButtonStyle }}
                      />
                    )}
                  </div>
                )}
                {coverSearchOpen && (
                  <CoverSearchBar
                    onSubmit={handleCoverSearchSubmit}
                    onClose={closeCoverSearch}
                    placeholder={tCommon("searchInThisCommunity")}
                  />
                )}
              </div>

              <div className="group-content">
                {avatarNode}

                <div className="group-header-copy">
                  <div className="group-meta">
                    <h1 style={{ ...titleStyle, margin: 0 }}>
                      {group.name ?? ""}
                    </h1>

                    {!!group.description && (
                      <div className="group-description" style={textStyle}>
                        {group.description}
                      </div>
                    )}

<div
  style={{
    marginTop: 8,
    ...microText,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexWrap: "wrap",
  }}
>
  <span>{visibilityLabel(String(group.visibility ?? ""))}</span>

  {memberCount !== null && (
    <>
      <span
        aria-hidden="true"
        style={{
          width: 4,
          height: 4,
          borderRadius: 999,
          background: "rgba(255,255,255,0.42)",
          display: "inline-block",
        }}
      />

      <span>
        {formattedMemberCount} {memberCount === 1 ? tCommon("member") : tCommon("members")}
      </span>
    </>
  )}
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
                      {isBanned && tGroups("communityBanned")}

                      {!isBanned && hasLegacyAccess && tGroups("communityLegacyAccess")}

                      {!isBanned && approved && tGroups("approvedAccess")}

                      {!isBanned &&
                        shouldShowSubscriptionRecovery &&
                        tGroups("subscriptionRequiredRecovery", {
                          priceText: subscriptionPrice != null
                            ? tGroups("subscriptionMonthlyCost", { price: `${formatMoney(subscriptionPrice, subscriptionCurrency)}` })
                            : tGroups("subscriptionMonthlyCostAvailable"),
                        })}

                      {!isBanned &&
                        !shouldShowSubscriptionRecovery &&
                        isSubscriptionGroup &&
                        tGroups("subscriptionRequired", {
                          priceText: subscriptionPrice != null
                            ? tGroups("subscriptionMonthlyCost", { price: `${formatMoney(subscriptionPrice, subscriptionCurrency)}` })
                            : tGroups("subscriptionMonthlyCostAvailable"),
                        })}

                      {!isBanned &&
                        removedBySubscriptionTransition &&
                        !subscriptionEnabled &&
                        tGroups("accessRevoked")}

                      {!isBanned &&
                        !shouldShowSubscriptionRecovery &&
                        !removedBySubscriptionTransition &&
                        !isSubscriptionGroup &&
                        isPrivate &&
                        pending &&
                        tGroups("pendingRequest")}

                      {!isBanned &&
                        !shouldShowSubscriptionRecovery &&
                        !removedBySubscriptionTransition &&
                        !isSubscriptionGroup &&
                        isPrivate &&
                        !pending &&
                        !approved &&
                        !rejected &&
                        tGroups("communityPrivateRequiresApproval")}

                      {!isBanned &&
                        !shouldShowSubscriptionRecovery &&
                        !removedBySubscriptionTransition &&
                        !isSubscriptionGroup &&
                        isPrivate &&
                        rejected &&
                        tGroups("communityAccessRejected")}

                      {!isBanned &&
                        !shouldShowSubscriptionRecovery &&
                        !removedBySubscriptionTransition &&
                        !isSubscriptionGroup &&
                        isHidden &&
                        tGroups("communityHiddenNoAccess")}
                    </div>

                    {!isBanned &&
                      (shouldShowSubscriptionRecovery || isSubscriptionGroup) && (
                        <div
                          className="group-actions-row"
                          style={{ marginTop: 14 }}
                        >
                          <button
                            onClick={openSubscriptionModal}
                            disabled={joining}
                            style={{
                              ...primaryButton,
                              background: "#3b82f6",
                              opacity: joining ? 0.75 : 1,
                              cursor: joining ? "not-allowed" : "pointer",
                            }}
                          >
                            {user
                              ? subscriptionPrice != null
                                ? tGroups("subscribeForPrice", { price: formatMoney(subscriptionPrice, subscriptionCurrency) })
                                : tGroups("subscribeCta")
                              : tGroups("loginToSubscribe")}
                          </button>
                        </div>
                      )}

                    {!isBanned &&
                      !shouldShowSubscriptionRecovery &&
                      !removedBySubscriptionTransition &&
                      !isSubscriptionGroup &&
                      isPrivate && (
                        <div
                          className="group-actions-row"
                          style={{ marginTop: 14 }}
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
                              {joining
                                ? tCommon("sending")
                                : user
                                ? tGroups("requestAccess")
                                : tGroups("loginToRequestAccess")}
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
                              {joining ? tCommon("sending") : tCommon("cancel")}
                            </button>
                          )}
                        </div>
                      )}
                  </div>
                </div>
              </div>
            </section>

          {!isBanned && (
            <div style={{ paddingTop: 16, width: "100%" }}>
              <div ref={groupPostsAnchorRef} aria-hidden="true" style={{ scrollMarginTop: 72 }} />
              <GroupPostsFeed
                key={`group-posts-public-${groupId}`}
                groupId={groupId}
                groupVisibility={normalizeVisibility(group.visibility)}
                isOwner={false}
                isModerator={false}
                viewerIsMember={false}
                canCreatePosts={false}
                canCommentOnPosts={false}
                postBlockedReason={user ? "join" : "login"}
                commentBlockedReason={user ? "join" : "login"}
                publicPremiumOnly={true}
                searchQuery={postSearchQuery}
              />
            </div>
          )}
          </div>

        </main>

        {typeof window !== "undefined" && createPortal(
          subscriptionOpen ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="group-subscription-modal-title"
              style={serviceModalBackdropStyle}
              onClick={() => { if (!subscriptionSubmitting) closeSubscriptionModal(); }}
            >
              <div
                style={{ ...serviceModalCardStyle, maxWidth: 460 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div id="group-subscription-modal-title" style={subtitleStyle}>{tServices("subscriptionModalTitle")}</div>
                  <button
                    type="button"
                    onClick={closeSubscriptionModal}
                    disabled={subscriptionSubmitting}
                    style={{ ...secondaryButton, opacity: subscriptionSubmitting ? 0.75 : 1, cursor: subscriptionSubmitting ? "not-allowed" : "pointer" }}
                  >
                    {tCommon("close")}
                  </button>
                </div>
                <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                  <div style={textStyle}>{tServices("subscriptionModalRequired")}</div>
                  <div style={panelStyle}>
                    <div style={labelStyle}>{tServices("monthlyCost")}</div>
                    <div style={{ marginTop: 6, fontSize: 24, fontWeight: 800, color: "#fff" }}>
                      {subscriptionPrice != null
                        ? formatMoney(subscriptionPrice, subscriptionCurrency)
                        : tServices("priceNotAvailable", { currency: subscriptionCurrency })}
                    </div>
                  </div>
                  {subscriptionError && (
                    <div style={{ fontSize: 13, color: "#f87171", padding: "10px 14px", borderRadius: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)" }}>
                      {subscriptionError}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={handleSubscriptionCheckout}
                      disabled={subscriptionSubmitting}
                      style={{ ...primaryButton, opacity: subscriptionSubmitting ? 0.75 : 1, cursor: subscriptionSubmitting ? "not-allowed" : "pointer" }}
                    >
                      {subscriptionSubmitting ? tFeed("processing") : tServices("payAndJoin")}
                    </button>
                    <button
                      type="button"
                      onClick={closeSubscriptionModal}
                      disabled={subscriptionSubmitting}
                      style={{ ...secondaryButton, opacity: subscriptionSubmitting ? 0.75 : 1, cursor: subscriptionSubmitting ? "not-allowed" : "pointer" }}
                    >
                      {tCommon("cancel")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null,
          document.body
        )}
      </>
    );
  }

  const isPublicGroup = group.visibility === "public";
  const canViewPublicFeed = isPublicGroup || effectiveIsMember || isOwner || isEmbed;

  const canCreatePosts =
    !groupIsPaused &&
    (isOwner ||
      (effectiveIsMember &&
        (memberStatus === "active" || memberStatus === "subscribed") &&
        currentPostingMode === "members"));

  const canCommentOnPosts =
    !groupIsPaused &&
    (isOwner ||
      (effectiveIsMember &&
        (memberStatus === "active" || memberStatus === "subscribed") &&
        currentCommentsEnabled));

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
      postBlockedReason = isEmbed ? null : "join";
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
      commentBlockedReason = isEmbed ? null : "join";
    } else {
      commentBlockedReason = "restricted";
    }
  }

  return (
    <>
      <RefreshableArea
        onRefresh={handleGroupPullRefresh}
        enabled={mobileRefreshEnabled}
      >
        <main style={groupRoutePageWrap}>
        <style jsx>{`
          .group-shell {
            width: 100%;
            padding: 0;
            box-sizing: border-box;
            min-width: 0;
          }

          .group-card {
            position: relative;
            overflow: hidden;
            min-width: 0;
          }

          .group-card::before,
          .group-card::after {
            display: none;
          }

          .group-card > * {
            position: relative;
            z-index: 2;
          }

.group-content {
  position: relative;
  padding: 0 18px 8px;
  min-width: 0;
}

.group-header-copy {
  padding-top: calc((clamp(112px, 24vw, 220px) / 2) + 22px);
  position: relative;
  z-index: 1;
  min-height: 110px;
  min-width: 0;
}
@media (max-width: 768px) {
  .group-header-copy {
    padding-top: calc((clamp(146px, 31.2vw, 286px) / 2) + 22px);
  }
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

          .group-services-wrap {
            margin-top: 14px;
            width: 100%;
            max-width: 720px;
            margin-left: auto;
            margin-right: auto;
            min-width: 0;
          }

          .group-subnav-wrap {
            margin-top: 12px;
            width: 100%;
            max-width: none;
            margin-left: auto;
            margin-right: auto;
            min-width: 0;
          }

          .group-actions-wrap {
            margin-top: 18px;
            border-top: 0;
            padding-top: 0;
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

          .group-tab-content {
            width: 100%;
            min-width: 0;
            overflow: hidden;
            box-sizing: border-box;
          }

          .group-tab-panel {
            width: 100%;
            min-width: 0;
            overflow: hidden;
            box-sizing: border-box;
          }

@media (max-width: 900px) {
  .group-shell {
    max-width: none;
    padding: 0;
  }
}

@media (max-width: 640px) {
  .group-shell {
    padding: 0;
  }

  .group-card {
    border-radius: 0 !important;
    border-left: 0 !important;
    border-right: 0 !important;
  }

  .group-content {
    padding: 0 12px 8px;
  }

  .group-actions-row > button {
    width: 100%;
  }

  .group-feed-wrap {
    max-width: none;
    width: 100%;
    min-width: 0;
    gap: 0;
  }

  .group-feed-item {
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }

  .group-subnav-wrap,
  .group-services-wrap {
    max-width: none;
    width: 100%;
  }
}
        `}</style>

        {deletionBanner}

        <div style={groupRouteContainer}>
          <section
  className="group-card"
  style={groupHeaderCardStyle}
>
<div
  style={{
    position: "relative",
    height: groupVisualUi.coverHeight,
    background: "#0b0b0b",
  }}
>
              <Image
                src={coverBg}
                alt="cover"
                fill
                style={{ objectFit: "cover", opacity: 0.96 }}
              />

<div style={groupCoverGradientStyle} />
<style>{`.cover-corner-muted{opacity:0.65}@media(max-width:900px){.cover-corner-muted{opacity:0.85}}`}</style>

              {!coverSearchOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 18,
                    top: 18,
                    zIndex: 40,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setCoverSearchOpen(true)}
                    aria-label={tCommon("searchInThisCommunity")}
                    title={tCommon("searchInThisCommunity")}
                    className="cover-corner-muted"
                    style={{ ...groupRoundIconButtonStyle, color: "#fff", cursor: "pointer" }}
                  >
                    <GroupCoverLupaIcon />
                  </button>
                  {canShareGroup && (
                    <CopyLinkButton
                      href={groupShareHref}
                      copiedLabel={tCommon("groupLinkCopied")}
                      title={tCommon("copyGroupLink")}
                      style={{ ...groupRoundIconButtonStyle }}
                    />
                  )}
                </div>
              )}

              {coverSearchOpen && (
                <CoverSearchBar
                  onSubmit={handleCoverSearchSubmit}
                  onClose={closeCoverSearch}
                  placeholder={tCommon("searchInThisCommunity")}
                />
              )}

              {!coverSearchOpen && isOwner && (
                <button
                  onClick={handlePickCover}
                  disabled={uploading}
                  type="button"
                  style={{
                    ...groupRoundIconButtonStyle,
                    position: "absolute",
                    right: 14,
                    bottom: 14,
                    opacity: uploading ? 0.7 : 1,
                    cursor: uploading ? "not-allowed" : "pointer",
                    zIndex: 40,
                  }}
                  title={tGroups("chooseCover")}
                  aria-label={tGroups("chooseCover")}
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
                    {uploading && cropMode === "cover" ? "..." : "✎"}
                  </span>
                </button>
              )}
            </div>

            <div className="group-content">
              {avatarNode}

              <div className="group-header-copy">
                <div className="group-meta">
                  <h1 style={{ ...titleStyle, margin: 0 }}>
                    {group.name ?? ""}
                  </h1>

                  {!!group.description && (
                    <div className="group-description" style={textStyle}>
                      {group.description}
                    </div>
                  )}

<div
  className="group-visibility"
  style={{
    ...microText,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexWrap: "wrap",
  }}
>
  <span>{visibilityLabel(String(group.visibility ?? ""))}</span>

  {memberCount !== null && (
    <>
      <span
        aria-hidden="true"
        style={{
          width: 4,
          height: 4,
          borderRadius: 999,
          background: "rgba(255,255,255,0.42)",
          display: "inline-block",
        }}
      />

      <span>
        {formattedMemberCount} {memberCount === 1 ? tCommon("member") : tCommon("members")}
      </span>
    </>
  )}
</div>

                  <div style={{
                    marginTop: 10,
                    width: "100%",
                    display: "flex",
                    flexDirection: "row",
                    justifyContent: "center",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 14,
                  }}>
                    {!isOwner && (
                      effectiveIsMember ? (
                        <button
                          type="button"
                          onClick={() => setLeaveOverlayOpen(true)}
                          style={{ ...primaryButton }}
                        >
                          {membershipRequiresSubscription ? tGroups("subscribedLabel") : tGroups("alreadyMemberLabel")}
                        </button>
                      ) : (
                        group.visibility === "public" && memberStatus !== "banned" ? (
                          <button
                            type="button"
                            onClick={handleJoinPublic}
                            disabled={joining}
                            style={{
                              ...primaryButton,
                              opacity: joining ? 0.75 : 1,
                              cursor: joining ? "not-allowed" : "pointer",
                            }}
                          >
                            {joining ? tFeed("processing") : user ? tGroups("join") : tGroups("loginToJoin")}
                          </button>
                        ) : null
                      )
                    )}
                  </div>

                  {canRequestCreatorServices &&
  normalizedCurrentOfferings.length > 0 && (
    <CreatorExperiencesSection
      services={normalizedCurrentOfferings}
      creatorName={group.name ?? ""}
      contextType="group"
      groupId={groupId}
      viewerMembershipStatus={isOwner ? "active" : memberStatus}
      viewerCanRequest={canRequestCreatorServices}
    />
  )}
                </div>
              </div>

              {((!isOwner && !effectiveIsMember && group.visibility === "public" && memberStatus === "banned") || !!error) && (
              <div className="group-actions-wrap">
                {!isOwner && !effectiveIsMember && group.visibility === "public" && memberStatus === "banned" && (
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
                    {tGroups("communityBannedMessage")}
                  </div>
                )}

                {error && (
                  <div style={{ ...messageBox, textAlign: "center" }}>
                    {error}
                  </div>
                )}
              </div>
              )}
            </div>
          </section>

                    {groupIsPaused && !isEmbed && (
            <div style={{ ...panelStyle, marginTop: 12 }}>
              <div
                style={{
                  ...messageBox,
                  textAlign: "center",
                  border: "1px solid rgba(250,204,21,0.35)",
                  background: "rgba(250,204,21,0.08)",
                  color: "#fde68a",
                  fontWeight: 600,
                }}
              >
                {tGroups("communityPausedDetail")}
              </div>
            </div>
          )}

          <GroupStoryCircles
            groupId={groupId}
            canView={canViewPublicFeed}
            currentUserId={user?.uid ?? null}
            isOwner={isOwner}
          />

          {(effectiveIsMember || isEmbed) && (
            <div className="group-subnav-wrap" style={{ marginTop: 12 }}>
              <GroupSubnav
                activeTab={activeTab}
                onChange={handleTabChange}
                canManage={isOwner}
              />
            </div>
          )}

          <div
            className="group-tab-content"
            style={{ width: "100%", minWidth: 0, overflow: "hidden" }}
          >
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
            {activeTab === "feed" && (
              <section className="group-tab-panel group-feed-wrap" style={{ marginTop: 12 }}>
                <div className="group-feed-item">
<div ref={groupPostsAnchorRef} aria-hidden="true" style={{ scrollMarginTop: 72 }} />
<GroupPostsFeed
  key={`group-posts-${groupId}-${groupPageRefreshKey}`}
  groupId={groupId}
  groupVisibility={normalizeVisibility(group.visibility)}
  isOwner={isOwner}
  isModerator={isModerator}
  viewerIsMember={effectiveIsMember}
  canCreatePosts={canCreatePosts}
  canCommentOnPosts={canCommentOnPosts}
  postBlockedReason={postBlockedReason}
  commentBlockedReason={commentBlockedReason}
  broadcastLiveOnly={!canViewPublicFeed}
  readOnly={isEmbed}
  searchQuery={postSearchQuery}
  onMediaTabChange={setFeedMediaTab}
  feedLeadingContent={
    <>
      {normalizedCurrentDonation?.mode === "general" && normalizedCurrentDonation?.enabled === true && normalizedCurrentDonation?.visible !== false && (
        <div className="group-feed-item" style={{ marginBottom: 12 }}>
          <DonationFeedBanner
            message={normalizedCurrentDonation.message ?? null}
            playbackId={normalizedCurrentDonation.playbackId ?? null}
            creatorName={group.name ?? null}
            profilePhoto={group.avatarUrl ?? null}
            donationMode={normalizedCurrentDonation.mode ?? null}
            goalLabel={normalizedCurrentDonation.goalLabel ?? null}
            expanded={groupDonationViewerOpen}
            onClick={normalizedCurrentDonation.playbackId ? () => setGroupDonationViewerOpen(true) : undefined}
            onClose={() => setGroupDonationViewerOpen(false)}
            suggestedAmounts={normalizedCurrentDonation.suggestedAmounts ?? null}
            currency={normalizedCurrentDonation.currency ?? null}
            viewerIsCreator={isOwner}
          />
        </div>
      )}

      {user?.uid && isOwner && (
        <div className="group-feed-item" style={{ marginBottom: 12 }}>
          <CreatorSessionCountdownBanner uid={user.uid} />
        </div>
      )}

      {user?.uid && (
        <div className="group-feed-item" style={{ marginBottom: 12 }}>
          <SessionCountdownBanner uid={user.uid} />
        </div>
      )}
    </>
  }
/>
                </div>

                {user?.uid && !isEmbed && feedMediaTab === "feed" ? (
                  <div className="group-feed-item">
                    <GroupRecommendationsRail
                      currentUserId={user.uid}
                      context="group"
                      suppressOnboarding
                    />
                  </div>
                ) : null}
              </section>
            )}

            {(effectiveIsMember || isEmbed) && activeTab === "members" && (
              <div className="group-tab-panel" style={{ marginTop: 12 }}>
                <GroupMembersTab
                  groupId={groupId}
                  isOwner={isOwner}
                  isModerator={isModerator}
                  canMembersViewList={isEmbed || canMembersViewList}
                  initialShowRequests={requestsDeepLinkOpen}
                />
              </div>
            )}

            {activeTab === "services" && isOwner && user && group.ownerId && (
              <section className="group-tab-panel" style={{ ...panelStyle, marginTop: 12 }}>
                <OwnerAdminServices
                  groupId={groupId}
                  ownerId={group.ownerId}
                  currentUserId={user.uid}
                  currentVisibility={normalizeVisibility(group.visibility)}
                  currentMonetization={normalizedCurrentMonetization}
                  currentOfferings={normalizedCurrentOfferings}
                  currentDonation={normalizedCurrentDonation}
                />
              </section>
            )}

            {activeTab === "settings" && isOwner && user && group.ownerId && (
              <section className="group-tab-panel" style={{ ...panelStyle, marginTop: 12 }}>
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
                  currentVisibility={normalizeVisibility(group.visibility)}
                  currentPostingMode={currentPostingMode}
                  currentCommentsEnabled={currentCommentsEnabled}
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

      <CreatorServiceModals
        greetOpen={greetOpen}
        greetSubmitting={greetSubmitting}
        greetType={greetType}
        creatorName={group.name ?? undefined}
        toName={toName}
        instructions={instructions}
        greetError={greetError}
        greetSuccess={greetSuccess}
        onCloseGreeting={closeGreetingForm}
        onSubmitGreeting={submitGreetingRequest}
        onChangeToName={setToName}
        onChangeInstructions={setInstructions}
        allowCreatorStory={allowCreatorStory}
        onChangeAllowCreatorStory={setAllowCreatorStory}
        greetPriceLabel={greetPriceLabel}
        meetGreetOpen={meetGreetOpen}
        meetGreetSubmitting={meetGreetSubmitting}
        meetGreetMessage={meetGreetMessage}
        meetGreetError={meetGreetError}
        meetGreetPriceLabel={
          meetGreetPrice != null
            ? formatMoney(meetGreetPrice, meetGreetCurrency)
            : tCommon("toBeConfirmed")
        }
        meetGreetDurationLabel={
          meetGreetDurationMinutes != null
            ? `${meetGreetDurationMinutes} ${tCommon("minutes")}`
            : tCommon("toBeConfirmed")
        }
        onCloseMeetGreet={closeMeetGreetForm}
        onSubmitMeetGreet={submitMeetGreetRequest}
        onChangeMeetGreetMessage={setMeetGreetMessage}
        exclusiveSessionOpen={exclusiveSessionOpen}
        exclusiveSessionSubmitting={exclusiveSessionSubmitting}
        exclusiveSessionMessage={exclusiveSessionMessage}
        exclusiveSessionError={exclusiveSessionError}
        exclusiveSessionPriceLabel={
          exclusiveSessionPrice != null
            ? formatMoney(exclusiveSessionPrice, exclusiveSessionCurrency)
            : tCommon("toBeConfirmed")
        }
        exclusiveSessionDurationLabel={
          exclusiveSessionDurationMinutes != null
            ? `${exclusiveSessionDurationMinutes} ${tCommon("minutes")}`
            : tCommon("toBeConfirmed")
        }
        onCloseExclusiveSession={closeExclusiveSessionForm}
        onSubmitExclusiveSession={submitExclusiveSessionRequest}
        onChangeExclusiveSessionMessage={setExclusiveSessionMessage}
        isRetry={isRetry}
        serviceToast={serviceToast}
      />

      {typeof window !== "undefined" && createPortal(
        subscriptionOpen ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-subscription-modal-title"
            style={serviceModalBackdropStyle}
            onClick={() => { if (!subscriptionSubmitting) closeSubscriptionModal(); }}
          >
            <div
              style={{ ...serviceModalCardStyle, maxWidth: 460 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div id="group-subscription-modal-title" style={subtitleStyle}>{tServices("subscriptionModalTitle")}</div>
                <button
                  type="button"
                  onClick={closeSubscriptionModal}
                  disabled={subscriptionSubmitting}
                  style={{ ...secondaryButton, opacity: subscriptionSubmitting ? 0.75 : 1, cursor: subscriptionSubmitting ? "not-allowed" : "pointer" }}
                >
                  {tCommon("close")}
                </button>
              </div>
              <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                <div style={textStyle}>{tServices("subscriptionModalRequired")}</div>
                <div style={panelStyle}>
                  <div style={labelStyle}>{tServices("monthlyCost")}</div>
                  <div style={{ marginTop: 6, fontSize: 24, fontWeight: 800, color: "#fff" }}>
                    {subscriptionPrice != null
                      ? formatMoney(subscriptionPrice, subscriptionCurrency)
                      : tServices("priceNotAvailable", { currency: subscriptionCurrency })}
                  </div>
                </div>
                {subscriptionError && (
                  <div style={{ fontSize: 13, color: "#f87171", padding: "10px 14px", borderRadius: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)" }}>
                    {subscriptionError}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={handleSubscriptionCheckout}
                    disabled={subscriptionSubmitting}
                    style={{ ...primaryButton, opacity: subscriptionSubmitting ? 0.75 : 1, cursor: subscriptionSubmitting ? "not-allowed" : "pointer" }}
                  >
                    {subscriptionSubmitting ? tFeed("processing") : tServices("payAndJoin")}
                  </button>
                  <button
                    type="button"
                    onClick={closeSubscriptionModal}
                    disabled={subscriptionSubmitting}
                    style={{ ...secondaryButton, opacity: subscriptionSubmitting ? 0.75 : 1, cursor: subscriptionSubmitting ? "not-allowed" : "pointer" }}
                  >
                    {tCommon("cancel")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null,
        document.body
      )}

      <GroupImageCropModal
        cropOpen={cropOpen}
        uploading={uploading}
        cropMode={cropMode}
        cropImageSrc={cropImageSrc}
        crop={crop}
        zoom={zoom}
        cropAspect={cropAspect}
        groupPageFontStack={groupPageFontStack}
        groupPageUi={groupPageUi}
        subtitleStyle={subtitleStyle}
        labelStyle={labelStyle}
        primaryButton={primaryButton}
        secondaryButton={secondaryButton}
        microText={microText}
        onClose={() => setCropOpen(false)}
        onCropChange={setCrop}
        onZoomChange={setZoom}
        onCropComplete={onCropComplete}
        onSave={() => uploadCropped(cropMode)}
      />

      {leaveOverlayOpen && typeof window !== "undefined" && createPortal(
        <div
          style={serviceModalBackdropStyle}
          onClick={() => !leaving && setLeaveOverlayOpen(false)}
        >
          <div
            style={{ ...serviceModalCardStyle, maxWidth: 400 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "4px 0 16px", display: "grid", gap: 14 }}>
              <p style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.25, margin: 0 }}>
                {membershipRequiresSubscription
                  ? tGroups("cancelSubscriptionTitle")
                  : tGroups("leaveConfirm")}
              </p>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", lineHeight: 1.5, margin: 0 }}>
                {membershipRequiresSubscription
                  ? tGroups("cancelSubscriptionWarning")
                  : tGroups("leaveWarning")}
              </p>

              {leaveError && (
                <div style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "rgba(239,68,68,0.10)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  color: "#fca5a5",
                  fontSize: 13,
                }}>
                  {leaveError}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setLeaveOverlayOpen(false)}
                  disabled={leaving}
                  style={{
                    flex: "1 1 120px",
                    minHeight: 40,
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: leaving ? "not-allowed" : "pointer",
                    opacity: leaving ? 0.6 : 1,
                  }}
                >
                  {tCommon("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleLeave}
                  disabled={leaving}
                  style={{
                    flex: "1 1 120px",
                    minHeight: 40,
                    borderRadius: 10,
                    border: "none",
                    background: "rgba(239,68,68,0.85)",
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: leaving ? "not-allowed" : "pointer",
                    opacity: leaving ? 0.75 : 1,
                  }}
                >
                  {leaving
                    ? tFeed("processing")
                    : membershipRequiresSubscription
                    ? tGroups("cancelSubscriptionButton")
                    : tCommon("leave")}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}