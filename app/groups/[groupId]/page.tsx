"use client";

import GroupServiceModals from "./components/GroupServiceModals";
import GroupImageCropModal from "./components/GroupImageCropModal";
import OwnerAdminServices from "./components/owner-admin-panel/OwnerAdminServices";

import { collection, doc, getCountFromServer, updateDoc } from "firebase/firestore";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
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
} from "@/lib/groups/membership";
import { requestToJoin, cancelJoinRequest } from "@/lib/groups/joinRequests";
import OwnerAdminPanel from "./components/OwnerAdminPanel";
import GroupSubnav from "./components/GroupSubnav";
import GroupStoryCircles from "@/app/components/Stories/GroupStoryCircles";
import GroupMembersTab from "./components/GroupMembersTab";
import GroupPostsFeed from "./components/posts/GroupPostsFeed";
import GroupRecommendationsRail from "@/app/components/GroupRecommendations/GroupRecommendationsRail";
import CreatorServicesMenu from "@/components/services/CreatorServicesMenu";
import DonationEntryPoint from "@/components/services/DonationEntryPoint";
import CopyLinkButton from "@/components/ui/CopyLinkButton";
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
  formatMoney,
} from "@/lib/groups/groupAdapters";

import { useGroupRealtime } from "@/lib/groups/useGroupRealtime";
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
  tinyGhostButton,
  coverDonationButton,
  inputStyle,
  messageBox,
  serviceModalBackdropStyle,
  serviceModalCardStyle,
  serviceToastStyle,
} from "@/lib/groups/groupPageStyles";

type JoinRequestStatus = "pending" | "approved" | "rejected" | string;
type MemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | "kicked"
  | "expelled"
  | null;

type MemberRole = "owner" | "mod" | "member" | null;
type PostingMode = "members" | "owner_only";
type InteractionBlockedReason = "login" | "join" | "restricted" | null;
type DonationMode = "none" | "general" | "wedding";
type DonationSourceScope = "group" | "profile";
type Visibility = "public" | "private" | "hidden";
type LegacyServiceVisibility = "hidden" | "members" | "public";
type LegacyServiceSourceScope = "group" | "profile" | "both";
type MembershipAccessType =
  | "standard"
  | "subscription"
  | "legacy_free"
  | "unknown";

type LocalCreatorServiceType = CreatorServiceType;
type LocalServiceMeta = CreatorServiceMeta | null;

type GroupDoc = {
  id: string;
  name?: string;
  description?: string;
  ownerId?: string;
  visibility?: Visibility | string;
  isActive?: boolean;
  isDeleted?: boolean;
  deletedAt?: unknown;
  deletedBy?: string | null;
  deletionReason?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  category?: string | null;
  tags?: string[] | null;
  postingMode?: PostingMode | string | null;
  commentsEnabled?: boolean | null;
  greetingsEnabled?: boolean | null;
  welcomeMessage?: string | null;
  monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: string | Currency | null;
    subscriptionsEnabled?: boolean;
    subscriptionPriceMonthly?: number | null;
    subscriptionCurrency?: string | Currency | null;
    paidPostsEnabled?: boolean;
    paidLivesEnabled?: boolean;
    paidVodEnabled?: boolean;
    paidLiveCommentsEnabled?: boolean;
    greetingsEnabled?: boolean;
    adviceEnabled?: boolean;
    customClassEnabled?: boolean;
    digitalMeetGreetEnabled?: boolean;
    transitions?: {
      freeToSubscriptionPolicy?:
        | "legacy_free"
        | "require_subscription"
        | null;
      subscriptionToFreePolicy?:
        | "keep_members_free"
        | "remove_all_members"
        | null;
      subscriptionPriceIncreasePolicy?:
        | "keep_legacy_price"
        | "require_resubscribe_new_price"
        | null;
      previousSubscriptionPriceMonthly?: number | null;
      nextSubscriptionPriceMonthly?: number | null;
      subscriptionPriceChangeCurrency?: string | Currency | null;
      lastMonetizationChangeAt?: unknown;
      lastMonetizationChangeBy?: string | null;
      lastAppliedTransitionKey?: string | null;
      lastAppliedTransitionAt?: unknown;
      lastAppliedTransitionBy?: string | null;
    } | null;
  } | null;
  settings?: {
    membersListVisibility?: "owner_only" | "members" | string;
  };
  permissions?: {
    postingMode?: PostingMode | string | null;
    commentsEnabled?: boolean | null;
  } | null;
  offerings?: Array<{
    type: LocalCreatorServiceType;
    enabled?: boolean;
    visible?: boolean;
    visibility?: LegacyServiceVisibility | string;
    displayOrder?: number | null;
    memberPrice?: number | null;
    publicPrice?: number | null;
    currency?: string | Currency | null;
    requiresApproval?: boolean;
    sourceScope?: LegacyServiceSourceScope | string;
    meta?: LocalServiceMeta;
    price?: number | null;
  }> | null;
  donation?: {
    mode?: DonationMode | string;
    enabled?: boolean;
    visible?: boolean;
    currency?: string | Currency | null;
    sourceScope?: DonationSourceScope | string;
    suggestedAmounts?: number[] | null;
    goalLabel?: string | null;
    title?: string | null;
    description?: string | null;
  } | null;
};

