"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { joinGroup } from "@/lib/groups/membership";
import { requestToJoin } from "@/lib/groups/joinRequests";
import {
  GROUP_CATEGORY_LABELS,
  GROUP_CATEGORY_OPTIONS,
  type CanonicalGroupCategory,
  type Group,
} from "@/types/group";
import {
  completeRecommendationsOnboarding,
  fetchRecommendedGroupsForUser,
  invalidateRecommendationCache,
  onRecommendationCacheInvalidated,
  recommendationEngineConstants,
  trackGroupRecommendationSignalFromGroup,
} from "./recommendation-engine";
import type {
  RecommendationFetchResult,
  RecommendationGroupCard,
  RecommendationJoinState,
  RecommendationRailContext,
} from "./types";

type Props = {
  currentUserId: string;
  context: RecommendationRailContext;
  title?: string;
  subtitle?: string;
  emptySearchTerm?: string;
  onCreateGroup?: () => void;
  className?: string;
};

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

const cardStyles = {
  position: "relative" as const,
  minWidth: 200,
  maxWidth: 200,
  flexShrink: 0,
  scrollSnapAlign: "start" as const,
  color: "#fff",
};

function getDefaultTitle() {
  return "Comunidades recomendadas para ti";
}

function getDefaultSubtitle(context: RecommendationRailContext) {
  switch (context) {
    case "search_empty":
      return "Explora comunidades afines o crea la tuya.";
    case "profile":
      return "Basado en tus intereses y comunidades relacionadas.";
    case "group":
      return "Descubre otras comunidades similares.";
    case "home":
    default:
      return "Te mostramos comunidades en función de tus categorías e historial.";
  }
}

async function resolveJoinState(
  groupId: string,
  userId: string,
  visibility: Group["visibility"]
): Promise<RecommendationJoinState> {
  const memberSnap = await getDoc(doc(db, "groups", groupId, "members", userId));
  if (memberSnap.exists()) return "joined";

  if (visibility === "private") {
    const requestSnap = await getDoc(
      doc(db, "groups", groupId, "joinRequests", userId)
    );
    if (requestSnap.exists()) return "pending";
    return "request";
  }

  return "join";
}

function getRecommendationMonetization(
  group: RecommendationGroupCard
): Record<string, unknown> | null {
  const candidate = (group as RecommendationGroupCard & {
    monetization?: unknown;
  }).monetization;

  if (!candidate || typeof candidate !== "object") return null;
  return candidate as Record<string, unknown>;
}

function resolveSubscriptionEnabled(group: RecommendationGroupCard) {
  const monetization = getRecommendationMonetization(group);
  return (
    monetization?.subscriptionsEnabled === true ||
    monetization?.isPaid === true
  );
}

function resolveSubscriptionPrice(group: RecommendationGroupCard) {
  const monetization = getRecommendationMonetization(group);

  const subscriptionPrice = monetization?.subscriptionPriceMonthly;
  if (typeof subscriptionPrice === "number" && Number.isFinite(subscriptionPrice)) {
    return subscriptionPrice;
  }

  const legacyPrice = monetization?.priceMonthly;
  return typeof legacyPrice === "number" && Number.isFinite(legacyPrice)
    ? legacyPrice
    : null;
}

function resolveSubscriptionCurrency(group: RecommendationGroupCard) {
  const monetization = getRecommendationMonetization(group);

  const subscriptionCurrency = monetization?.subscriptionCurrency;
  if (typeof subscriptionCurrency === "string") {
    return subscriptionCurrency;
  }

  const legacyCurrency = monetization?.currency;
  return typeof legacyCurrency === "string" ? legacyCurrency : null;
}

function formatSubscriptionPrice(group: RecommendationGroupCard) {
  const price = resolveSubscriptionPrice(group);
  const currency = resolveSubscriptionCurrency(group);

  if (price == null || !currency) return null;

  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

function GroupCategoryPill({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        border: selected
          ? "1px solid rgba(255,255,255,0.9)"
          : "1px solid rgba(255,255,255,0.10)",
        background: selected ? "#ffffff" : "rgba(42, 42, 46, 0.95)",
        color: selected ? "#08111d" : "#ffffff",
        borderRadius: 999,
        padding: "8px 12px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontFamily: fontStack,
      }}
    >
      {label}
    </button>
  );
}

