"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslations } from "next-intl";
import type { User } from "firebase/auth";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";

import type {
  CanonicalMemberStatus,
  Community,
} from "./GroupsSearchPanel";

type SearchGroupsResultsProps = {
  fontStack: string;
  currentUser: User | null;
  communities: Community[];
  memberMap: Record<string, CanonicalMemberStatus>;
  reqMap: Record<string, boolean>;
  onNavigate: (href: string) => void;
  onJoinPublic: (groupId: string) => Promise<void>;
  onRequestPrivate: (groupId: string) => Promise<void>;
  onCancelRequest: (groupId: string) => Promise<void>;
  onLeave: (groupId: string, ownerId?: string) => Promise<void>;
  onRefresh?: () => Promise<void> | void;
};

type GroupVisibilityFilter = "public" | "private";
type MonetizationFilter = "free" | "paid";

function getDescriptionPreview(value?: string) {
  const clean = (value ?? "").trim().replace(/\s+/g, " ");

  if (!clean) return "";
  if (clean.length <= 60) return clean;

  return `${clean.slice(0, 80).trim()}...`;
}

type SearchServiceDot = {
  key: string;
  color: string;
  title: string;
};

const SEARCH_SERVICE_COLORS = {
  saludo: "#7DD3FC",
  consejo: "#FACC15",
  meetGreet: "#A78BFA",
  exclusiveSession: "#F472B6",
  weddingDonation: "#C084FC",
  generalDonation: "#FB7185",
};

function getOfferingByType(
  offerings: Array<Record<string, unknown>> | Record<string, unknown> | undefined,
  type: string
): Record<string, unknown> | null {
  if (!offerings) return null;

  if (Array.isArray(offerings)) {
    return offerings.find((item) => item?.type === type) ?? null;
  }

  const direct = offerings[type];

  if (typeof direct === "object" && direct !== null) {
    return direct as Record<string, unknown>;
  }

  if (direct === true) {
    return { enabled: true, visible: true };
  }

  return null;
}

function isVisibleEnabledService(service: Record<string, unknown> | null): boolean {
  if (!service) return false;

  const enabled = service.enabled === true;
  const visible = service.visible !== false;

  return enabled && visible;
}

type ServicesDotT = (key: string) => string;

function buildSearchServiceDots(
  source: {
    offerings?: Array<Record<string, unknown>> | Record<string, unknown>;
    donation?: Record<string, unknown>;
    monetization?: Record<string, unknown>;
    greetingsEnabled?: boolean;
    adviceEnabled?: boolean;
    digitalMeetGreetEnabled?: boolean;
    customClassEnabled?: boolean;
  } | undefined,
  t: ServicesDotT
): SearchServiceDot[] {
  const offerings = source?.offerings;
  const donation = source?.donation ?? {};
  const monetization = source?.monetization ?? {};

  const dots: SearchServiceDot[] = [];

  const saludoEnabled =
    isVisibleEnabledService(getOfferingByType(offerings, "saludo")) ||
    source?.greetingsEnabled === true ||
    monetization.greetingsEnabled === true;

  const consejoEnabled =
    isVisibleEnabledService(getOfferingByType(offerings, "consejo")) ||
    source?.adviceEnabled === true ||
    monetization.adviceEnabled === true;

  const meetGreetEnabled =
    isVisibleEnabledService(
      getOfferingByType(offerings, "meet_greet_digital")
    ) ||
    source?.digitalMeetGreetEnabled === true ||
    monetization.digitalMeetGreetEnabled === true;

  const exclusiveSessionEnabled =
    isVisibleEnabledService(
      getOfferingByType(offerings, "clase_personalizada")
    ) ||
    source?.customClassEnabled === true ||
    monetization.customClassEnabled === true;

  if (saludoEnabled) {
    dots.push({
      key: "saludo",
      color: SEARCH_SERVICE_COLORS.saludo,
      title: t("requestGreeting"),
    });
  }

  if (consejoEnabled) {
    dots.push({
      key: "consejo",
      color: SEARCH_SERVICE_COLORS.consejo,
      title: t("requestAdvice"),
    });
  }

  if (meetGreetEnabled) {
    dots.push({
      key: "meet_greet_digital",
      color: SEARCH_SERVICE_COLORS.meetGreet,
      title: t("requestMeetGreet"),
    });
  }

  if (exclusiveSessionEnabled) {
    dots.push({
      key: "clase_personalizada",
      color: SEARCH_SERVICE_COLORS.exclusiveSession,
      title: t("requestSession"),
    });
  }

  if (
    donation.enabled === true &&
    donation.visible !== false &&
    donation.mode === "wedding"
  ) {
    dots.push({
      key: "wedding_donation",
      color: SEARCH_SERVICE_COLORS.weddingDonation,
      title: t("weddingDonation"),
    });
  }

  if (
    donation.enabled === true &&
    donation.visible !== false &&
    donation.mode === "general"
  ) {
    dots.push({
      key: "general_donation",
      color: SEARCH_SERVICE_COLORS.generalDonation,
      title: t("generalDonation"),
    });
  }

  return dots;
}

