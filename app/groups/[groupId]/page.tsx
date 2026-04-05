"use client";

import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
} from "react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { createPortal } from "react-dom";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import {
  joinGroup,
  joinGroupWithSubscription,
  leaveGroup,
} from "@/lib/groups/membership";
import { requestToJoin, cancelJoinRequest } from "@/lib/groups/joinRequests";
import OwnerAdminPanel from "./components/OwnerAdminPanel";
import GroupSubnav from "./components/GroupSubnav";
import GroupMembersTab from "./components/GroupMembersTab";
import GroupPostsFeed from "./components/posts/GroupPostsFeed";
import GroupRecommendationsRail from "@/app/components/GroupRecommendations/GroupRecommendationsRail";
import CreatorServicesMenu from "@/components/services/CreatorServicesMenu";
import DonationEntryPoint from "@/components/services/DonationEntryPoint";
import {
  createGreetingRequest,
  type GreetingType,
} from "@/lib/greetings/greetingRequests";
import {
  mergeMonetizationWithCatalog,
  mergeWithDefaultCatalog,
  normalizeDonationSettings,
} from "@/lib/groups/groupServiceCatalog";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import Cropper from "react-easy-crop";
import type {
  Currency,
  CreatorServiceMeta,
  CreatorServiceType,
  GroupDonationSettings,
  GroupMonetizationSettings,
  GroupOffering,
} from "@/types/group";

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
  | "subscribed"
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
type Area = { x: number; y: number; width: number; height: number };

