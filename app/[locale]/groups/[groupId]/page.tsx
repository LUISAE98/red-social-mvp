"use client";

import Image from "next/image";
import CreatorServiceModals from "@/components/services/CreatorServiceModals";
import GroupImageCropModal from "./components/GroupImageCropModal";
import OwnerAdminServices from "./components/owner-admin-panel/OwnerAdminServices";

import { collection, doc, getCountFromServer, onSnapshot, updateDoc } from "firebase/firestore";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
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
import { useScreenReady } from "@/lib/useScreenReady";
import {
  joinGroup,
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
import InviteLinkModal from "@/app/components/OwnerSidebar/InviteLinkModal";
import InviteLinksList from "@/app/components/OwnerSidebar/InviteLinksList";
import {
  createGreetingRequest,
  type GreetingType,
} from "@/lib/greetings/greetingRequests";
import StripePaymentModal from "@/components/payments/StripePaymentModal";
import PaymentSuccessCard from "@/components/payments/PaymentSuccessCard";
import { createGreetingStripeIntent, createServiceStripeIntent, createGroupSubscription, cancelGroupSubscriptionStripe } from "@/lib/stripe/stripePayments";
import { FIXED_SERVICE_FEE_USD, SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast, type ToastType } from "@/lib/hooks/useVibraToast";
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
  GROUP_AVATAR_MAX_PX,
  GROUP_COVER_MAX_PX,
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
} from "@/lib/groups/groupAdapters";
import StatsRow, { type StatItem } from "@/components/ui/StatsRow";
import EditTextButton, { avatarEditButtonStyle } from "@/components/ui/EditTextButton";
import { capitalizeFirst } from "@/i18n/locales";
import { fetchGroupPostsCount } from "@/lib/posts/post-service";

import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import TaxNote from "@/components/payments/TaxNote";
import { useGroupRealtime } from "@/lib/groups/useGroupRealtime";
import { setGroupVisibility } from "@/lib/groups/setGroupVisibility";
import { useLiveRingState } from "@/lib/live/useLiveRingState";
import { setLastVisitTimestamp } from "@/lib/utils/visitTimestamps";
import { useSetMobileHeader } from "@/app/contexts/MobileHeaderContext";
import { buildCurrentPathWithSearch } from "@/lib/auth-redirect";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";
import RefreshableArea from "@/components/refresh/RefreshableArea";
// Mismo skeleton de encabezado que el perfil: el componente ya se escribió para
// ambos (portada + avatar + nombre + datos + botón + historias + cards).
import ProfileHeaderSkeleton from "@/components/profile/ProfileHeaderSkeleton";
import { Button, Modal, TextButton } from "@/components/ui";
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
    priceFmt.format(value, { baseCurrency: currency ?? SETTLEMENT_CURRENCY, code: true });
  // Igual que formatMoney pero con IVA INCLUIDO (total según país del comprador). Para
  // los labels de "Continuar al pago" de los paneles de solicitud (la pasarela sigue
  // recibiendo el monto base aparte y calcula su propio desglose).
  const formatMoneyWithTax = (value: number, currency?: string) =>
    priceFmt.formatWithTax(value, { baseCurrency: currency ?? SETTLEMENT_CURRENCY, code: true }).total;

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
// El color viaja con el texto: si no, un aviso rojo posterior heredaría el
// gris del anterior.
const [actionErrorTono, setActionErrorTono] = useState<ToastType>("error");

/** Avisa en rojo, o en gris cuando no es un fallo sino un estado. */
const avisarAccion = (texto: string | null, tono: ToastType = "error") => {
  setActionErrorTono(tono);
  setActionError(texto);
};
const [leaveOverlayOpen, setLeaveOverlayOpen] = useState(false);
const [leaving, setLeaving] = useState(false);
// Estado de MI suscripción a esta comunidad (preapproval MP): fecha de acceso y
// si ya está cancelada. Alimenta el botón "Suscrito hasta {fecha}" + cancelar.
const [mySub, setMySub] = useState<{ accessUntil: Date | null; status: string; cancelAtPeriodEnd: boolean } | null>(null);
const [cancelSubOpen, setCancelSubOpen] = useState(false);
const [cancellingSub, setCancellingSub] = useState(false);

useEffect(() => {
  if (!user?.uid) { setMySub(null); return; }
  const ref = doc(db, "groupSubscriptions", `${groupId}_${user.uid}`);
  const unsub = onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) { setMySub(null); return; }
      const d = snap.data();
      const au = (d.accessUntil && typeof d.accessUntil.toDate === "function") ? d.accessUntil.toDate() as Date : null;
      setMySub({ accessUntil: au, status: String(d.status ?? ""), cancelAtPeriodEnd: d.cancelAtPeriodEnd === true });
    },
    () => setMySub(null)
  );
  return () => unsub();
}, [user?.uid, groupId]);

const formatSubDate = (d: Date) =>
  d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
const [leaveError, setLeaveError] = useState<string | null>(null);
const [mobileRefreshEnabled, setMobileRefreshEnabled] = useState(false);
const [groupPageRefreshKey, setGroupPageRefreshKey] = useState(0);
// Avisa al splash de arranque que la pantalla de comunidad ya está montada.
useScreenReady();
  const [memberCount, setMemberCount] = useState<number | null>(null);

  // Igual que las publicaciones: el numero guardado manda. Enumerar la
  // subcoleccion de miembros respeta `membersListVisibility`, asi que con la
  // lista cerrada —el valor por omision— la cuenta fallaba y el card enseñaba un
  // guion. Lo mantiene el servidor (backend/src/entityCounters.ts).
  const memberCountFromDoc =
    typeof group?.membersCount === "number" && group.membersCount >= 0
      ? group.membersCount
      : null;