function JoinButton({
  state,
  onClick,
  loading,
  isPaidSubscriptionPrivate,
}: {
  state: RecommendationJoinState;
  onClick: () => void;
  loading: boolean;
  isPaidSubscriptionPrivate: boolean;
}) {
  const label =
    state === "joined"
      ? "Unido"
      : state === "pending"
        ? "Solicitud enviada"
        : state === "request"
          ? isPaidSubscriptionPrivate
            ? "Suscribirme"
            : "Solicitar"
          : "Unirme";

  const isInactive = loading || state === "joined" || state === "pending";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isInactive}
      style={{
        width: "100%",
        borderRadius: 12,
        padding: "10px 12px",
        border: isInactive
          ? "1px solid rgba(255,255,255,0.18)"
          : "none",
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: "-0.01em",
        cursor: isInactive ? "default" : "pointer",
        background: isInactive
          ? "rgba(255,255,255,0.14)"
          : "#ffffff",
        color: isInactive ? "rgba(255,255,255,0.70)" : "#08111d",
        fontFamily: fontStack,
        backdropFilter: isInactive ? "blur(12px)" : "none",
        WebkitBackdropFilter: isInactive ? "blur(12px)" : "none",
        transition: "background 0.18s ease, color 0.18s ease",
      }}
    >
      {loading ? "Procesando..." : label}
    </button>
  );
}

function GroupCard({
  group,
  joinState,
  loading,
  onJoin,
}: {
  group: RecommendationGroupCard;
  joinState: RecommendationJoinState;
  loading: boolean;
  onJoin: () => void;
}) {
  const categoryLabel = group.category
    ? GROUP_CATEGORY_LABELS[group.category]
    : "Sin categoría";

  const visibilityLabel =
    group.visibility === "public"
      ? "Comunidad pública"
      : group.visibility === "private"
        ? "Comunidad privada"
        : "Comunidad oculta";

  const isPaidSubscriptionPrivate =
    group.visibility === "private" && resolveSubscriptionEnabled(group);

  const subscriptionPriceLabel = isPaidSubscriptionPrivate
    ? formatSubscriptionPrice(group)
    : null;

  return (
    <div style={cardStyles}>
      {/* Cover card — the card IS the image, no gray wrapper */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "9 / 11",
          borderRadius: 20,
          overflow: "hidden",
          background: "#0d0d0f",
          boxShadow:
            "0 24px 52px rgba(0,0,0,0.42), 0 6px 16px rgba(0,0,0,0.28)",
        }}
      >
        {/* Cover image / gradient background */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: group.coverUrl
              ? `url(${group.coverUrl}) center / cover no-repeat`
              : "linear-gradient(135deg, #1a1a20 0%, #26262e 55%, #111116 100%)",
            transform: "scale(1.01)",
          }}
        />

        {/* Gradient overlay — stronger at the bottom for text + button legibility */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.18) 28%, rgba(0,0,0,0.62) 58%, rgba(0,0,0,0.90) 80%, rgba(0,0,0,0.97) 100%)",
          }}
        />

        {/* Navigable area — full card minus button zone */}
        <Link
          href={`/groups/${group.id}`}
          style={{
            position: "absolute",
            inset: 0,
            bottom: 60,
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "14px 12px 0",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          {/* Avatar */}
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: "50%",
              overflow: "hidden",
              background: "#111",
              border: "3px solid rgba(255,255,255,0.14)",
              boxShadow: "0 8px 22px rgba(0,0,0,0.50)",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              fontWeight: 700,
              fontSize: 20,
              flexShrink: 0,
              fontFamily: fontStack,
            }}
          >
            {group.avatarUrl ? (
              <img
                src={group.avatarUrl}
                alt={`Avatar de ${group.name}`}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              group.name.slice(0, 1).toUpperCase()
            )}
          </div>

          {/* Name + meta — tight gap below avatar */}
          <div
            style={{
              marginTop: 10,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingBottom: 6,
            }}
          >
            {/* Name — max 2 lines, natural height */}
            <strong
              style={{
                fontSize: 14,
                lineHeight: 1.18,
                color: "#fff",
                maxWidth: "100%",
                wordBreak: "break-word",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textAlign: "center",
                fontFamily: fontStack,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                flexShrink: 0,
              }}
            >
              {group.name}
            </strong>

            {/* Visibility — always 1 line tall */}
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.72)",
                fontFamily: fontStack,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {visibilityLabel}
            </div>

            {/* Category — always 1 line tall */}
            <div
              style={{
                marginTop: 3,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.52)",
                fontFamily: fontStack,
                fontWeight: 400,
                flexShrink: 0,
              }}
            >
              {categoryLabel}
            </div>

            {/* Price — always 1 line tall, empty when free */}
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.88)",
                fontFamily: fontStack,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {subscriptionPriceLabel ? `${subscriptionPriceLabel} / mes` : ""}
            </div>
          </div>
        </Link>

        {/* Join button — floats at the bottom of the card, above the Link */}
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            right: 10,
            zIndex: 2,
          }}
        >
          <JoinButton
            state={joinState}
            onClick={onJoin}
            loading={loading}
            isPaidSubscriptionPrivate={isPaidSubscriptionPrivate}
          />
        </div>
      </div>
    </div>
  );
}