type CropMode = "avatar" | "cover";

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
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
    membershipSubscriptionActive,
    membershipLegacyComplimentary,
    membershipTransitionPendingAction,
    membershipTransitionReason,
    joinReqStatus,
  } = useGroupRealtime({
    groupId,
    userId: user?.uid ?? null,
  });

const [joining, setJoining] = useState(false);
const [actionError, setActionError] = useState<string | null>(null);
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

  return new Intl.NumberFormat("es-MX").format(memberCount);
}, [memberCount]);

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
  const meta = meetGreetOffering?.meta as Record<string, any> | null;
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
    const meta = exclusiveSessionOffering?.meta as Record<string, any> | null;
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

  const requiresSubscriptionFromMembership = useMemo(() => {
    return (
      membershipRequiresSubscription ||
      membershipAccessType === "subscription"
    );
  }, [membershipRequiresSubscription, membershipAccessType]);

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
  const [allowCreatorStory, setAllowCreatorStory] = useState(false);
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

  const [serviceToast, setServiceToast] = useState<string | null>(null);

  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [subscriptionSubmitting, setSubscriptionSubmitting] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"feed" | "members" | "services" | "settings">(
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
      setSubscriptionError(
        "La suscripción mensual solo puede usarse en comunidades privadas u ocultas."
      );
      return;
    }

    if (!subscriptionEnabled) {
      setSubscriptionError("Esta comunidad no tiene suscripción activa.");
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

      const successMessage =
        "✅ Suscripción procesada. Ya formas parte de la comunidad.";
      setSubscriptionOpen(false);
      setServiceToast(successMessage);
      clearServiceQuery();

      window.setTimeout(() => {
        setServiceToast((current) =>
          current === successMessage ? null : current
        );
      }, 4000);
    } catch (e: any) {
      setSubscriptionError(
        e?.message ??
          "No se pudo completar la suscripción. El flujo backend se conecta en el siguiente bloque."
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
      setActionError("La comunidad está pausada. No puedes unirte por ahora.");
      return;
    }

    setJoining(true);
    setActionError(null);

    try {
      await joinGroup(groupId, user.uid);
    } catch (e: any) {
      setActionError(e?.message ?? "No se pudo unir");
    } finally {
      setJoining(false);
    }
  }

  async function handleRequestPrivate() {
    if (!user) {
      redirectToLogin();
      return;
    }

        if (groupIsPausedForAccess) {
      setActionError(
        "La comunidad está pausada. No puedes solicitar acceso por ahora."
      );
      return;
    }

    setJoining(true);
    setActionError(null);

    try {
      await requestToJoin(groupId, user.uid);
    } catch (e: any) {
      if (e?.message === "GROUP_REQUIRES_SUBSCRIPTION") {
        openSubscriptionModal();
        return;
      }

      setActionError(e?.message ?? "No se pudo enviar la solicitud");
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
    } catch (e: any) {
      setActionError(e?.message ?? "No se pudo cancelar la solicitud");
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
    setAllowCreatorStory(false);
    clearServiceQuery();
  }

  async function submitGreetingRequest() {
    if (!user) return;

    if (isOwner) {
      setGreetError("No puedes solicitar/comprar saludos en tu propia comunidad.");
      return;
    }

    if (!canRequestCreatorServices) {
  setGreetError(
    "No tienes una membresía válida para solicitar este servicio."
  );
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
        allowCreatorStory,
      });

      const successMessage = `✅ Solicitud enviada correctamente. ID: ${res.requestId}`;

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
    } catch (e: any) {
      setGreetError(e?.message ?? "No se pudo enviar la solicitud.");
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
    clearServiceQuery();
  }

  async function submitMeetGreetRequest() {
    if (!user) {
      redirectToLogin();
      return;
    }

    if (isOwner) {
      setMeetGreetError(
        "No puedes solicitar/comprar un meet & greet en tu propia comunidad."
      );
      return;
    }

    if (!canRequestMeetGreet) {
  setMeetGreetError(
    "No tienes una membresía válida para solicitar este meet & greet."
  );
  return;
}

    setMeetGreetSubmitting(true);
    setMeetGreetError(null);

    try {
      const result = await createMeetGreetRequest({
        groupId,
        buyerMessage: meetGreetMessage.trim() || null,
        priceSnapshot: meetGreetPrice,
        durationMinutes: meetGreetDurationMinutes,
      });

      const successMessage = `✅ Meet & Greet solicitado correctamente. ID: ${result.requestId}`;

      setMeetGreetOpen(false);
      setMeetGreetMessage("");
      setServiceToast(successMessage);
      clearServiceQuery();

      window.setTimeout(() => {
        setServiceToast((current) =>
          current === successMessage ? null : current
        );
      }, 4000);
    } catch (e: any) {
      setMeetGreetError(
        e?.message ?? "No se pudo crear la solicitud de meet & greet."
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
    clearServiceQuery();
  }

  async function submitExclusiveSessionRequest() {
    if (!user) {
      redirectToLogin();
      return;
    }

    if (isOwner) {
      setExclusiveSessionError(
        "No puedes solicitar/comprar una sesión exclusiva en tu propia comunidad."
      );
      return;
    }

        if (!canRequestExclusiveSession) {
      setExclusiveSessionError(
        "No tienes una membresía válida para solicitar esta sesión exclusiva."
      );
      return;
    }
    setExclusiveSessionSubmitting(true);
    setExclusiveSessionError(null);

    try {
      const result = await createExclusiveSessionRequest({
        groupId,
        buyerMessage: exclusiveSessionMessage.trim() || null,
        priceSnapshot: exclusiveSessionPrice,
        durationMinutes: exclusiveSessionDurationMinutes,
      });

      const requestId =
        result && typeof result === "object" && "requestId" in result
          ? String((result as { requestId?: unknown }).requestId ?? "")
          : "";

      const successMessage = requestId
        ? `✅ Sesión exclusiva solicitada correctamente. ID: ${requestId}`
        : "✅ Sesión exclusiva solicitada correctamente.";

      setExclusiveSessionOpen(false);
      setExclusiveSessionMessage("");
      setServiceToast(successMessage);
      clearServiceQuery();

      window.setTimeout(() => {
        setServiceToast((current) =>
          current === successMessage ? null : current
        );
      }, 4000);
    } catch (e: any) {
      setExclusiveSessionError(
        e?.message ?? "No se pudo crear la solicitud de sesión exclusiva."
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
        setServiceToast(
          "No puedes solicitar este servicio dentro de tu propia comunidad."
        );
        clearServiceQuery();
        return;
      }

      if (!canRequestCreatorServices) {
  setServiceToast(
    "No tienes una membresía válida para solicitar este servicio."
  );
  clearServiceQuery();
  return;
}

      openGreetingForm(requestedService);
      return;
    }

    if (requestedService === "meet_greet_digital") {
      if (!user) {
        redirectToLogin();
        return;
      }

      if (isOwner) {
        setServiceToast(
          "No puedes solicitar/comprar un meet & greet en tu propia comunidad."
        );
        clearServiceQuery();
        return;
      }

      if (!canRequestCreatorServices) {
  setServiceToast(
    "No tienes una membresía válida para solicitar este servicio."
  );
  clearServiceQuery();
  return;
}
      openMeetGreetForm();
      return;
    }

    if (requestedService === "clase_personalizada") {
      if (!user) {
        redirectToLogin();
        return;
      }

      if (isOwner) {
        setServiceToast(
          "No puedes solicitar/comprar una sesión exclusiva en tu propia comunidad."
        );
        clearServiceQuery();
        return;
      }

      if (!canRequestCreatorServices) {
        setServiceToast(
          "No tienes una membresía válida para solicitar este servicio."
        );
        clearServiceQuery();
        return;
      }

      openExclusiveSessionForm();
      return;
    }
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
    } catch (e: any) {
      setActionError(e?.message ?? "❌ No se pudo leer la imagen.");
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
    (_croppedArea: unknown, croppedAreaPixelsArg: unknown) => {
      setCroppedAreaPixels(croppedAreaPixelsArg as GroupCropArea);
    },
    []
  );

  async function uploadCropped(mode: CropMode) {
    if (!group) return;
    if (!isOwner) return;
    if (!cropImageSrc || !croppedAreaPixels) {
      setActionError("❌ No se pudo recortar la imagen.");
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
    } catch (e: any) {
      setActionError(
        e?.code === "permission-denied"
          ? "❌ Permiso denegado. Revisa reglas de Storage/Firestore."
          : `❌ No se pudo subir la imagen: ${e?.message ?? "error"}`
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
      <main style={groupRoutePageWrap}>
        <div style={groupRouteContainer}>
          <div style={{ ...cardStyle, padding: 18 }}>
            <div style={textStyle}>Cargando comunidad...</div>
          </div>
        </div>
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

  if (groupIsDeleted) {
    return (
      <main style={groupRoutePageWrap}>
        <div style={groupRouteContainer}>
          <div style={{ ...cardStyle, padding: 18 }}>
            <div style={{ display: "grid", gap: 10 }}>
              <h1 style={{ ...titleStyle, margin: 0 }}>
                Comunidad no disponible
              </h1>

              <p style={{ ...textStyle, margin: 0 }}>
                Esta comunidad fue eliminada o desactivada por su owner.
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
                Volver a comunidades
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

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
    "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(255,255,255,0.016), inset 0 0 11px rgba(168,85,255,0.13), inset 0 0 18px rgba(168,85,255,0.085), inset 0 0 26px rgba(126,34,206,0.065), 0 0 7px rgba(168,85,255,0.05), 0 12px 24px rgba(0,0,0,0.5)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
};

const groupCoverAuraStyle = {
  position: "absolute" as const,
  inset: 0,
  zIndex: 8,
  pointerEvents: "none" as const,
  background:
    "radial-gradient(circle at 18% 10%, rgba(168,85,255,0.075), transparent 34%), radial-gradient(circle at 86% 18%, rgba(126,34,206,0.055), transparent 36%), radial-gradient(circle at 22% 92%, rgba(168,85,255,0.045), transparent 40%)",
  boxShadow:
    "inset 0 0 24px rgba(79,70,255,0.07), inset 0 0 20px rgba(168,85,255,0.065), inset 0 1px 0 rgba(255,255,255,0.05)",
};

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
          boxShadow: groupVisualUi.shadow,
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

            .group-card::before {
              content: "";
              position: absolute;
              inset: -42%;
              border-radius: inherit;
              pointer-events: none;
              background:
                radial-gradient(circle at 18% 10%, rgba(168, 85, 255, 0.075), transparent 34%),
                radial-gradient(circle at 86% 18%, rgba(126, 34, 206, 0.055), transparent 36%),
                radial-gradient(circle at 22% 92%, rgba(168, 85, 255, 0.045), transparent 40%);
              filter: blur(26px);
              opacity: 0.42;
              z-index: 0;
            }

            .group-card::after {
              content: "";
              position: absolute;
              inset: 0;
              pointer-events: none;
              border-radius: inherit;
              box-shadow:
                inset 0 0 24px rgba(79, 70, 255, 0.07),
                inset 0 0 20px rgba(168, 85, 255, 0.065),
                inset 0 1px 0 rgba(255, 255, 255, 0.05),
                0 0 18px rgba(168, 85, 255, 0.055);
              z-index: 1;
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

                <div style={groupCoverGradientStyle} />
                {canShareGroup && (
  <CopyLinkButton
    href={groupShareHref}
    copiedLabel="Link del grupo copiado correctamente"
    title="Copiar link del grupo"
    style={{
      ...groupRoundIconButtonStyle,
      position: "absolute",
      right: 18,
      top: 18,
      zIndex: 40,
    }}
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
        {formattedMemberCount} {memberCount === 1 ? "miembro" : "miembros"}
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
                      {isBanned &&
                        "🚫 Estás baneado de esta comunidad. No puedes ingresar."}

                      {!isBanned &&
                        hasLegacyAccess &&
                        "✅ Conservas acceso legado en esta comunidad. Recarga la vista si tu estado cambió hace un momento."}

                      {!isBanned &&
                        approved &&
                        "✅ Aprobado. Entrando…"}

                      {!isBanned &&
                        shouldShowSubscriptionRecovery &&
                        `Esta comunidad ahora requiere suscripción para recuperar o conservar acceso. ${
                          subscriptionPrice != null
                            ? `Costo mensual: ${formatMoney(
                                subscriptionPrice,
                                subscriptionCurrency
                              )}.`
                            : "Costo mensual disponible dentro del panel de suscripción."
                        }`}

                      {!isBanned &&
                        !shouldShowSubscriptionRecovery &&
                        isSubscriptionGroup &&
                        `Esta comunidad requiere suscripción para entrar. ${
                          subscriptionPrice != null
                            ? `Costo mensual: ${formatMoney(
                                subscriptionPrice,
                                subscriptionCurrency
                              )}.`
                            : "Costo mensual disponible dentro del panel de suscripción."
                        }`}

                      {!isBanned &&
                        removedBySubscriptionTransition &&
                        !subscriptionEnabled &&
                        "Tu acceso anterior fue retirado durante un cambio de modelo de acceso. En este momento ya no perteneces a la comunidad."}

                      {!isBanned &&
                        !shouldShowSubscriptionRecovery &&
                        !removedBySubscriptionTransition &&
                        !isSubscriptionGroup &&
                        isPrivate &&
                        pending &&
                        "✅ Solicitud enviada. Está pendiente de revisión."}

                      {!isBanned &&
                        !shouldShowSubscriptionRecovery &&
                        !removedBySubscriptionTransition &&
                        !isSubscriptionGroup &&
                        isPrivate &&
                        !pending &&
                        !approved &&
                        !rejected &&
                        "Esta comunidad es privada. Puedes verla, pero necesitas aprobación para entrar."}

                      {!isBanned &&
                        !shouldShowSubscriptionRecovery &&
                        !removedBySubscriptionTransition &&
                        !isSubscriptionGroup &&
                        isPrivate &&
                        rejected &&
                        "❌ Tu solicitud fue rechazada."}

                      {!isBanned &&
                        !shouldShowSubscriptionRecovery &&
                        !removedBySubscriptionTransition &&
                        !isSubscriptionGroup &&
                        isHidden &&
                        "Esta comunidad es oculta. No tienes acceso en este momento."}
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
                              opacity: joining ? 0.75 : 1,
                              cursor: joining ? "not-allowed" : "pointer",
                            }}
                          >
                            {user ? "Suscribirme" : "Iniciar sesión para suscribirme"}
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

          {!isBanned && (
            <div style={{ paddingTop: 16, width: "100%" }}>
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
              />
            </div>
          )}
          </div>

        </main>

        <GroupServiceModals
          greetOpen={false}
          greetSubmitting={greetSubmitting}
          greetType={greetType}
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
          subscriptionOpen={subscriptionOpen}
          subscriptionSubmitting={subscriptionSubmitting}
          subscriptionError={subscriptionError}
          subscriptionPrice={subscriptionPrice}
          subscriptionCurrencyLabel={subscriptionCurrency}
          onCloseSubscription={closeSubscriptionModal}
          onSubmitSubscription={handleSubscriptionCheckout}
          meetGreetOpen={false}
          meetGreetSubmitting={meetGreetSubmitting}
          meetGreetMessage={meetGreetMessage}
          meetGreetError={meetGreetError}
          meetGreetPriceLabel={
            meetGreetPrice != null
              ? formatMoney(meetGreetPrice, meetGreetCurrency)
              : "Por definir"
          }
          meetGreetDurationLabel={
            meetGreetDurationMinutes != null
              ? `${meetGreetDurationMinutes} minutos`
              : "Por definir"
          }
          onCloseMeetGreet={closeMeetGreetForm}
          onSubmitMeetGreet={submitMeetGreetRequest}
          onChangeMeetGreetMessage={setMeetGreetMessage}
          exclusiveSessionOpen={false}
          exclusiveSessionSubmitting={exclusiveSessionSubmitting}
          exclusiveSessionMessage={exclusiveSessionMessage}
          exclusiveSessionError={exclusiveSessionError}
          exclusiveSessionPriceLabel={
            exclusiveSessionPrice != null
              ? formatMoney(exclusiveSessionPrice, exclusiveSessionCurrency)
              : "Por definir"
          }
          exclusiveSessionDurationLabel={
            exclusiveSessionDurationMinutes != null
              ? `${exclusiveSessionDurationMinutes} minutos`
              : "Por definir"
          }
          onCloseExclusiveSession={closeExclusiveSessionForm}
          onSubmitExclusiveSession={submitExclusiveSessionRequest}
          onChangeExclusiveSessionMessage={setExclusiveSessionMessage}
          serviceToast={serviceToast}
          subtitleStyle={subtitleStyle}
          textStyle={textStyle}
          microText={microText}
          labelStyle={labelStyle}
          primaryButton={primaryButton}
          secondaryButton={secondaryButton}
          panelStyle={panelStyle}
          inputStyle={inputStyle}
          messageBox={messageBox}
          serviceModalBackdropStyle={serviceModalBackdropStyle}
          serviceModalCardStyle={serviceModalCardStyle}
          serviceToastStyle={serviceToastStyle}
          formatMoney={formatMoney}
        />
      </>
    );
  }

  const isPublicGroup = group.visibility === "public";
  const canViewPublicFeed = isPublicGroup || effectiveIsMember || isOwner;

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

          .group-card::before {
            content: "";
            position: absolute;
            inset: -42%;
            border-radius: inherit;
            pointer-events: none;
            background:
              radial-gradient(circle at 18% 10%, rgba(168, 85, 255, 0.075), transparent 34%),
              radial-gradient(circle at 86% 18%, rgba(126, 34, 206, 0.055), transparent 36%),
              radial-gradient(circle at 22% 92%, rgba(168, 85, 255, 0.045), transparent 40%);
            filter: blur(26px);
            opacity: 0.42;
            z-index: 0;
          }

          .group-card::after {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            border-radius: inherit;
            box-shadow:
              inset 0 0 24px rgba(79, 70, 255, 0.07),
              inset 0 0 20px rgba(168, 85, 255, 0.065),
              inset 0 1px 0 rgba(255, 255, 255, 0.05),
              0 0 18px rgba(168, 85, 255, 0.055);
            z-index: 1;
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
    padding: 0 12px 18px;
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

<div style={groupCoverAuraStyle} />
<div style={groupCoverGradientStyle} />

              {canShareGroup && (
  <CopyLinkButton
    href={groupShareHref}
    copiedLabel="Link del grupo copiado correctamente"
    title="Copiar link del grupo"
    style={{
      ...groupRoundIconButtonStyle,
      position: "absolute",
      right: 18,
      top: 18,
      zIndex: 40,
    }}
  />
)}

              <DonationEntryPoint
  donation={groupIsPaused ? null : normalizedCurrentDonation}
  isLoggedIn={!!user}
  onRequireLogin={redirectToLogin}
  viewerCanDonate={!isOwner && !groupIsPaused}
  videoEnabled={false}
  videoUrl={null}
  buttonStyle={coverDonationButton}
  onDonateIntent={(payload) => {
    console.log("donation_intent", payload);
  }}
/>

              {isOwner && (
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
                  title="Elegir portada"
                  aria-label="Elegir portada"
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
        {formattedMemberCount} {memberCount === 1 ? "miembro" : "miembros"}
      </span>
    </>
  )}
</div>

                  {canRequestCreatorServices &&
  normalizedCurrentOfferings.length > 0 && (
    <div className="group-services-wrap">
      <CreatorServicesMenu
        services={normalizedCurrentOfferings}
        contextType="group"
        groupId={groupId}
        viewerMembershipStatus={isOwner ? "active" : memberStatus}
        viewerCanRequest={canRequestCreatorServices}
      />
    </div>
  )}
                </div>
              </div>

              <div className="group-actions-wrap">
                <div className="group-actions-row">
                  {!isOwner && !effectiveIsMember && group.visibility === "public" && (
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
              </div>
            </div>
          </section>

                    {groupIsPaused && (
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
                Comunidad pausada. No podrás publicar ni comentar mientras esté pausada.
              </div>
            </div>
          )}

          <GroupStoryCircles
            groupId={groupId}
            canView={canViewPublicFeed}
            currentUserId={user?.uid ?? null}
            isOwner={isOwner}
          />

          {effectiveIsMember && (
            <div className="group-subnav-wrap" style={{ marginTop: 12 }}>
              <GroupSubnav
                activeTab={activeTab}
                onChange={setActiveTab}
                canManage={isOwner}
              />
            </div>
          )}

          <div className="group-tab-content" style={{ width: "100%", minWidth: 0 }}>
            {canViewPublicFeed && activeTab === "feed" && (
              <section className="group-tab-panel group-feed-wrap" style={{ marginTop: 12 }}>
                <div className="group-feed-item">
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
              <div className="group-tab-panel" style={{ marginTop: 12 }}>
                <GroupMembersTab
                  groupId={groupId}
                  isOwner={isOwner}
                  isModerator={isModerator}
                  canMembersViewList={canMembersViewList}
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

      <GroupServiceModals
        greetOpen={greetOpen}
        greetSubmitting={greetSubmitting}
        greetType={greetType}
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
        subscriptionOpen={subscriptionOpen}
        subscriptionSubmitting={subscriptionSubmitting}
        subscriptionError={subscriptionError}
        subscriptionPrice={subscriptionPrice}
        subscriptionCurrencyLabel={subscriptionCurrency}
        onCloseSubscription={closeSubscriptionModal}
        onSubmitSubscription={handleSubscriptionCheckout}
        meetGreetOpen={meetGreetOpen}
        meetGreetSubmitting={meetGreetSubmitting}
        meetGreetMessage={meetGreetMessage}
        meetGreetError={meetGreetError}
        meetGreetPriceLabel={
          meetGreetPrice != null
            ? formatMoney(meetGreetPrice, meetGreetCurrency)
            : "Por definir"
        }
        meetGreetDurationLabel={
          meetGreetDurationMinutes != null
            ? `${meetGreetDurationMinutes} minutos`
            : "Por definir"
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
            : "Por definir"
        }
        exclusiveSessionDurationLabel={
          exclusiveSessionDurationMinutes != null
            ? `${exclusiveSessionDurationMinutes} minutos`
            : "Por definir"
        }
        onCloseExclusiveSession={closeExclusiveSessionForm}
        onSubmitExclusiveSession={submitExclusiveSessionRequest}
        onChangeExclusiveSessionMessage={setExclusiveSessionMessage}
        serviceToast={serviceToast}
        subtitleStyle={subtitleStyle}
        textStyle={textStyle}
        microText={microText}
        labelStyle={labelStyle}
        primaryButton={primaryButton}
        secondaryButton={secondaryButton}
        panelStyle={panelStyle}
        inputStyle={inputStyle}
        messageBox={messageBox}
        serviceModalBackdropStyle={serviceModalBackdropStyle}
        serviceModalCardStyle={serviceModalCardStyle}
        serviceToastStyle={serviceToastStyle}
        formatMoney={formatMoney}
      />

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
    </>
  );
}