function ServiceDots({ dots, ariaLabel }: { dots: SearchServiceDot[]; ariaLabel: string }) {
  if (dots.length === 0) return null;

  return (
    <span
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
      }}
    >
      {dots.map((dot) => (
        <span
          key={dot.key}
          title={dot.title}
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            border: "none",
            background: dot.color,
            boxSizing: "border-box",
            display: "inline-flex",
            flexShrink: 0,
          }}
        />
      ))}
    </span>
  );
}

function isJoinedStatus(status: CanonicalMemberStatus) {
  return status === "active" || status === "subscribed" || status === "muted";
}

function isBlockedStatus(status: CanonicalMemberStatus) {
  return status === "banned" || status === "removed";
}

function membershipStatusKey(status: CanonicalMemberStatus): string {
  if (status === "active") return "statusActive";
  if (status === "muted") return "statusMuted";
  if (status === "banned") return "statusBanned";
  if (status === "removed") return "statusRemoved";
  return "";
}

function resolveSubscriptionEnabled(group: Community) {
  const monetization = group.monetization as Record<string, unknown> | undefined;

  return (
    monetization?.subscriptionsEnabled === true ||
    monetization?.isPaid === true
  );
}

function resolveSubscriptionPrice(group: Community): number | null {
  const monetization = group.monetization as Record<string, unknown> | undefined;
  const v = monetization?.subscriptionPriceMonthly ?? monetization?.priceMonthly ?? null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function resolveSubscriptionCurrency(group: Community): string | null {
  const monetization = group.monetization as Record<string, unknown> | undefined;
  const v = monetization?.subscriptionCurrency ?? monetization?.currency ?? null;
  return typeof v === "string" ? v : null;
}

function isPaidPrivateGroup(group: Community) {
  return group.visibility === "private" && resolveSubscriptionEnabled(group);
}

export default function SearchGroupsResults({
  fontStack,
  currentUser,
  communities,
  memberMap,
  reqMap,
  onNavigate,
  onJoinPublic,
  onRequestPrivate,
  onCancelRequest,
  onLeave,
  onRefresh,
}: SearchGroupsResultsProps) {
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");
  const priceFmt = usePriceFormat();

const [isMobile, setIsMobile] = useState(false);
const [isFiltersOpen, setIsFiltersOpen] = useState(false);
const [visibleCount, setVisibleCount] = useState(10);
const [visibilityFilters, setVisibilityFilters] = useState<
    GroupVisibilityFilter[]
  >([]);
  const [monetizationFilters, setMonetizationFilters] = useState<
    MonetizationFilter[]
  >([]);

const filtersPanelRef = useRef<HTMLDivElement | null>(null);
const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!filtersPanelRef.current) return;
      if (!filtersPanelRef.current.contains(event.target as Node)) {
        setIsFiltersOpen(false);
      }
    }

    if (isFiltersOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isFiltersOpen]);

  useEffect(() => {
  function handleResize() {
    setIsMobile(window.innerWidth <= 640);
  }

  handleResize();

  window.addEventListener("resize", handleResize);

  return () => {
    window.removeEventListener("resize", handleResize);
  };
}, []);