useEffect(() => {
  let cancelled = false;

  async function loadMemberCount() {
    if (!groupId || memberCountFromDoc !== null) return;

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
}, [groupId, groupPageRefreshKey, memberCountFromDoc]);

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

const memberCountShown = memberCountFromDoc ?? memberCount;

const formattedMemberCount = useMemo(() => {
  if (memberCountShown == null) return null;

  return new Intl.NumberFormat(locale).format(memberCountShown);
}, [memberCountShown, locale]);

  const error = actionError ?? realtimeError;

  // Los avisos de RESULTADO de una acción salen por el toast. Las condiciones
  // permanentes de la pantalla (baneado, comunidad pausada) siguen fijas.
  const { toast, showToast } = useVibraToast();
  // Solo el resultado de una acción. El fallo de carga ya tiene su propia
  // pantalla más abajo; sacarlo también por el toast lo decía dos veces.
  useEffect(() => { if (actionError) showToast(actionError, actionErrorTono); }, [actionError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (leaveError) showToast(leaveError, "error"); }, [leaveError]); // eslint-disable-line react-hooks/exhaustive-deps

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

// Publicaciones de la comunidad, para el card de la portada. Solo se pide donde
// el feed puede leer: dentro de una comunidad pública, o siendo miembro o dueño
// de una privada u oculta. Fuera de eso las reglas lo niegan a propósito y el
// card enseña un guion en vez de un cero, que se leería como "no hay nada".
const [groupPostsCount, setGroupPostsCount] = useState<number | null>(null);

// El numero guardado en el documento de la comunidad manda: es lo que hace que
// el dato se vea desde fuera. Contar los posts reales exige poder LEERLOS, y a
// un no-miembro de una privada u oculta las reglas se lo niegan. Lo mantiene el
// servidor (backend/src/entityCounters.ts).
const groupPostsCountFromDoc =
  typeof group?.postsCount === "number" && group.postsCount >= 0
    ? group.postsCount
    : null;

const canCountGroupPosts =
  !!groupId &&
  groupPostsCountFromDoc === null &&
  (effectiveIsMember || group?.visibility === "public");

useEffect(() => {
  if (!canCountGroupPosts) {
    setGroupPostsCount(null);
    return;
  }

  let cancelled = false;

  fetchGroupPostsCount(groupId)
    .then((count) => {
      if (!cancelled) setGroupPostsCount(count);
    })
    .catch(() => {
      if (!cancelled) setGroupPostsCount(null);
    });

  return () => {
    cancelled = true;
  };
}, [canCountGroupPosts, groupId, groupPageRefreshKey]);

const groupPostsCountShown = groupPostsCountFromDoc ?? groupPostsCount;
const formattedGroupPostsCount =
  groupPostsCountShown === null
    ? "—"
    : new Intl.NumberFormat(locale).format(groupPostsCountShown);

// Ventas hechas dentro de esta comunidad. Lo lleva el ledger en el backend; el
// cliente solo lo lee del documento de la comunidad.
const groupExperiencesCount = (() => {
  const raw = (group as { experiencesCount?: unknown } | null)?.experiencesCount;
  return typeof raw === "number" && raw > 0 ? raw : 0;
})();

/**
 * Los tres datos de la portada. Se arman aquí una sola vez porque la pantalla
 * tiene dos renders distintos —el de dentro y el de la antesala de una
 * comunidad cerrada— y en los dos va la misma fila.
 *
 * El tipo de comunidad va en una sola línea: la palabra "Comunidad" encima no
 * decía nada que no dijera ya la pantalla entera.
 */
const groupStatsItems: StatItem[] = [
  // La fila SIEMPRE lleva tres datos. El primer hueco es el que cambia: hasta la
  // primera venta muestra si la comunidad es pública o privada, y a partir de ahí
  // lo cede a las experiencias, que dicen más de lo que ocurre dentro.
  groupExperiencesCount > 0
    ? {
        key: "experiences",
        top: new Intl.NumberFormat(locale).format(groupExperiencesCount),
        bottom: capitalizeFirst(
          groupExperiencesCount === 1
            ? tCommon("experience")
            : tCommon("experiences"),
          locale
        ),
      }
    : {
        key: "visibility",
        top:
          group?.visibility === "public"
            ? tGroups("publicLabel")
            : group?.visibility === "private"
              ? tGroups("privateLabel")
              : group?.visibility === "hidden"
                ? tGroups("hiddenLabel")
                : "",
        paired: true,
      },
  {
    key: "members",
    top: formattedMemberCount ?? "—",
    bottom: capitalizeFirst(
      memberCountShown === 1 ? tCommon("member") : tCommon("members"),
      locale
    ),
  },
  {
    key: "posts",
    top: formattedGroupPostsCount,
    bottom: capitalizeFirst(
      groupPostsCountShown === 1 ? tCommon("publication") : tCommon("publications"),
      locale
    ),
  },
];

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
      normalizeCurrency(group.monetization?.currency) ?? SETTLEMENT_CURRENCY
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
    return meetGreetOffering?.currency ?? subscriptionCurrency ?? SETTLEMENT_CURRENCY;
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
    return exclusiveSessionOffering?.currency ?? subscriptionCurrency ?? SETTLEMENT_CURRENCY;
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

  const [meetGreetOpen, setMeetGreetOpen] = useState(false);
  const [meetGreetMessage, setMeetGreetMessage] = useState("");
  const [meetGreetSubmitting, setMeetGreetSubmitting] = useState(false);
  const [meetGreetError, setMeetGreetError] = useState<string | null>(null);

  const [exclusiveSessionOpen, setExclusiveSessionOpen] = useState(false);
  const [exclusiveSessionMessage, setExclusiveSessionMessage] = useState("");
  const [exclusiveSessionSubmitting, setExclusiveSessionSubmitting] = useState(false);
  const [exclusiveSessionError, setExclusiveSessionError] = useState<string | null>(null);

  const [isRetry, setIsRetry] = useState(false);
// Reintento: cobra en un clic con la tarjeta guardada al abrir la pasarela (sin que el
// usuario la toque). Se captura al enviar y se resetea al cerrar la pasarela.
const [autoConfirmPay, setAutoConfirmPay] = useState(false);

  const greetOffering = useMemo(() => {
    return normalizedCurrentOfferings.find((o) => o.type === greetType) ?? null;
  }, [normalizedCurrentOfferings, greetType]);

  const greetPriceLabel = useMemo(() => {
    const price = greetOffering?.memberPrice ?? greetOffering?.publicPrice ?? (greetOffering as { price?: number } | null)?.price ?? null;
    const currency = greetOffering?.currency ?? SETTLEMENT_CURRENCY;
    // Total todo-incluido (base + cargo fijo + impuesto del país) para el botón "Continuar al pago".
    return typeof price === "number" ? formatMoneyWithTax(price + FIXED_SERVICE_FEE_USD, currency) : undefined;
  }, [greetOffering]);

  const [serviceToast, setServiceToast] = useState<string | null>(null);

  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [subscriptionSubmitting, setSubscriptionSubmitting] = useState(false);
  // Pasarela de pago real de la suscripción (Stripe Subscriptions).
  const [subscriptionPayOpen, setSubscriptionPayOpen] = useState(false);
  // Éxito de la suscripción, controlado por estado de PÁGINA (no por el `showSuccess`
  // interno del modal). El pago concede la membresía vía webhook → el componente cambia
  // de rama (no-miembro → miembro) y remonta el gateway; si el éxito viviera dentro del
  // modal se perdería y reaparecería el formulario. Con esta bandera el panel verde
  // sobrevive al cambio de rama.
  const [subscriptionPaid, setSubscriptionPaid] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

  const [groupDonationViewerOpen, setGroupDonationViewerOpen] = useState(false);
  // Modal para crear/mostrar el enlace de invitación (solo owner de comunidad oculta).
  const [inviteOpen, setInviteOpen] = useState(false);
  // Se incrementa al crear un link para forzar el re-fetch de la lista del dueño.
  const [inviteRefreshKey, setInviteRefreshKey] = useState(0);

  const [activeTab, setActiveTab] = useState<GroupTabKey>("feed");
  // Sub-pestaña de media del feed (Publicaciones/Fotos/Videos/En vivo) reportada
  // por GroupPostsFeed; se usa para ocultar el rail de recomendaciones fuera de
  // "Publicaciones".
  const [feedMediaTab, setFeedMediaTab] = useState<string>("feed");
  // Deep-link `?requests=1` desde la notificación de solicitud de unión: abre la
  // lista de solicitudes dentro de Integrantes.
  const [requestsDeepLinkOpen, setRequestsDeepLinkOpen] = useState(false);
  // Deep-link `?assignModerator=1` desde la notificación de invitación RECHAZADA:
  // abre el buscador de moderadores para proponerle el puesto a alguien más.
  const [assignModeratorDeepLinkOpen, setAssignModeratorDeepLinkOpen] =
    useState(false);

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

  // Quien NO administra salta a los integrantes con un texto morado, y vuelve
  // con su pareja. Las dos direcciones dependen de lo mismo: que la seccion
  // exista para esa persona (ser miembro) y que la comunidad tenga la lista
  // abierta a sus miembros, salvo que sea moderador, que la ve igualmente.
  const visitorCanJumpToMembers =
    !isOwner &&
    (effectiveIsMember || isEmbed) &&
    (canMembersViewList || isModerator);

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

  // "Suscribirme" abre DIRECTO la pasarela de pago real (sin paso de confirmación).
  function openSubscriptionModal() {
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
    setSubscriptionError(null);
    setServiceToast(null);
    setSubscriptionPayOpen(true);
  }

  function closeSubscriptionModal() {
    if (subscriptionSubmitting) return;
    setSubscriptionOpen(false);
    setSubscriptionError(null);
    clearServiceQuery();
  }

  // Del modal de confirmación pasa a la PASARELA de pago real (preapproval MP).
  // El cobro y la activación de la membresía los hace el backend; aquí solo se
  // abre la pasarela que tokeniza la tarjeta.
  function handleSubscriptionCheckout() {
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
    setSubscriptionError(null);
    avisarAccion(null);
    setSubscriptionOpen(false);
    setSubscriptionPayOpen(true);
  }

  // Pasarela de suscripción MENSUAL con STRIPE (Subscriptions nativas). Se monta TANTO en
  // el landing restringido (no-miembros) COMO en el render principal (ramas mutuamente
  // excluyentes). El callable crea la Subscription; el webhook (invoice.paid) concede la
  // membresía y registra el earning por cada cobro. `amount` = base + cargo fijo → la pasarela
  // muestra el total mensual (base + cargo fijo) × impuesto del país. Para comunidades ocultas el flujo es por invite.
  const subscriptionGateway = (
    <>
      <StripePaymentModal
        open={subscriptionPayOpen}
        amount={subscriptionPrice != null ? subscriptionPrice + FIXED_SERVICE_FEE_USD : null}
        amountCurrency={SETTLEMENT_CURRENCY}
        pricePeriodLabel="mes"
        allowCredit={false}
        createIntent={(args) => createGroupSubscription({
          groupId,
          taxCountry: args.taxCountry,
          savedPaymentMethodId: args.savedPaymentMethodId,
        })}
        productType={tGroups("subscriptionProductType")}
        providerName={group?.name}
        avatarUrl={group?.avatarUrl ?? null}
        payButtonLabel={tGroups("subscribeAction")}
        description={tGroups("subscribeGatewayDescription", { name: group?.name ?? tServices("creatorFallback") })}
        onClose={() => setSubscriptionPayOpen(false)}
        onPaid={() => {
          registrarCompraGeo({
            creatorId: group?.ownerId,
            serviceType: "subscription",
            grossAmount: subscriptionPrice ?? undefined,
          });
          // Cerrar el formulario y mostrar el éxito con estado de PÁGINA: así el panel verde
          // sobrevive al cambio de rama (no-miembro → miembro) que dispara el webhook.
          setSubscriptionPayOpen(false);
          setSubscriptionPaid(true);
        }}
      />
      {subscriptionPaid && typeof window !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSubscriptionPaid(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 2147483647, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(0,0,0,0.55)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "relative", width: "min(100%, 440px)", maxHeight: "92vh", overflowY: "auto", background: "#fff", borderRadius: 16, boxShadow: "0 24px 72px rgba(0,0,0,0.4)", color: "#3a3f4a" }}
          >
            <PaymentSuccessCard
              avatarUrl={group?.avatarUrl ?? null}
              providerName={group?.name}
              productType={tGroups("subscriptionProductType")}
              successMessage={tGroups("subscriptionProcessed")}
              onClose={() => setSubscriptionPaid(false)}
              locale={locale}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );

  async function handleJoinPublic() {
    if (!user) {
      redirectToLogin();
      return;
    }

    if (groupIsPausedForAccess) {
      avisarAccion(tGroups("communityPaused"), "warning");
      return;
    }

    setJoining(true);
    avisarAccion(null);

    try {
      await joinGroup(groupId, user.uid);
    } catch (e: unknown) {
      avisarAccion((e instanceof Error ? e.message : null) ?? tGroups("joinError"));
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

  // Cancela la suscripción (preapproval MP). Conserva acceso hasta fin del periodo;
  // la baja real la aplica el job programado cuando `accessUntil` vence.
  async function handleCancelSubscription() {
    if (!user || cancellingSub) return;
    setCancellingSub(true);
    avisarAccion(null);
    try {
      await cancelGroupSubscriptionStripe(groupId);
      setCancelSubOpen(false);
      const until = mySub?.accessUntil ? formatSubDate(mySub.accessUntil) : "";
      const msg = tGroups("cancelSubscriptionDone", { date: until });
      setServiceToast(msg);
      window.setTimeout(() => {
        setServiceToast((current) => (current === msg ? null : current));
      }, 5000);
    } catch (e: unknown) {
      avisarAccion((e instanceof Error ? e.message : null) ?? tGroups("cancelSubscriptionError"));
    } finally {
      setCancellingSub(false);
    }
  }

  async function handleRequestPrivate() {
    if (!user) {
      redirectToLogin();
      return;
    }

        if (groupIsPausedForAccess) {
      avisarAccion(tGroups("communityPaused"), "warning");
      return;
    }

    setJoining(true);
    avisarAccion(null);

    try {
      await requestToJoin(groupId, user.uid);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : null;
      if (errMsg === "GROUP_REQUIRES_SUBSCRIPTION") {
        openSubscriptionModal();
        return;
      }

      avisarAccion(errMsg ?? tGroups("requestError"));
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
    avisarAccion(null);

    try {
      await cancelJoinRequest(groupId, user.uid);
    } catch (e: unknown) {
      avisarAccion((e instanceof Error ? e.message : null) ?? tGroups("cancelRequestError"));
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
      const res = await createGreetingRequest({
        groupId,
        type: greetType,
        toName: toName.trim(),
        instructions: instructions.trim(),
        source: "group",
        allowCreatorStory,
      });

      // Saludo en awaiting_payment → abrir el segundo modal (Brick) para cobrar.
      const amount =
        res.priceSnapshot ??
        greetOffering?.memberPrice ??
        greetOffering?.publicPrice ??
        null;

      setGreetOpen(false);
      setToName("");
      setInstructions("");
      setGreetSuccess(null);
      clearServiceQuery();
      setPayGreetId(res.requestId);
      setPayGreetAmount(amount);
      setPayGreetLabel(greetPriceLabel);
      setAutoConfirmPay(isRetry); // reintento → cobro un-clic con tarjeta guardada
      setPayGreetOpen(true);
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
      setMeetGreetError(tGroups("ownCommunityService"));
      return;
    }

    if (!canRequestMeetGreet) {
      setMeetGreetError(tGroups("noValidMembershipMeetGreet"));
      return;
    }

    setMeetGreetSubmitting(true);
    setMeetGreetError(null);

    try {
      const res = (await createMeetGreetRequest({
        groupId,
        buyerMessage: meetGreetMessage.trim() || null,
        priceSnapshot: meetGreetPrice,
        durationMinutes: meetGreetDurationMinutes,
      })) as { requestId: string; priceSnapshot?: number | null };

      // Solicitud en awaiting_payment → abrir el segundo modal (Brick) para cobrar.
      const amount = res.priceSnapshot ?? meetGreetPrice ?? null;

      setMeetGreetOpen(false);
      setMeetGreetMessage("");
      clearServiceQuery();
      setPayMeetId(res.requestId);
      setPayMeetAmount(amount);
      setPayMeetLabel(
        typeof amount === "number" ? formatMoney(amount, meetGreetCurrency) : undefined
      );
      setPayMeetDuration(meetGreetDurationMinutes ?? null);
      setAutoConfirmPay(isRetry); // reintento → cobro un-clic con tarjeta guardada
      setPayMeetOpen(true);
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
      setExclusiveSessionError(tGroups("ownCommunityService"));
      return;
    }

    if (!canRequestExclusiveSession) {
      setExclusiveSessionError(tGroups("noValidMembershipSession"));
      return;
    }
    setExclusiveSessionSubmitting(true);
    setExclusiveSessionError(null);

    try {
      const res = (await createExclusiveSessionRequest({
        groupId,
        buyerMessage: exclusiveSessionMessage.trim() || null,
        priceSnapshot: exclusiveSessionPrice,
        durationMinutes: exclusiveSessionDurationMinutes,
      })) as { requestId: string; priceSnapshot?: number | null };

      // Sesión en awaiting_payment → abrir el segundo modal (Brick) para cobrar.
      const amount = res.priceSnapshot ?? exclusiveSessionPrice ?? null;

      setExclusiveSessionOpen(false);
      setExclusiveSessionMessage("");
      clearServiceQuery();
      setPaySessionId(res.requestId);
      setPaySessionAmount(amount);
      setPaySessionLabel(
        typeof amount === "number" ? formatMoney(amount, exclusiveSessionCurrency) : undefined
      );
      setPaySessionDuration(exclusiveSessionDurationMinutes ?? null);
      setAutoConfirmPay(isRetry); // reintento → cobro un-clic con tarjeta guardada
      setPaySessionOpen(true);
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
        setServiceToast(tGroups("ownCommunityService"));
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
        setServiceToast(tGroups("ownCommunityService"));
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

  // Deep-link desde la notificación de invitación a moderar RECHAZADA: abre
  // Integrantes con el buscador de moderadores ya desplegado. Solo el dueño.
  useEffect(() => {
    if (!user || !isOwner) return;
    if (searchParams.get("assignModerator") !== "1") return;
    setActiveTab("members");
    setAssignModeratorDeepLinkOpen(true);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("assignModerator");
    const nextHref = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname;
    router.replace(nextHref, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isOwner, searchParams]);

  // Deep-link `?tab=members` desde la notificación de nuevo miembro: abre la
  // pestaña Integrantes (la lista de miembros).
  useEffect(() => {
    if (!user) return;
    if (searchParams.get("tab") !== "members") return;
    setActiveTab("members");
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("tab");
    const nextHref = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname;
    router.replace(nextHref, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, searchParams]);

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

    avisarAccion(null);

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
      avisarAccion((e instanceof Error ? e.message : null) ?? `${tCommon("imageReadError")}`);
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
      avisarAccion(`${tCommon("cropError")}`);
      return;
    }

    setUploading(true);
    avisarAccion(null);

    try {
      const blob = await getCroppedBlob(
        cropImageSrc,
        croppedAreaPixels,
        "image/jpeg",
        mode === "avatar" ? GROUP_AVATAR_MAX_PX : GROUP_COVER_MAX_PX
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
      avisarAccion(
        err?.code === "permission-denied"
          ? `${tCommon("storagePermissionError")}`
          : `${tCommon("imageUploadError")}: ${err?.message ?? "error"}`
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
    // Sin spinner: el mismo skeleton de encabezado que el perfil (portada, avatar,
    // nombre, datos, descripción, botón, historias y cards de servicios). Al llegar
    // los datos, el contenido real entra con fade (ver .group-card en el styled-jsx
    // del render principal), igual que .profile-card en ProfileClient.
    return (
      <main
        style={{
          minHeight: "100dvh",
          background: "#000",
          fontFamily: groupPageFontStack,
        }}
      >
        <ProfileHeaderSkeleton maxWidth={groupPageUi.pageMaxWidth} />
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
          {formatDeletedAt(groupDeletionState.deletedAt, locale)}
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
  liveDotOuter: mobileRefreshEnabled ? "clamp(18px, 3.8vw, 30px)" : "clamp(14px, 2.8vw, 24px)",
  liveDotInner: mobileRefreshEnabled ? "clamp(10px, 2.1vw, 16px)" : "clamp(8px, 1.6vw, 13px)",
  liveDotShell: mobileRefreshEnabled ? "clamp(22px, 4.8vw, 34px)" : "clamp(18px, 3.6vw, 28px)",
};

/**
 * Hueco que queda bajo el avatar antes de que empiece el nombre.
 *
 * Solo hace falta cuando la comunidad es TUYA: ahí, colgando del avatar, va el
 * "Editar" en posición absoluta, y si nadie le reserva sitio cae encima del
 * título. La hoja de estilos tenía escritos a mano los 22px del visitante en
 * las dos ramas, así que al dueño le faltaban justo los que ocupa ese texto.
 *
 * Va como variable y no como `paddingTop` en línea para que el punto de corte
 * siga decidiéndolo el CSS: `mobileRefreshEnabled` arranca en `false` y se
 * ajusta en un efecto, así que un valor calculado en JS pintaría el móvil con
 * la medida de laptop hasta que hidrata.
 *
 * Mismos números que el perfil (ver `avatarBottomReserve` en ProfileClient).
 */
const avatarReserveVars = {
  "--vb-avatar-reserve": isOwner ? "36px" : "22px",
  "--vb-avatar-reserve-mobile": isOwner ? "40px" : "22px",
} as CSSProperties;

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
  insetInlineStart: 0,
  insetInlineEnd: 0,
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

      {/* Debajo del avatar, no encima. En posición absoluta para no empujar
          nada: el avatar va montado sobre la portada. */}
      {isOwner && (
        <EditTextButton
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handlePickAvatar();
          }}
          disabled={uploading}
          title={tGroups("changeAvatarLabel")}
          ariaLabel={tGroups("changeAvatarLabel")}
          style={{
            ...avatarEditButtonStyle({
              mobile: mobileRefreshEnabled,
              live: groupIsLive,
            }),
            pointerEvents: "auto",
            fontFamily: groupPageFontStack,
          }}
        >
          {uploading && cropMode === "avatar" ? "..." : tCommon("edit")}
        </EditTextButton>
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
    const isBanned = memberStatus === "banned";
    const isPrivate = group.visibility === "private";
    const isHidden = group.visibility === "hidden";

    // La landing restringida ya NO usa la caja del CTA: si hay una acción posible
    // se muestra SOLO el botón (suscribirme / solicitar acceso / cancelar), sin
    // contenedor ni texto encima —el precio y la acción ya se leen en el botón—.
    // Los textos de contexto ("Esta comunidad requiere suscripción de $X al mes…",
    // "Esta comunidad es privada…", "Solicitud pendiente", acceso legado, solicitud
    // aprobada) quedan fuera.
    const showSubscriptionCta =
      !isBanned && (shouldShowSubscriptionRecovery || isSubscriptionGroup);

    const showPrivateCta =
      !isBanned &&
      !shouldShowSubscriptionRecovery &&
      !removedBySubscriptionTransition &&
      !isSubscriptionGroup &&
      isPrivate;

    // Estados donde no hay ninguna acción que ofrecer: se conserva una sola línea
    // de aviso (sin caja) porque, si no, la card no explicaría por qué no hay nada.
    const noticeText = isBanned
      ? tGroups("communityBanned")
      : removedBySubscriptionTransition && !subscriptionEnabled
      ? tGroups("accessRevoked")
      : !isSubscriptionGroup && !shouldShowSubscriptionRecovery && isHidden
      ? tGroups("communityHiddenNoAccess")
      : null;

    const subscribeButton = (
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
            ? tGroups("subscribeForPrice", { price: formatMoneyWithTax(subscriptionPrice + FIXED_SERVICE_FEE_USD, subscriptionCurrency) })
            : tGroups("subscribeCta")
          : tGroups("loginToSubscribe")}
      </button>
    );

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
              /* El contenido real no aparece de golpe tras el skeleton: fade-in
                 suave al montar (cuando ya llegaron los datos de la comunidad). */
              animation: vbGroupReveal var(--duration-slow, 400ms) var(--ease-out, ease) both;
            }
            @keyframes vbGroupReveal {
              from {
                opacity: 0;
              }
              to {
                opacity: 1;
              }
            }
            @media (prefers-reduced-motion: reduce) {
              .group-card {
                animation: none;
              }
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
  padding-top: calc((clamp(112px, 24vw, 220px) / 2) + var(--vb-avatar-reserve, 22px));
  position: relative;
  z-index: 1;
  min-height: 110px;
  min-width: 0;
}
@media (max-width: 768px) {
  .group-header-copy {
    padding-top: calc((clamp(146px, 31.2vw, 286px) / 2) + var(--vb-avatar-reserve-mobile, 22px));
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

            /* Aire con la fila de datos. Mismo valor que el de ProfileSocialActions
               en el perfil, que tiene la misma cabecera. */
            .group-actions-wrap {
              margin-top: 24px;
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

/* Celular: el contenido de las pestañas necesita aire lateral. Antes iba pegado
   al borde y los textos de integrantes, configuración y demás quedaban cortados
   contra el marco del teléfono. 12px es el mismo valor que usa el perfil, para
   que las dos superficies se vean igual.

   Lo que debe seguir llegando de borde a borde —el feed y las cards de
   experiencias— se lo descuenta con margen negativo, en vez de quitarle el
   padding al contenedor (que fue justo lo que hacía saltar la card del perfil). */
@media (max-width: 900px) {
  .group-tab-panel {
    padding-inline-start: 12px;
    padding-inline-end: 12px;
  }

  .group-tab-panel.group-feed-wrap,
  .group-tab-panel :global(.serviceActivationPanel) {
    margin-inline-start: -12px;
    margin-inline-end: -12px;
  }
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
    border-inline-start: 0 !important;
    border-inline-end: 0 !important;
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
                      insetInlineEnd: 18,
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

                <div className="group-header-copy" style={avatarReserveVars}>
                  <div className="group-meta">
                    <h1 style={{ ...titleStyle, margin: 0 }}>
                      {group.name ?? ""}
                    </h1>

                    {!!group.description && (
                      <div className="group-description" style={textStyle}>
                        {group.description}
                      </div>
                    )}

<StatsRow items={groupStatsItems} />
                  </div>
                </div>

                <div className="group-actions-wrap">
                  {showSubscriptionCta ? (
                    /* Suscripción: solo el botón, sin caja ni texto arriba. */
                    <div className="group-actions-row">{subscribeButton}</div>
                  ) : showPrivateCta ? (
                    /* Privada por aprobación: solo el botón (solicitar/cancelar). */
                    <div className="group-actions-row">
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
                  ) : noticeText ? (
                    /* Estados SIN botón posible (baneado, acceso revocado, oculta
                       sin acceso): queda solo la línea de aviso, sin caja. */
                    <div
                      style={{
                        ...microText,
                        color: "rgba(255,255,255,0.82)",
                        textAlign: "center",
                      }}
                    >
                      {noticeText}
                    </div>
                  ) : null}
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
                    {/* 🧾 IVA — "+ impuestos" (solo compradores en México). */}
                    <TaxNote color="rgba(255,255,255,0.4)" style={{ marginTop: 4 }} />
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

        {/* Pasarela de suscripción: los no-miembros salen por aquí (return
            anticipado), así que DEBE montarse en esta rama para poder abrirse. */}
        {subscriptionGateway}
      </>
    );
  }

  const isPublicGroup = group.visibility === "public";
  const canViewPublicFeed = isPublicGroup || effectiveIsMember || isOwner || isEmbed;

  // ⚠️ Espeja `canReadGroupContent` de firestore.rules, y por eso NO incluye `isEmbed`:
  // ir dentro de un iframe no otorga ningún permiso de lectura. Con `canViewPublicFeed`
  // aquí, un no-miembro embebido se suscribía a las historias y Firestore le respondía
  // permiso denegado. Un `onSnapshot` que falla queda MUERTO, no reintenta.
  const canReadGroupStories = isPublicGroup || effectiveIsMember || isOwner;

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
            /* El contenido real no aparece de golpe tras el skeleton: fade-in
               suave al montar (cuando ya llegaron los datos de la comunidad). */
            animation: vbGroupReveal var(--duration-slow, 400ms) var(--ease-out, ease) both;
          }
          @keyframes vbGroupReveal {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .group-card {
              animation: none;
            }
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
  padding-top: calc((clamp(112px, 24vw, 220px) / 2) + var(--vb-avatar-reserve, 22px));
  position: relative;
  z-index: 1;
  min-height: 110px;
  min-width: 0;
}
@media (max-width: 768px) {
  .group-header-copy {
    padding-top: calc((clamp(146px, 31.2vw, 286px) / 2) + var(--vb-avatar-reserve-mobile, 22px));
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
            margin-inline-start: auto;
            margin-inline-end: auto;
            min-width: 0;
          }

          .group-subnav-wrap {
            margin-top: 12px;
            width: 100%;
            max-width: none;
            margin-inline-start: auto;
            margin-inline-end: auto;
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
    border-inline-start: 0 !important;
    border-inline-end: 0 !important;
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
                    insetInlineEnd: 18,
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

              {/* Los links son la única puerta a una comunidad oculta, así que
                  también los reparte quien modera: si no, cada alta depende de
                  que el creador esté disponible. El permiso real lo comprueba
                  `asegurarCreadorOModerador` en el backend. */}
              {!coverSearchOpen && (isOwner || isModerator) && group.visibility === "hidden" && (
                <div
                  style={{
                    position: "absolute",
                    insetInlineStart: 18,
                    top: 18,
                    zIndex: 40,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 8,
                    maxWidth: "calc(100% - 36px)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setInviteOpen(true)}
                    className="cover-corner-muted"
                    title={tGroups("createInviteLink")}
                    aria-label={tGroups("createInviteLink")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 13px",
                      borderRadius: 8,
                      border: "none",
                      background: "rgba(20,10,35,0.55)",
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 700,
                      lineHeight: 1,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
                      +
                    </span>
                    {tGroups("createInviteLink")}
                    <svg
                      aria-hidden="true"
                      focusable="false"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      style={{ display: "block", flexShrink: 0 }}
                    >
                      <path
                        fill="currentColor"
                        d="M12 2a7 7 0 0 0-7 7V20l2.33-2 2.34 2 2.33-2 2.33 2 2.34-2 2.33 2V9a7 7 0 0 0-7-7Z"
                      />
                      <circle cx="9.5" cy="10.5" r="1.15" fill="#170c27" />
                      <circle cx="14.5" cy="10.5" r="1.15" fill="#170c27" />
                    </svg>
                  </button>

                  <InviteLinksList groupId={groupId} refreshKey={inviteRefreshKey} />
                </div>
              )}

              {/* Esquina inferior derecha de la portada. */}
              {!coverSearchOpen && isOwner && (
                <EditTextButton
                  onClick={handlePickCover}
                  disabled={uploading}
                  title={tGroups("chooseCover")}
                  ariaLabel={tGroups("chooseCover")}
                  style={{
                    position: "absolute",
                    insetInlineEnd: 14,
                    bottom: 14,
                    zIndex: 40,
                    fontSize: 12,
                    fontFamily: groupPageFontStack,
                  }}
                >
                  {uploading && cropMode === "cover" ? "..." : tCommon("edit")}
                </EditTextButton>
              )}
            </div>

            {inviteOpen && (
              <InviteLinkModal
                groupId={groupId}
                onClose={() => setInviteOpen(false)}
                onCreated={() => setInviteRefreshKey((k) => k + 1)}
              />
            )}

            <div className="group-content">
              {avatarNode}

              <div className="group-header-copy" style={avatarReserveVars}>
                <div className="group-meta">
                  <h1 style={{ ...titleStyle, margin: 0 }}>
                    {group.name ?? ""}
                  </h1>

                  {!!group.description && (
                    <div className="group-description" style={textStyle}>
                      {group.description}
                    </div>
                  )}

<StatsRow items={groupStatsItems} />

                  <div style={{
                    // Mismo aire que .group-actions-wrap y que el perfil: esta es la otra
                    // rama del render de la cabecera y tenia la mitad.
                    marginTop: 24,
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
                          onClick={() => {
                            if (membershipRequiresSubscription && mySub) {
                              // Cancelada (pendiente de fin de periodo) → reabrir la pasarela
                              // para REACTIVAR el pago recurrente; activa → abrir cancelación.
                              if (mySub.cancelAtPeriodEnd || mySub.status === "cancelled" || mySub.status === "ended") {
                                openSubscriptionModal();
                              } else {
                                setCancelSubOpen(true);
                              }
                            } else {
                              setLeaveOverlayOpen(true);
                            }
                          }}
                          // Suscrito ACTIVO = azul, ancho normal, dice solo "Suscrito".
                          // CANCELADO = gradiente morado/rosa, dice "Suscrito hasta {fecha}"
                          // en un solo renglón (botón más ancho); al hacer clic reabre la
                          // pasarela para reactivar la suscripción.
                          style={
                            !membershipRequiresSubscription
                              ? { ...primaryButton }
                              : mySub && (mySub.cancelAtPeriodEnd || mySub.status === "cancelled" || mySub.status === "ended")
                                ? { ...primaryButton, flex: "0 0 auto", width: "auto", maxWidth: "none", whiteSpace: "nowrap", paddingInline: 22 }
                                : { ...primaryButton, background: "#3b82f6" }
                          }
                        >
                          {membershipRequiresSubscription
                            ? mySub && (mySub.cancelAtPeriodEnd || mySub.status === "cancelled" || mySub.status === "ended") && mySub.accessUntil
                              ? tGroups("subscribedUntil", { date: formatSubDate(mySub.accessUntil) })
                              : tGroups("subscribedLabel")
                            : tGroups("alreadyMemberLabel")}
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

              {!isOwner && !effectiveIsMember && group.visibility === "public" && memberStatus === "banned" && (
              <div className="group-actions-wrap">
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
            canView={canReadGroupStories}
            currentUserId={user?.uid ?? null}
            isOwner={isOwner}
          />

          {/* El subnav de secciones es SOLO de quien administra: es quien tiene
              donde elegir. Para el resto, los integrantes se abren con el texto
              morado que se pinta bajo el subnav de medios. */}
          {(isOwner || isEmbed) && (
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
  belowMediaTabs={
    visitorCanJumpToMembers ? (
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -6, padding: "0 4px 10px" }}>
        <TextButton
          tone="brand"
          size="sm"
          onClick={() => handleTabChange("members")}
          style={{ fontSize: 13 }}
        >
          {tGroups("groupSeeMembers")}
        </TextButton>
      </div>
    ) : null
  }
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
            creatorId={group?.ownerId ?? null}
            buyerId={user?.uid ?? null}
            groupId={normalizedCurrentDonation.sourceScope === "group" ? groupId : null}
            groupName={normalizedCurrentDonation.sourceScope === "group" ? (group?.name ?? null) : null}
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
                  titleAction={
                    visitorCanJumpToMembers ? (
                      // Sin subnav de secciones, esta es la unica vuelta a
                      // publicaciones. Va en el renglon del titulo, como en el perfil.
                      <TextButton
                        tone="brand"
                        size="sm"
                        onClick={() => handleTabChange("feed")}
                        style={{ fontSize: 13, flexShrink: 0 }}
                      >
                        {tGroups("profileBackToPosts")}
                      </TextButton>
                    ) : null
                  }
                  groupId={groupId}
                  isOwner={isOwner}
                  isModerator={isModerator}
                  canMembersViewList={isEmbed || canMembersViewList}
                  initialShowRequests={requestsDeepLinkOpen}
                  initialShowModeratorPanel={assignModeratorDeepLinkOpen}
                  // Solo la comunidad privada normal aprueba/rechaza solicitudes:
                  // la pública se une directo, la oculta por invitación y la de
                  // suscripción pagando.
                  canReceiveJoinRequests={
                    normalizeVisibility(group.visibility) === "private" &&
                    !subscriptionEnabled
                  }
                  // Invitar a moderar a alguien de fuera nunca aplica en una
                  // comunidad oculta: no se le revela su existencia a nadie que
                  // no esté dentro.
                  canInviteModerators={
                    normalizeVisibility(group.visibility) !== "hidden"
                  }
                />
              </div>
            )}

            {activeTab === "services" && isOwner && user && group.ownerId && (
              <section className="group-tab-panel" style={{ marginTop: 12 }}>
                <OwnerAdminServices
                  groupId={groupId}
                  ownerId={group.ownerId}
                  currentUserId={user.uid}
                  currentVisibility={normalizeVisibility(group.visibility)}
                  currentMonetization={normalizedCurrentMonetization}
                  currentOfferings={normalizedCurrentOfferings}
                  currentDonation={normalizedCurrentDonation}
                  onChangeVisibility={(next) =>
                    setGroupVisibility(groupId, next, {
                      name: group.name,
                      description: group.description,
                      category: group.category,
                      tags: group.tags,
                    })
                  }
                />
              </section>
            )}

            {activeTab === "settings" && isOwner && user && group.ownerId && (
              <section
                className="group-tab-panel"
                style={{
                  ...panelStyle,
                  marginTop: 12,
                  border: "none",
                  background: "transparent",
                  borderRadius: 0,
                  padding: "0 16px",
                }}
              >
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

      <StripePaymentModal
        open={payGreetOpen}
        amount={payGreetAmount != null ? payGreetAmount + FIXED_SERVICE_FEE_USD : null}
        amountCurrency={SETTLEMENT_CURRENCY}
        externalReference={payGreetId ? `greetingRequest__${payGreetId}` : null}
        createIntent={(args) => createGreetingStripeIntent({ greetingRequestId: payGreetId ?? "", saveCard: args.saveCard, taxCountry: args.taxCountry, savedPaymentMethodId: args.savedPaymentMethodId, applyCredit: args.applyCredit })}
        priceLabel={payGreetLabel}
        productType={greetType === "consejo" ? "Consejo" : "Saludo"}
        providerName={group?.name}
        avatarUrl={group?.avatarUrl ?? null}
        description={tServices(greetType === "consejo" ? "payDescConsejo" : "payDescSaludo", {
          name: group?.name ?? tServices("creatorFallback"),
        })}
        successMessage={tServices(greetType === "consejo" ? "paySuccessConsejo" : "paySuccessSaludo", {
          name: group?.name ?? tServices("creatorFallback"),
        })}
        holdSuccessMessage={`Tu solicitud fue enviada. Todavía no te cobramos, el cargo se hace hasta que ${group?.name ?? tServices("creatorFallback")} grabe y envíe tu ${greetType === "consejo" ? "consejo" : "saludo"}.`}
        autoConfirm={autoConfirmPay}
        onClose={() => { setPayGreetOpen(false); setAutoConfirmPay(false); setIsRetry(false); }}
        onPaid={() => {
          // El panel NO se cierra: muestra la pantalla de éxito. Solo registramos la compra.
          registrarCompraGeo({
            creatorId: group?.ownerId,
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
        providerName={group?.name}
        avatarUrl={group?.avatarUrl ?? null}
        durationMinutes={paySessionDuration}
        successMessage={tServices("paySuccessScheduled", { name: group?.name ?? tServices("creatorFallback") })}
        holdSuccessMessage={`Tu solicitud fue enviada. Todavía no te cobramos, el cargo se hace hasta que ${group?.name ?? tServices("creatorFallback")} agende la sesión.`}
        autoConfirm={autoConfirmPay}
        onClose={() => { setPaySessionOpen(false); setAutoConfirmPay(false); setIsRetry(false); }}
        onPaid={() => {
          // El panel NO se cierra: muestra la pantalla de éxito. Solo registramos la compra.
          registrarCompraGeo({
            creatorId: group?.ownerId,
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
        providerName={group?.name}
        avatarUrl={group?.avatarUrl ?? null}
        durationMinutes={payMeetDuration}
        successMessage={tServices("paySuccessScheduled", { name: group?.name ?? tServices("creatorFallback") })}
        holdSuccessMessage={`Tu solicitud fue enviada. Todavía no te cobramos, el cargo se hace hasta que ${group?.name ?? tServices("creatorFallback")} agende la sesión.`}
        autoConfirm={autoConfirmPay}
        onClose={() => { setPayMeetOpen(false); setAutoConfirmPay(false); setIsRetry(false); }}
        onPaid={() => {
          // El panel NO se cierra: muestra la pantalla de éxito. Solo registramos la compra.
          registrarCompraGeo({
            creatorId: group?.ownerId,
            serviceType: "live_session",
            grossAmount: payMeetAmount ?? undefined,
          });
        }}
      />

      {/* Suscripción a la comunidad — pasarela real (definida arriba, reutilizada). */}
      {subscriptionGateway}

      {/* Confirmación de cancelación de suscripción (conserva acceso hasta fin de mes). */}
      {cancelSubOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => { if (!cancellingSub) setCancelSubOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: 16, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 380, background: "#111", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 20, display: "grid", gap: 14, color: "#fff", fontFamily: "inherit" }}
          >
            <div style={{ fontSize: 17, fontWeight: 700, textAlign: "center" }}>{tGroups("cancelSubscriptionTitle")}</div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.7)", textAlign: "center" }}>
              {tGroups("cancelSubscriptionBody", { date: mySub?.accessUntil ? formatSubDate(mySub.accessUntil) : "—" })}
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              <button
                type="button"
                onClick={handleCancelSubscription}
                disabled={cancellingSub}
                style={{ padding: "12px 20px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: cancellingSub ? "not-allowed" : "pointer", opacity: cancellingSub ? 0.75 : 1 }}
              >
                {cancellingSub ? tFeed("processing") : tGroups("cancelSubscriptionConfirm")}
              </button>
              <button
                type="button"
                onClick={() => setCancelSubOpen(false)}
                disabled={cancellingSub}
                style={{ padding: "12px 20px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
              >
                {tGroups("cancelSubscriptionKeep")}
              </button>
            </div>
          </div>
        </div>
      )}

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
            ? formatMoneyWithTax(meetGreetPrice + FIXED_SERVICE_FEE_USD, meetGreetCurrency)
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
            ? formatMoneyWithTax(exclusiveSessionPrice + FIXED_SERVICE_FEE_USD, exclusiveSessionCurrency)
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
                  {/* 🧾 IVA — "+ impuestos" (solo compradores en México). */}
                  <TaxNote color="rgba(255,255,255,0.4)" style={{ marginTop: 4 }} />
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

      {/* Confirmación de salida / cancelación de suscripción. Panel canónico de
          Vibra (ver vibra_style.md). `mobileVariant="centered"`: en celular es el
          mismo panel centrado que en laptop, no una pestaña inferior — para un
          diálogo de dos botones la pestaña queda desproporcionada. */}
      <Modal
        open={leaveOverlayOpen}
        onClose={() => {
          if (!leaving) setLeaveOverlayOpen(false);
        }}
        // Sin header: la pregunta ES el diálogo. Como título se cortaría con
        // ellipsis (el header pinta una sola línea), y una descripción aparte no
        // aporta nada. Los botones del footer ya dan la salida, así que la X
        // sobra (y con ella el espacio muerto sobre la pregunta).
        hideHeader
        ariaLabel={
          membershipRequiresSubscription
            ? tGroups("cancelSubscriptionTitle")
            : tGroups("leaveConfirm")
        }
        mobileVariant="centered"
        maxWidthDesktop={420}
        // Sin header, el aire superior lo pone el propio contenido.
        contentPadding="24px 20px 20px"
        footer={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button
              variant="secondary"
              onClick={() => setLeaveOverlayOpen(false)}
              disabled={leaving}
              style={{ flex: "1 1 120px" }}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={handleLeave}
              loading={leaving}
              style={{ flex: "1 1 120px" }}
            >
              {leaving
                ? tFeed("processing")
                : membershipRequiresSubscription
                ? tGroups("cancelSubscriptionButton")
                : tCommon("leave")}
            </Button>
          </div>
        }
      >
        <p
          style={{
            fontSize: 17,
            fontWeight: 600,
            color: "#fff",
            lineHeight: 1.35,
            letterSpacing: "-0.01em",
            margin: 0,
            textAlign: "center",
          }}
        >
          {membershipRequiresSubscription
            ? tGroups("cancelSubscriptionTitle")
            : tGroups("leaveConfirm")}
        </p>

      </Modal>

      <VibraToast toast={toast} />
    </>
  );
}