export default function GroupRecommendationsRail({
  currentUserId,
  context,
  title,
  subtitle,
  emptySearchTerm,
  onCreateGroup,
  className,
}: Props) {
  const router = useRouter();
  const [selectedCategories, setSelectedCategories] = useState<
    CanonicalGroupCategory[]
  >([]);
  const [result, setResult] = useState<RecommendationFetchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinStates, setJoinStates] = useState<
    Record<string, RecommendationJoinState>
  >({});
  const [joinLoadingByGroup, setJoinLoadingByGroup] = useState<
    Record<string, boolean>
  >({});

  const heading = title ?? getDefaultTitle();
  const railSubtitle = subtitle ?? getDefaultSubtitle(context);
  const minCategories = recommendationEngineConstants.MIN_ONBOARDING_CATEGORIES;

  const loadRecommendations = useCallback(async () => {
    if (!currentUserId) {
      setResult(null);
      setJoinStates({});
      setSelectedCategories([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const next = await fetchRecommendedGroupsForUser(currentUserId);
      setResult(next);
      setSelectedCategories(next.selectedCategories);

      if (next.groups.length > 0) {
        const entries = await Promise.all(
          next.groups.map(async (group) => {
            const state = await resolveJoinState(
              group.id,
              currentUserId,
              group.visibility
            );
            return [group.id, state] as const;
          })
        );

        setJoinStates(Object.fromEntries(entries));
      } else {
        setJoinStates({});
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudieron cargar recomendaciones."
      );
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    void loadRecommendations();
  }, [loadRecommendations]);

  // Ref that always points to the latest loadRecommendations — used in the
  // cache-invalidation subscription so we don't need to re-register on every render
  const loadRecommendationsRef = useRef(loadRecommendations);
  loadRecommendationsRef.current = loadRecommendations;

  // When any Rail instance invalidates the shared cache, all instances re-fetch
  useEffect(() => {
    return onRecommendationCacheInvalidated(() => {
      void loadRecommendationsRef.current();
    });
  }, []);

  const toggleCategory = (category: CanonicalGroupCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((item) => item !== category)
        : [...prev, category]
    );
  };

  const handleSaveOnboarding = async () => {
    if (!currentUserId) return;

    setSavingOnboarding(true);
    setError(null);

    try {
      completeRecommendationsOnboarding(currentUserId, selectedCategories);
      // Invalidate shared cache so all Rail instances on this page pick up the new state
      invalidateRecommendationCache(currentUserId);
      // loadRecommendations will be triggered automatically by the invalidation listener
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo guardar la selección."
      );
    } finally {
      setSavingOnboarding(false);
    }
  };

  const handleJoin = async (group: RecommendationGroupCard) => {
    if (!currentUserId) return;

    setJoinLoadingByGroup((prev) => ({ ...prev, [group.id]: true }));
    setError(null);

    try {
      const isPaidSubscriptionPrivate =
        group.visibility === "private" && resolveSubscriptionEnabled(group);

      if (group.visibility === "public") {
        await joinGroup(group.id, currentUserId);
        setJoinStates((prev) => ({ ...prev, [group.id]: "joined" }));
      } else if (isPaidSubscriptionPrivate) {
        router.push(`/groups/${group.id}?service=suscripcion`);
        return;
      } else if (group.visibility === "private") {
        await requestToJoin(group.id, currentUserId);
        setJoinStates((prev) => ({ ...prev, [group.id]: "pending" }));
      }

      trackGroupRecommendationSignalFromGroup({
        uid: currentUserId,
        category: group.category,
        tags: group.tags,
      });

      // Invalidate cache so all Rail instances exclude this group on next fetch
      invalidateRecommendationCache(currentUserId);

      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No se pudo completar la acción.";

      if (message === "GROUP_REQUIRES_SUBSCRIPTION") {
        router.push(`/groups/${group.id}?service=suscripcion`);
        return;
      }

      setError(message);
    } finally {
      setJoinLoadingByGroup((prev) => ({ ...prev, [group.id]: false }));
    }
  };

  const showOnboarding = useMemo(() => {
    return !loading && result && !result.onboardingCompleted;
  }, [loading, result]);

  if (!currentUserId) {
    return null;
  }

  return (
    <section
      className={className}
      style={{ width: "100%", color: "#fff" }}
    >
      {error ? (
        <div
          style={{
            marginBottom: 12,
            borderRadius: 12,
            background: "rgba(255, 80, 80, 0.12)",
            border: "1px solid rgba(255, 80, 80, 0.25)",
            padding: 12,
            fontSize: 13,
            fontFamily: fontStack,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.68)",
            fontFamily: fontStack,
          }}
        >
          Cargando recomendaciones...
        </div>
      ) : null}

      {showOnboarding ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.84)",
              fontFamily: fontStack,
            }}
          >
            Selecciona al menos <strong>{minCategories}</strong> categorías para
            personalizar tus comunidades sugeridas.
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              width: "100%",
            }}
          >
            {GROUP_CATEGORY_OPTIONS.map((option) => (
              <GroupCategoryPill
                key={option.value}
                label={option.label}
                selected={selectedCategories.includes(option.value)}
                onToggle={() => toggleCategory(option.value)}
              />
            ))}
          </div>

          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <button
              type="button"
              onClick={handleSaveOnboarding}
              disabled={
                savingOnboarding || selectedCategories.length < minCategories
              }
              style={{
                border: "none",
                borderRadius: 12,
                padding: "11px 16px",
                fontWeight: 700,
                background:
                  savingOnboarding || selectedCategories.length < minCategories
                    ? "rgba(255,255,255,0.16)"
                    : "#ffffff",
                color:
                  savingOnboarding || selectedCategories.length < minCategories
                    ? "rgba(255,255,255,0.6)"
                    : "#08111d",
                cursor:
                  savingOnboarding || selectedCategories.length < minCategories
                    ? "default"
                    : "pointer",
                fontFamily: fontStack,
              }}
            >
              {savingOnboarding ? "Guardando..." : "Continuar"}
            </button>

            <span
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.62)",
                fontFamily: fontStack,
              }}
            >
              Seleccionadas: {selectedCategories.length}/{minCategories} mínimo
            </span>
          </div>
        </div>
      ) : null}

      {!loading && result?.onboardingCompleted && result.groups.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            scrollSnapType: "x mandatory",
            paddingBottom: 4,
            paddingLeft: 12,
            paddingRight: 12,
          }}
        >
          {result.groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              joinState={joinStates[group.id] ?? "join"}
              loading={Boolean(joinLoadingByGroup[group.id])}
              onJoin={() => handleJoin(group)}
            />
          ))}
        </div>
      ) : null}

      {!loading && result?.onboardingCompleted && result.groups.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "8px 0 2px",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: "rgba(255,255,255,0.68)",
              fontFamily: fontStack,
            }}
          >
            Aún no tenemos comunidades disponibles para recomendarte.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                if (onCreateGroup) {
                  onCreateGroup();
                  return;
                }
                router.push("/groups/new");
              }}
              style={{
                border: "none",
                borderRadius: 12,
                padding: "10px 14px",
                background: "#ffffff",
                color: "#08111d",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: fontStack,
              }}
            >
              Crear comunidad
            </button>

            <button
              type="button"
              onClick={() => {
                setResult((prev) =>
                  prev
                    ? {
                        ...prev,
                        onboardingCompleted: false,
                      }
                    : prev
                );
              }}
              style={{
                border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: 12,
                padding: "10px 14px",
                background: "transparent",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: fontStack,
              }}
            >
              Cambiar categorías
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}