const shellStyle: CSSProperties = {
  minHeight: 0,
  overflow: "visible",
  padding: "0 4px 14px",
  display: "grid",
  gap: 10,
  position: "relative",
};

  const emptyStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "15px 16px",
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 1.45,
  };

  const sectionStyle: CSSProperties = {
    display: "grid",
    gap: 8,
  };

  const sectionTitleStyle: CSSProperties = {
    margin: "0 0 2px 0",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.54)",
    padding: "0 2px",
  };

  const topBarStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 12,
    alignItems: "center",
    position: "relative",
    marginTop: -40,
    marginBottom: 2,
  };

  const activeFiltersWrapStyle: CSSProperties = {
    minHeight: 36,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: "0 2px",
    pointerEvents: "auto",
  };

  const activeFilterPillStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    minHeight: 30,
    padding: "5px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };

  const activeFilterRemoveStyle: CSSProperties = {
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.72)",
    cursor: "pointer",
    padding: 0,
    fontSize: 14,
    lineHeight: 1,
  };

  const filtersButtonStyle: CSSProperties = {
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12.5,
    fontFamily: fontStack,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    whiteSpace: "nowrap",
    transform: "translateY(18px)",
  };

  const filtersPanelStyle: CSSProperties = {
    position: "absolute",
    top: 44,
    right: 0,
    width: 260,
    maxWidth: "calc(100vw - 24px)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(10,10,10,0.98)",
    boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
    padding: 12,
    display: "grid",
    gap: 12,
    zIndex: 20,
    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
  };

  const filterBlockStyle: CSSProperties = {
    display: "grid",
    gap: 8,
  };

  const filterBlockTitleStyle: CSSProperties = {
    margin: 0,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.52)",
  };

  const filterOptionButtonStyle: CSSProperties = {
    width: "100%",
    minHeight: 36,
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: fontStack,
    textAlign: "left",
  };

  const filterOptionActiveStyle: CSSProperties = {
    ...filterOptionButtonStyle,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "rgba(255,255,255,0.11)",
  };

  const filterActionsRowStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    paddingTop: 4,
  };

  const filterActionSecondaryStyle: CSSProperties = {
    flex: 1,
    minHeight: 34,
    padding: "7px 10px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: fontStack,
  };

  const filterActionPrimaryStyle: CSSProperties = {
    ...filterActionSecondaryStyle,
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.20)",
  };