function labelForOfferingType(t: string) {
  if (t === "suscripcion") return "Suscripción";
  if (t === "saludo") return "Saludo";
  if (t === "consejo") return "Consejo";
  if (t === "meet_greet_digital") return "Meet & Greet";
  if (t === "clase_personalizada") return "Clase personalizada";
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
  if (raw === "subscribed") return "subscribed";
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

function normalizeMembershipAccessType(raw: unknown): MembershipAccessType {
  if (raw === "standard") return "standard";
  if (raw === "subscription") return "subscription";
  if (raw === "subscribed") return "subscribed";
  if (raw === "legacy_free") return "legacy_free";
  return "unknown";
}

function normalizeCurrency(raw: unknown): Currency | null {
  if (raw === "MXN") return "MXN";
  if (raw === "USD") return "USD";
  return null;
}

function normalizeMonetization(
  raw: GroupDoc["monetization"]
): Partial<GroupMonetizationSettings> | undefined {
  if (!raw) return undefined;

  return {
    isPaid: raw.isPaid,
    priceMonthly: raw.priceMonthly ?? raw.subscriptionPriceMonthly ?? null,
    currency:
      normalizeCurrency(raw.currency) ??
      normalizeCurrency(raw.subscriptionCurrency),
    subscriptionsEnabled: raw.subscriptionsEnabled,
    subscriptionPriceMonthly:
      raw.subscriptionPriceMonthly ?? raw.priceMonthly ?? null,
    subscriptionCurrency:
      normalizeCurrency(raw.subscriptionCurrency) ??
      normalizeCurrency(raw.currency),
    paidPostsEnabled: raw.paidPostsEnabled,
    paidLivesEnabled: raw.paidLivesEnabled,
    paidVodEnabled: raw.paidVodEnabled,
    paidLiveCommentsEnabled: raw.paidLiveCommentsEnabled,
    greetingsEnabled: raw.greetingsEnabled,
    adviceEnabled: raw.adviceEnabled,
    customClassEnabled: raw.customClassEnabled,
    digitalMeetGreetEnabled: raw.digitalMeetGreetEnabled,
  };
}

function normalizeDonationInput(
  raw: GroupDoc["donation"]
): Partial<GroupDonationSettings> | undefined {
  if (!raw) return undefined;

  const normalizedMode =
    raw.mode === "general" || raw.mode === "wedding" || raw.mode === "none"
      ? raw.mode
      : undefined;

  const normalizedSourceScope =
    raw.sourceScope === "group" || raw.sourceScope === "profile"
      ? raw.sourceScope
      : undefined;

  return {
    mode: normalizedMode,
    enabled: raw.enabled,
    visible: raw.visible,
    currency: normalizeCurrency(raw.currency),
    sourceScope: normalizedSourceScope,
    suggestedAmounts: Array.isArray(raw.suggestedAmounts)
      ? raw.suggestedAmounts.filter(
          (value): value is number =>
            typeof value === "number" && Number.isFinite(value)
        )
      : undefined,
    goalLabel: raw.goalLabel ?? null,
    title: raw.title ?? null,
    description: raw.description ?? null,
  };
}

function normalizePostingMode(raw: unknown): PostingMode {
  return raw === "owner_only" ? "owner_only" : "members";
}

function normalizeCommentsEnabled(raw: unknown): boolean {
  return raw !== false;
}

function isJoinedStatus(status: MemberStatus) {
  return (
    status === "active" ||
    status === "subscribed" ||
    status === "muted"
  );
}

function normalizeVisibility(raw: unknown): Visibility | null {
  if (raw === "public" || raw === "private" || raw === "hidden") return raw;
  return null;
}

function toCatalogOfferings(
  offerings: GroupDoc["offerings"]
): Partial<GroupOffering>[] {
  const arr = Array.isArray(offerings) ? offerings : [];

  return arr
    .filter((item): item is NonNullable<typeof item> => !!item)
    .map((item): Partial<GroupOffering> => ({
      type: item.type,
      enabled: item.enabled,
      visible: item.visible,
      visibility:
        item.visibility === "hidden" ||
        item.visibility === "members" ||
        item.visibility === "public"
          ? item.visibility
          : undefined,
      displayOrder: item.displayOrder ?? undefined,
      memberPrice: item.memberPrice ?? undefined,
      publicPrice: item.publicPrice ?? undefined,
      currency: normalizeCurrency(item.currency) ?? undefined,
      requiresApproval: item.requiresApproval,
      sourceScope:
        item.sourceScope === "group" ||
        item.sourceScope === "profile" ||
        item.sourceScope === "both"
          ? item.sourceScope
          : undefined,
      meta: item.meta ?? null,
      price: item.price ?? undefined,
    }));
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

function formatMoney(value: number, currency: Currency) {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export default function GroupPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [isMember, setIsMember] = useState<boolean>(false);
  const [memberStatus, setMemberStatus] = useState<MemberStatus>(null);
  const [memberRole, setMemberRole] = useState<MemberRole>(null);
  const [membershipAccessType, setMembershipAccessType] =
    useState<MembershipAccessType>("unknown");
  const [membershipRequiresSubscription, setMembershipRequiresSubscription] =
    useState(false);
  const [membershipSubscriptionActive, setMembershipSubscriptionActive] =
    useState(false);
  const [membershipLegacyComplimentary, setMembershipLegacyComplimentary] =
    useState(false);
  const [membershipTransitionPendingAction, setMembershipTransitionPendingAction] =
    useState(false);
  const [membershipTransitionReason, setMembershipTransitionReason] =
    useState<string | null>(null);
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

    const removedBySubscriptionTransition = useMemo(() => {
    return false;
  }, []);

    const requiresSubscriptionFromMembership = useMemo(() => {
    return (
      membershipRequiresSubscription ||
      membershipAccessType === "subscription"
    );
  }, [membershipRequiresSubscription, membershipAccessType]);

  const shouldShowSubscriptionRecovery =
    !isOwner &&
    !effectiveIsMember &&
    subscriptionEnabled &&
    (group?.visibility === "private" || group?.visibility === "hidden") &&
    (membershipRequiresSubscription || removedBySubscriptionTransition);

  const isSubscriptionGroup =
    !isOwner &&
    !effectiveIsMember &&
    (group?.visibility === "private" || group?.visibility === "hidden") &&
    subscriptionEnabled &&
    (!membershipTransitionPendingAction ||
      membershipRequiresSubscription ||
      removedBySubscriptionTransition);

  const [greetOpen, setGreetOpen] = useState(false);
  const [greetType, setGreetType] = useState<GreetingType>("saludo");
  const [toName, setToName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [greetSubmitting, setGreetSubmitting] = useState(false);
  const [greetError, setGreetError] = useState<string | null>(null);
  const [greetSuccess, setGreetSuccess] = useState<string | null>(null);
  const [serviceToast, setServiceToast] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [subscriptionSubmitting, setSubscriptionSubmitting] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

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

  function clearServiceQuery() {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("service");
    const nextHref = nextParams.toString()
      ? `${pathname}?${nextParams.toString()}`
      : pathname;
    router.replace(nextHref, { scroll: false });
  }

  function openSubscriptionModal() {
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
    setError(null);

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

  const pageWrap: CSSProperties = {
    minHeight: "calc(100dvh - 70px)",
    padding: "12px 0 calc(120px + env(safe-area-inset-bottom))",
    background: "#000",
    color: "#fff",
    fontFamily: fontStack,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    textRendering: "optimizeLegibility",
  };

  const container: CSSProperties = {
    maxWidth: ui.pageMaxWidth,
    margin: "0 auto",
    width: "100%",
    padding: "0",
    boxSizing: "border-box",
    minWidth: 0,
  };

  const cardStyle: CSSProperties = {
    borderRadius: ui.cardRadius,
    overflow: "hidden",
    border: ui.borderSoft,
    background: ui.cardBg,
    boxShadow: ui.shadow,
    color: "#fff",
    backdropFilter: "blur(10px)",
    minWidth: 0,
  };

  const panelStyle: CSSProperties = {
    borderRadius: ui.panelRadius,
    border: ui.borderFaint,
    background: ui.panelBg,
    padding: 14,
  };

  const titleStyle: CSSProperties = {
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

  const subtitleStyle: CSSProperties = {
    fontSize: ui.subtitle,
    fontWeight: 600,
    lineHeight: 1.2,
    color: "#fff",
    letterSpacing: 0,
  };

  const textStyle: CSSProperties = {
    fontSize: ui.body,
    fontWeight: 400,
    lineHeight: 1.5,
    color: "rgba(255,255,255,0.82)",
  };

  const microText: CSSProperties = {
    fontSize: ui.micro,
    fontWeight: 400,
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.70)",
  };

  const labelStyle: CSSProperties = {
    fontSize: ui.label,
    fontWeight: 500,
    lineHeight: 1.3,
    color: "#fff",
  };

  const primaryButton: CSSProperties = {
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

  const secondaryButton: CSSProperties = {
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

  const tinyGhostButton: CSSProperties = {
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

  const coverDonationButton: CSSProperties = {
    ...tinyGhostButton,
    position: "absolute",
    left: 12,
    top: 12,
    zIndex: 3,
    background: "rgba(0,0,0,0.92)",
    border: "1px solid rgba(255,255,255,0.18)",
  };

  const inputStyle: CSSProperties = {
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

  const messageBox: CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    fontSize: ui.micro,
    fontWeight: 400,
    color: "rgba(255,255,255,0.92)",
    lineHeight: 1.45,
  };

  const serviceModalBackdropStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2147483646,
    background: "rgba(0,0,0,0.76)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    display: "grid",
    placeItems: "center",
    padding: 16,
  };

  const serviceModalCardStyle: CSSProperties = {
    width: "min(560px, 100%)",
    maxHeight: "min(88dvh, 760px)",
    overflowY: "auto",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.12)",
    background:
      "linear-gradient(180deg, rgba(18,18,18,0.98) 0%, rgba(10,10,10,0.98) 100%)",
    boxShadow: "0 24px 80px rgba(0,0,0,0.52)",
    color: "#fff",
    padding: 16,
  };

  const serviceToastStyle: CSSProperties = {
    position: "fixed",
    top: 16,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 2147483647,
    minWidth: 280,
    maxWidth: "min(92vw, 560px)",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(12,12,12,0.96)",
    color: "#fff",
    boxShadow: "0 18px 48px rgba(0,0,0,0.45)",
    fontSize: ui.body,
    fontWeight: 600,
    lineHeight: 1.35,
    textAlign: "center",
    backdropFilter: "blur(10px)",
  };

  useEffect(() => {
    setMounted(true);
  }, []);

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
            setMembershipAccessType("unknown");
            setMembershipRequiresSubscription(false);
            setMembershipSubscriptionActive(false);
            setMembershipLegacyComplimentary(false);
            setMembershipTransitionPendingAction(false);
            setMembershipTransitionReason(null);
            return;
          }

          const data = msnap.data() as any;
          const status = normalizeMemberStatus(data?.status ?? "active");
          const role = normalizeMemberRole(
            data?.roleInGroup ?? data?.role ?? "member"
          );
          const accessType = normalizeMembershipAccessType(data?.accessType);
          const requiresSubscription = data?.requiresSubscription === true;
          const subscriptionActive = data?.subscriptionActive === true;
          const legacyComplimentary =
            data?.legacyComplimentary === true ||
            accessType === "legacy_free";
          const transitionPendingAction = data?.transitionPendingAction === true;
          const transitionReason =
            typeof data?.removedReason === "string"
              ? data.removedReason
              : data?.removedDueToSubscriptionTransition === true
              ? "subscription_transition"
              : null;

          setMemberStatus(status);
          setMemberRole(role);
          setMembershipAccessType(accessType);
          setMembershipRequiresSubscription(requiresSubscription);
          setMembershipSubscriptionActive(subscriptionActive);
          setMembershipLegacyComplimentary(legacyComplimentary);
          setMembershipTransitionPendingAction(transitionPendingAction);
          setMembershipTransitionReason(transitionReason);

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
          setMembershipAccessType("unknown");
          setMembershipRequiresSubscription(false);
          setMembershipSubscriptionActive(false);
          setMembershipLegacyComplimentary(false);
          setMembershipTransitionPendingAction(false);
          setMembershipTransitionReason(null);
        }
      );
    } else {
      setIsMember(false);
      setMemberStatus(null);
      setMemberRole(null);
      setMembershipAccessType("unknown");
      setMembershipRequiresSubscription(false);
      setMembershipSubscriptionActive(false);
      setMembershipLegacyComplimentary(false);
      setMembershipTransitionPendingAction(false);
      setMembershipTransitionReason(null);
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

  useEffect(() => {
    if (!greetOpen && !subscriptionOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (greetOpen && !greetSubmitting) {
          closeGreetingForm();
        }
        if (subscriptionOpen && !subscriptionSubmitting) {
          closeSubscriptionModal();
        }
      }
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyTouchAction = document.body.style.touchAction;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.touchAction = previousBodyTouchAction;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [greetOpen, greetSubmitting, subscriptionOpen, subscriptionSubmitting]);

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
      if (e?.message === "GROUP_REQUIRES_SUBSCRIPTION") {
        openSubscriptionModal();
        return;
      }

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
    clearServiceQuery();
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

  useEffect(() => {
    const requestedService = searchParams.get("service");

    if (!requestedService) return;
    if (!user || effectiveIsMember || isOwner) return;

    if (requestedService === "suscripcion" && isSubscriptionGroup) {
      openSubscriptionModal();
      return;
    }

    if (isGreetingType(requestedService)) {
      return;
    }

    if (requestedService === "meet_greet_digital") {
      setServiceToast(
        "Meet & Greet digital aún no está conectado al flujo completo. Ya quedó visible en el menú."
      );
      clearServiceQuery();
      return;
    }

    if (requestedService === "clase_personalizada") {
      setServiceToast(
        "Clase personalizada ya quedó preparada en el catálogo, pero su flujo operativo se conecta después."
      );
      clearServiceQuery();
    }
  }, [
    searchParams,
    user,
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

  function getGreetingUi(type: GreetingType) {
    if (type === "consejo") {
      return {
        title: "Solicitar consejo",
        intro:
          "Completa tu solicitud con el mayor contexto posible para que el creador entienda bien qué consejo necesitas.",
        recipientLabel: "¿Para quién o para qué situación es el consejo?",
        recipientPlaceholder:
          "Ej. Para mí / Para Ana / Para mi proceso actual",
        instructionsLabel: "Describe tu situación o qué consejo necesitas",
        instructionsPlaceholder:
          "Ej. Necesito consejo sobre disciplina, entrenamiento, motivación, enfoque, relaciones, etc.",
        submitLabel: "Solicitar consejo",
        helperText:
          "Nota: el creador revisará tu solicitud de consejo y podrá aceptarla o rechazarla. Pagos y entrega se integran después.",
        emptyToNameError:
          "Escribe para quién o para qué situación necesitas el consejo.",
        emptyInstructionsError:
          "Describe el contexto o el consejo que necesitas.",
      };
    }

    if (type === "mensaje") {
      return {
        title: "Solicitar mensaje",
        intro:
          "Completa tu solicitud con contexto claro para que el creador prepare el mensaje de forma personalizada.",
        recipientLabel: "¿A quién va dirigido el mensaje?",
        recipientPlaceholder: "Ej. Para Juan",
        instructionsLabel: "Indica el contexto del mensaje",
        instructionsPlaceholder:
          "Ej. Mensaje de felicitación, apoyo, ánimo o respuesta personalizada.",
        submitLabel: "Solicitar mensaje",
        helperText:
          "Nota: el creador podrá aceptar o rechazar tu solicitud de mensaje. Pagos y entrega se integran después.",
        emptyToNameError:
          "Escribe el nombre de la persona a quien va dirigido el mensaje.",
        emptyInstructionsError:
          "Indica el contexto o instrucciones del mensaje.",
      };
    }

    return {
      title: "Solicitar saludo",
      intro:
        "Completa tu solicitud con el contexto necesario para que el creador prepare el saludo como lo esperas.",
      recipientLabel: "¿Para quién es el saludo?",
      recipientPlaceholder: "Ej. Para Ana, por su cumpleaños",
      instructionsLabel: "Indica cómo quieres el saludo",
      instructionsPlaceholder:
        "Ej. Que la felicite por su cumpleaños, que mencione su nombre y que sea con tono alegre.",
      submitLabel: "Solicitar saludo",
      helperText:
        "Nota: el creador podrá aceptar o rechazar tu solicitud de saludo. Pagos y entrega de video se integran después.",
      emptyToNameError:
        "Escribe el nombre de la persona a quien va dirigido el saludo.",
      emptyInstructionsError:
        "Escribe el contexto / instrucciones del saludo.",
    };
  }

  const greetingUi = getGreetingUi(greetType);

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
    (group.visibility === "private" || group.visibility === "hidden");

  const greetingModal =
    mounted && greetOpen
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-service-modal-title"
            style={serviceModalBackdropStyle}
            onClick={() => {
              if (!greetSubmitting) closeGreetingForm();
            }}
          >
            <div
              style={serviceModalCardStyle}
              onClick={(e) => e.stopPropagation()}
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
                <div id="group-service-modal-title" style={subtitleStyle}>
                  {greetingUi.title}
                </div>

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
                  Cerrar
                </button>
              </div>

              <div
                style={{
                  marginTop: 8,
                  ...microText,
                  color: "rgba(255,255,255,0.78)",
                }}
              >
                {greetingUi.intro}
              </div>

              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gap: 10,
                }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>{greetingUi.recipientLabel}</span>
                  <input
                    autoFocus
                    value={toName}
                    onChange={(e) => setToName(e.target.value)}
                    placeholder={greetingUi.recipientPlaceholder}
                    disabled={greetSubmitting}
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>{greetingUi.instructionsLabel}</span>
                  <textarea
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder={greetingUi.instructionsPlaceholder}
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
                    {greetSubmitting ? "Enviando..." : greetingUi.submitLabel}
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

                <div style={microText}>{greetingUi.helperText}</div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const subscriptionModal =
    mounted && subscriptionOpen
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-subscription-modal-title"
            style={serviceModalBackdropStyle}
            onClick={() => {
              if (!subscriptionSubmitting) closeSubscriptionModal();
            }}
          >
            <div
              style={serviceModalCardStyle}
              onClick={(e) => e.stopPropagation()}
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
                <div id="group-subscription-modal-title" style={subtitleStyle}>
                  Suscripción mensual
                </div>

                <button
                  type="button"
                  onClick={closeSubscriptionModal}
                  disabled={subscriptionSubmitting}
                  style={{
                    ...secondaryButton,
                    opacity: subscriptionSubmitting ? 0.75 : 1,
                    cursor: subscriptionSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  Cerrar
                </button>
              </div>

              <div
                style={{
                  marginTop: 10,
                  display: "grid",
                  gap: 12,
                }}
              >
                <div style={textStyle}>
                  Esta comunidad requiere suscripción para unirte.
                </div>

                <div style={panelStyle}>
                  <div style={labelStyle}>Costo mensual</div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 24,
                      fontWeight: 800,
                      color: "#fff",
                    }}
                  >
                    {subscriptionPrice != null
                      ? formatMoney(subscriptionPrice, subscriptionCurrency)
                      : `Precio no disponible (${subscriptionCurrency})`}
                  </div>
                  <div style={{ marginTop: 8, ...microText }}>
                    Al continuar, el flujo intenta darte acceso inmediato a la
                    comunidad. La conexión completa del backend se termina en el
                    siguiente bloque.
                  </div>
                </div>

                {subscriptionError && (
                  <div style={messageBox}>{subscriptionError}</div>
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
                    onClick={handleSubscriptionCheckout}
                    disabled={subscriptionSubmitting}
                    style={{
                      ...primaryButton,
                      opacity: subscriptionSubmitting ? 0.75 : 1,
                      cursor: subscriptionSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {subscriptionSubmitting ? "Procesando..." : "Pagar y unirme"}
                  </button>

                  <button
                    type="button"
                    onClick={closeSubscriptionModal}
                    disabled={subscriptionSubmitting}
                    style={{
                      ...secondaryButton,
                      opacity: subscriptionSubmitting ? 0.75 : 1,
                      cursor: subscriptionSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const toastNode =
    mounted && serviceToast
      ? createPortal(
          <div style={serviceToastStyle} role="status" aria-live="polite">
            {serviceToast}
          </div>,
          document.body
        )
      : null;

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
                    <h1 style={{ ...titleStyle, margin: 0 }}>
                      {group.name ?? ""}
                    </h1>

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
          </div>
        </main>

        {subscriptionModal}
        {toastNode}
      </>
    );
  }

  const isPublicGroup = group.visibility === "public";
  const canViewPublicFeed = isPublicGroup || effectiveIsMember || isOwner;

    const canCreatePosts =
    isOwner ||
    (effectiveIsMember &&
      (memberStatus === "active" || memberStatus === "subscribed") &&
      currentPostingMode === "members");

  const canCommentOnPosts =
    isOwner ||
    (effectiveIsMember &&
      (memberStatus === "active" || memberStatus === "subscribed") &&
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

          .group-services-wrap {
            margin-top: 14px;
            width: 100%;
            max-width: 720px;
            margin-left: auto;
            margin-right: auto;
            min-width: 0;
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

            .group-subnav-wrap,
            .group-services-wrap {
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

              <DonationEntryPoint
                donation={normalizedCurrentDonation}
                isLoggedIn={!!user}
                onRequireLogin={redirectToLogin}
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
                  <h1 style={{ ...titleStyle, margin: 0 }}>
                    {group.name ?? ""}
                  </h1>

                  {!!group.description && (
                    <div className="group-description" style={textStyle}>
                      {group.description}
                    </div>
                  )}

                  <div className="group-visibility" style={microText}>
                    {visibilityLabel(String(group.visibility ?? ""))}
                  </div>

                  {!isOwner &&
                    effectiveIsMember &&
                    normalizedCurrentOfferings.length > 0 && (
                      <div className="group-services-wrap">
                        <CreatorServicesMenu
                          services={normalizedCurrentOfferings}
                          contextType="group"
                          groupId={groupId}
                          viewerMembershipStatus={memberStatus}
                          viewerCanRequest={!isOwner && effectiveIsMember}
                        />
                      </div>
                    )}

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
                    currentVisibility={normalizeVisibility(group.visibility)}
                    currentMonetization={normalizedCurrentMonetization}
                    currentOfferings={normalizedCurrentOfferings}
                    currentDonation={normalizedCurrentDonation}
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

      {greetingModal}
      {subscriptionModal}
      {toastNode}

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