const cardStyle: CSSProperties = {
  borderRadius: 0,
  border: "none",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  background: "transparent",
  padding: "10px 2px",
  display: "grid",
  gap: 8,
  cursor: "pointer",
};

  const mainGridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
  };

  const mainInfoStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  };

  const contentStyle: CSSProperties = {
    minWidth: 0,
    display: "grid",
    gap: 5,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const descriptionPreviewStyle: CSSProperties = {
    display: "block",
    margin: "-1px 0 0",
    maxWidth: 420,
    overflow: "hidden",
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontWeight: 400,
    lineHeight: 1.25,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  };

  const metaRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  };

  const inlineMetaStyle: CSSProperties = {
    fontSize: 11,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.25,
  };

  const dangerMetaStyle: CSSProperties = {
    ...inlineMetaStyle,
    color: "rgba(255,176,176,0.9)",
  };

  const actionWrapStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    flexWrap: "nowrap",
    flexShrink: 0,
  };

  const primaryButtonStyle: CSSProperties = {
    minHeight: 34,
    padding: "7px 11px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "#fff",
    color: "#000",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 12,
    fontFamily: fontStack,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
  };

  const secondaryButtonStyle: CSSProperties = {
    minHeight: 34,
    padding: "7px 11px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 12,
    fontFamily: fontStack,
    whiteSpace: "nowrap",
  };

  function toggleVisibilityFilter(filter: GroupVisibilityFilter) {
    setVisibilityFilters((prev) =>
      prev.includes(filter)
        ? prev.filter((item) => item !== filter)
        : [...prev, filter]
    );
  }

  function toggleMonetizationFilter(filter: MonetizationFilter) {
    setMonetizationFilters((prev) =>
      prev.includes(filter)
        ? prev.filter((item) => item !== filter)
        : [...prev, filter]
    );
  }

  function clearAllFilters() {
    setVisibilityFilters([]);
    setMonetizationFilters([]);
  }

  function matchesVisibilityFilters(group: Community) {
    if (visibilityFilters.length === 0) return true;
    if (visibilityFilters.includes("public") && group.visibility === "public") {
      return true;
    }
    if (
      visibilityFilters.includes("private") &&
      group.visibility === "private"
    ) {
      return true;
    }
    return false;
  }

  function matchesMonetizationFilters(group: Community) {
    if (monetizationFilters.length === 0) return true;

    const isPaid = resolveSubscriptionEnabled(group);
    const isFree = !isPaid;

    if (monetizationFilters.includes("paid") && isPaid) return true;
    if (monetizationFilters.includes("free") && isFree) return true;

    return false;
  }

  const filteredByUi = useMemo(() => {
    return communities.filter((group) => {
      return matchesVisibilityFilters(group) && matchesMonetizationFilters(group);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communities, visibilityFilters, monetizationFilters]);

  const displayGroups = useMemo(() => {
    return filteredByUi.slice(0, visibleCount);
  }, [filteredByUi, visibleCount]);

  const hasMoreGroups = visibleCount < filteredByUi.length;

  useEffect(() => {
    setVisibleCount(10);
  }, [communities, visibilityFilters, monetizationFilters]);

  useEffect(() => {
    const target = loadMoreRef.current;

    if (!target || !hasMoreGroups) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const firstEntry = entries[0];

        if (firstEntry?.isIntersecting) {
          setVisibleCount((prev) => prev + 10);
        }
      },
      {
        root: null,
        rootMargin: "120px",
        threshold: 0.1,
      }
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [hasMoreGroups, displayGroups.length]);

  const activeFilters = [
    ...visibilityFilters.map((value) => ({
      key: `visibility-${value}`,
      label: value === "public" ? tGroups("publicShort") : tGroups("privateShort"),
      onRemove: () => toggleVisibilityFilter(value),
    })),
    ...monetizationFilters.map((value) => ({
      key: `monetization-${value}`,
      label: value === "free" ? tCommon("free") : tCommon("premium"),
      onRemove: () => toggleMonetizationFilter(value),
    })),
  ];

  function renderFiltersPanel() {
    return (
      <div ref={filtersPanelRef} className="search-groups-filters-anchor">
        <button
          type="button"
          style={filtersButtonStyle}
          onClick={() => setIsFiltersOpen((prev) => !prev)}
        >
          <span aria-hidden="true">🧮</span>
          {tCommon("filters")}
        </button>

        {isFiltersOpen && (
          <div style={filtersPanelStyle} className="search-groups-filters-panel">
            <div style={filterBlockStyle}>
              <p style={filterBlockTitleStyle}>{tGroups("visibility")}</p>

              <button
                type="button"
                style={
                  visibilityFilters.includes("public")
                    ? filterOptionActiveStyle
                    : filterOptionButtonStyle
                }
                onClick={() => toggleVisibilityFilter("public")}
              >
                {tGroups("publicShort")}
              </button>

              <button
                type="button"
                style={
                  visibilityFilters.includes("private")
                    ? filterOptionActiveStyle
                    : filterOptionButtonStyle
                }
                onClick={() => toggleVisibilityFilter("private")}
              >
                {tGroups("privateShort")}
              </button>
            </div>

            <div style={filterBlockStyle}>
              <p style={filterBlockTitleStyle}>{tCommon("monetization")}</p>

              <button
                type="button"
                style={
                  monetizationFilters.includes("free")
                    ? filterOptionActiveStyle
                    : filterOptionButtonStyle
                }
                onClick={() => toggleMonetizationFilter("free")}
              >
                {tCommon("free")}
              </button>

              <button
                type="button"
                style={
                  monetizationFilters.includes("paid")
                    ? filterOptionActiveStyle
                    : filterOptionButtonStyle
                }
                onClick={() => toggleMonetizationFilter("paid")}
              >
                {tCommon("premium")}
              </button>
            </div>

            <div style={filterActionsRowStyle}>
              <button
                type="button"
                style={filterActionSecondaryStyle}
                onClick={clearAllFilters}
              >
                {tCommon("clear")}
              </button>

              <button
                type="button"
                style={filterActionPrimaryStyle}
                onClick={() => setIsFiltersOpen(false)}
              >
                {tCommon("done")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderGroupCard(group: Community) {
    const isOwner =
      !!currentUser && !!group.ownerId && group.ownerId === currentUser.uid;

    const membershipStatus = isOwner ? "active" : memberMap[group.id] ?? null;
    const isMember = isOwner || isJoinedStatus(membershipStatus);
    const isBlocked = !isOwner && isBlockedStatus(membershipStatus);

    const isPrivate = group.visibility === "private";
    const isPublic = group.visibility === "public";
    const hasPendingReq = !!reqMap[group.id];
    const paidPrivate = isPaidPrivateGroup(group);

const visLabel =
  group.visibility === "public"
    ? tGroups("publicLabel")
    : group.visibility === "private"
      ? tGroups("privateLabel")
      : tGroups("hiddenLabel");

const price = resolveSubscriptionPrice(group);
const cur = resolveSubscriptionCurrency(group);
const serviceDots = buildSearchServiceDots(group, tServices);

    return (
      <article
        key={group.id}
        style={cardStyle}
        className="search-result-item"
        onClick={() => onNavigate(`/groups/${group.id}`)}
      >
        <div style={mainGridStyle} className="search-result-grid">
          <div style={mainInfoStyle} className="search-result-main">
            <LiveRingAvatar
              entityId={group.id}
              entityType="group"
              currentUserId={currentUser?.uid ?? null}
              photoURL={group.avatarUrl ?? null}
              displayName={group.name ?? tGroups("title")}
              size={42}
              onClick={(e) => { e.stopPropagation(); onNavigate(`/groups/${group.id}`); }}
            />

            <div style={contentStyle} className="search-result-content">
<h3
  style={{
    ...titleStyle,
    display: "flex",
    alignItems: "baseline",
    gap: 5,
    minWidth: 0,
  }}
  className="search-result-name"
>
  <span
    style={{
      minWidth: 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      color: "#fff",
      fontSize: 14,
      fontWeight: 600,
      lineHeight: 1.2,
    }}
  >
    {group.name ?? tGroups("title")}
  </span>

  {!isMobile ? (
    <>
      <span
        style={{
          flexShrink: 0,
          color: "rgba(255,255,255,0.42)",
          fontSize: 11,
          fontWeight: 500,
          lineHeight: 1,
        }}
      >
        ·
      </span>

      <span
        style={{
          flexShrink: 0,
          color: "rgba(255,255,255,0.48)",
          fontSize: 11,
          fontWeight: 500,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
        }}
      >
        {visLabel}
      </span>
    </>
  ) : null}

  {!isMobile ? <ServiceDots dots={serviceDots} ariaLabel={tCommon("activeServices")} /> : null}
</h3>

{isMobile ? (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      minWidth: 0,
    }}
  >
    <span
      style={{
        color: "rgba(255,255,255,0.48)",
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      {visLabel}
    </span>

    {serviceDots.length > 0 ? (
      <>
        <span
          style={{
            flexShrink: 0,
            color: "rgba(255,255,255,0.42)",
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1,
          }}
        >
          ·
        </span>

        <ServiceDots dots={serviceDots} ariaLabel={tCommon("activeServices")} />
      </>
    ) : null}
  </div>
) : null}
{!isMobile && getDescriptionPreview(group.description) ? (
  <p
    style={descriptionPreviewStyle}
    className="search-result-description-preview"
  >
    {getDescriptionPreview(group.description)}
  </p>
) : null}


              <div style={metaRowStyle} className="search-result-meta">
                {!isOwner && isBlocked && (
                  <span style={dangerMetaStyle}>
                    ({membershipStatusKey(membershipStatus) ? tGroups(membershipStatusKey(membershipStatus)) : ""})
                  </span>
                )}
              </div>
            </div>
          </div>

          <div
            style={actionWrapStyle}
            className="search-result-actions"
            onClick={(e) => e.stopPropagation()}
          >
            {!isOwner && !isMember && !isBlocked && isPublic && (
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => void onJoinPublic(group.id)}
              >
                {tGroups("join")}
              </button>
            )}

            {!isOwner && !isMember && !isBlocked && paidPrivate && (
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => onNavigate(`/groups/${group.id}`)}
              >
                💎 {tGroups("subscribe")}
                {price != null ? ` · ${priceFmt.format(price, { baseCurrency: cur ?? "MXN" })}` : ""}
              </button>
            )}

            {!isOwner && !isMember && !isBlocked && isPrivate && !paidPrivate && (
              <>
                {!hasPendingReq ? (
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => void onRequestPrivate(group.id)}
                  >
                    {tGroups("requestAccess")}
                  </button>
                ) : (
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => void onCancelRequest(group.id)}
                  >
                    {tCommon("cancel")}
                  </button>
                )}
              </>
            )}

            {isMember && !isOwner && (
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => void onLeave(group.id, group.ownerId)}
              >
                {tCommon("leave")}
              </button>
            )}
          </div>
        </div>
      </article>
    );
  }

  if (filteredByUi.length === 0) {
    return (
      <RefreshableArea
        onRefresh={onRefresh ?? (() => {})}
        enabled={isMobile && Boolean(onRefresh)}
        indicatorTop="calc(env(safe-area-inset-top) + 116px)"
      >
        <section style={shellStyle}>
        <div style={topBarStyle} className="search-groups-topbar">
          <div style={activeFiltersWrapStyle}>
            {activeFilters.length > 0
              ? activeFilters.map((filter) => (
                  <span key={filter.key} style={activeFilterPillStyle}>
                    {filter.label}
                    <button
                      type="button"
                      style={activeFilterRemoveStyle}
                      onClick={filter.onRemove}
                      aria-label={tCommon("removeFilter", { label: filter.label })}
                    >
                      ×
                    </button>
                  </span>
                ))
              : null}
          </div>

          {renderFiltersPanel()}
        </div>

        <div style={emptyStyle}>
          {tGroups("noGroupsFound")}
        </div>

        <style jsx>{`
          .search-groups-filters-anchor {
            position: relative;
          }

          @media (max-width: 640px) {
            .search-groups-topbar {
              grid-template-columns: minmax(0, 1fr);
            }

            .search-groups-filters-anchor {
              width: 100%;
            }

            .search-groups-filters-anchor button {
              width: 100%;
              justify-content: center;
            }

            .search-groups-filters-panel {
              position: static !important;
              width: 100% !important;
              max-width: 100% !important;
              margin-top: 10px;
            }
          }
        `}</style>
        </section>
      </RefreshableArea>
    );
  }

  return (
    <RefreshableArea
      onRefresh={onRefresh ?? (() => {})}
      enabled={isMobile && Boolean(onRefresh)}
      indicatorTop="calc(env(safe-area-inset-top) + 116px)"
    >
      <section style={shellStyle}>
      <div style={topBarStyle} className="search-groups-topbar">
        <div style={activeFiltersWrapStyle}>
          {activeFilters.map((filter) => (
            <span key={filter.key} style={activeFilterPillStyle}>
              {filter.label}
              <button
                type="button"
                style={activeFilterRemoveStyle}
                onClick={filter.onRemove}
                aria-label={tCommon("removeFilter", { label: filter.label })}
              >
                ×
              </button>
            </span>
          ))}
        </div>

        {renderFiltersPanel()}
      </div>

{displayGroups.length > 0 && (
  <div style={sectionStyle}>
    <h2 style={sectionTitleStyle}>
      {tGroups("matches")}
    </h2>

    {displayGroups.map(renderGroupCard)}
  </div>
)}

{hasMoreGroups ? (
  <div
    ref={loadMoreRef}
    aria-hidden="true"
    style={{
      width: "100%",
      height: 1,
    }}
  />
) : null}

      <style jsx>{`
        .search-groups-filters-anchor {
          position: relative;
        }

        .search-result-item {
          transition: background 0.16s ease;
        }

        .search-result-item:hover {
          background: rgba(255, 255, 255, 0.035) !important;
        }

        .search-result-name-with-meta {
          display: flex;
          align-items: baseline;
          gap: 5px;
          min-width: 0;
        }

        .search-result-name-text {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

.search-result-name-dot {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.42) !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  line-height: 1 !important;
}

.search-result-name-visibility {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.48) !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  line-height: 1.2 !important;
  white-space: nowrap;
}

        .visibility-mobile {
          display: none;
        }

        .search-groups-service-dots {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }

        .search-groups-service-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          border: none;
          box-sizing: border-box;
          display: inline-flex;
          flex-shrink: 0;
        }

        .service-dots-desktop {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
        }

        .service-dots-mobile {
          display: none;
        }

        .mobile-service-separator {
          color: rgba(255, 255, 255, 0.34);
          font-size: 10px;
          line-height: 1;
          flex-shrink: 0;
        }

        .mobile-visibility-label {
          color: rgba(255, 255, 255, 0.48);
          font-size: 10px;
          font-weight: 500;
          line-height: 1.2;
          white-space: nowrap;
        }

        @media (max-width: 640px) {
          .search-groups-topbar {
            grid-template-columns: minmax(0, 1fr);
          }

          .search-groups-filters-anchor {
            width: 100%;
          }

          .search-groups-filters-anchor button {
            width: 100%;
            justify-content: center;
          }

          .search-groups-filters-panel {
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            margin-top: 10px;
          }

.search-result-item {
  padding: 10px 2px !important;
}

          .search-result-grid {
            grid-template-columns: minmax(0, 1fr) auto !important;
            align-items: center !important;
            gap: 8px !important;
          }

          .search-result-main {
            gap: 8px !important;
            align-items: center !important;
          }

          .search-result-avatar {
            width: 38px !important;
            height: 38px !important;
          }

          .search-result-content {
            min-width: 0;
          }

          .search-result-name {
            font-size: 13px !important;
          }

          .search-result-name-visibility {
            font-size: 10px;
          }

          .search-result-description-preview {
            display: none !important;
          }

          .visibility-desktop {
            display: none;
          }

          .visibility-mobile {
            display: none;
          }

          .service-dots-mobile {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-height: 14px;
            margin-top: -1px;
          }

          .service-dots-mobile .search-groups-service-dots {
            gap: 4px;
          }

          .service-dots-mobile .search-groups-service-dot {
            width: 7px;
            height: 7px;
          }

          .search-result-actions {
            justify-content: flex-end !important;
            width: auto !important;
            flex-wrap: nowrap !important;
          }

          .search-result-actions button {
            min-height: 32px !important;
            padding: 6px 10px !important;
            font-size: 11px !important;
          }
        }
      `}</style>
      </section>
    </RefreshableArea>
  );
}