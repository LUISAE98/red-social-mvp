"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
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
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

const cardStyles = {
  background: "rgba(28, 28, 31, 0.96)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: 18,
  minWidth: 216,
  maxWidth: 216,
  padding: 10,
  color: "#fff",
  display: "flex",
  flexDirection: "column" as const,
  gap: 10,
  scrollSnapAlign: "start" as const,
  boxShadow:
    "0 0 0 1px rgba(255,255,255,0.025) inset, 0 10px 24px rgba(0,0,0,0.18)",
  flexShrink: 0,
};

function getDefaultTitle() {
  return "Grupos recomendados para ti";
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
      return "Te mostramos grupos en función de tus categorías e historial.";
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
}: {
  state: RecommendationJoinState;
  onClick: () => void;
  loading: boolean;
}) {
  const label =
    state === "joined"
      ? "Unido"
      : state === "pending"
      ? "Solicitud enviada"
      : state === "request"
      ? "Solicitar"
      : "Unirme";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || state === "joined" || state === "pending"}
      style={{
        width: "100%",
        borderRadius: 12,
        padding: "10px 12px",
        border: "none",
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: "-0.01em",
        cursor:
          loading || state === "joined" || state === "pending"
            ? "default"
            : "pointer",
        background:
          state === "joined" || state === "pending"
            ? "rgba(255,255,255,0.12)"
            : "#ffffff",
        color:
          state === "joined" || state === "pending"
            ? "rgba(255,255,255,0.72)"
            : "#08111d",
        fontFamily: fontStack,
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

  return (
    <div style={cardStyles}>
      <Link
        href={`/groups/${group.id}`}
        style={{
          color: "inherit",
          textDecoration: "none",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "1 / 1.04",
            borderRadius: 14,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "#0d0d0f",
            boxShadow: "0 12px 28px rgba(0,0,0,0.22)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: group.coverUrl
                ? `url(${group.coverUrl}) center / cover no-repeat`
                : "linear-gradient(135deg, #161616 0%, #212125 55%, #121214 100%)",
              transform: "scale(1.01)",
            }}
          />

          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.30) 36%, rgba(0,0,0,0.72) 68%, rgba(0,0,0,0.92) 100%)",
            }}
          />

          <div
            style={{
              position: "absolute",
              inset: 0,
              padding: 12,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 62,
                height: 62,
                borderRadius: "50%",
                overflow: "hidden",
                background: "#111",
                border: "3px solid rgba(0,0,0,0.92)",
                boxShadow: "0 8px 18px rgba(0,0,0,0.36)",
                display: "grid",
                placeItems: "center",
                color: "#fff",
                fontWeight: 700,
                fontSize: 18,
                flexShrink: 0,
                marginTop: 10,
                marginBottom: 18,
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

            <div
              style={{
                marginTop: "auto",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
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
                  minHeight: 34,
                  fontFamily: fontStack,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                }}
              >
                {group.name}
              </strong>

              <p
                style={{
                  margin: "8px 0 0 0",
                  fontSize: 12,
                  lineHeight: 1.35,
                  color: "rgba(255,255,255,0.82)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  minHeight: 32,
                  maxWidth: "100%",
                  fontFamily: fontStack,
                  fontWeight: 400,
                }}
              >
                {group.description || "Sin descripción disponible."}
              </p>

              <div
                style={{
                  marginTop: 10,
                  fontSize: 11,
                  lineHeight: 1.2,
                  color: "rgba(255,255,255,0.76)",
                  fontFamily: fontStack,
                  fontWeight: 500,
                }}
              >
                {visibilityLabel}
              </div>

              <div
                style={{
                  marginTop: 5,
                  fontSize: 11,
                  lineHeight: 1.2,
                  color: "rgba(255,255,255,0.60)",
                  fontFamily: fontStack,
                  fontWeight: 400,
                }}
              >
                {categoryLabel}
              </div>
            </div>
          </div>
        </div>
      </Link>

      <JoinButton state={joinState} onClick={onJoin} loading={loading} />
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
  const minCategories = recommendationEngineConstants.MIN_ONBOARDING_CATEGORIES;

  const hasRealSession =
    Boolean(currentUserId) && auth.currentUser?.uid === currentUserId;

  const loadRecommendations = useCallback(async () => {
    if (!currentUserId || !hasRealSession) {
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
  }, [currentUserId, hasRealSession]);

  useEffect(() => {
    void loadRecommendations();
  }, [loadRecommendations]);

  const toggleCategory = (category: CanonicalGroupCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((item) => item !== category)
        : [...prev, category]
    );
  };

  const handleSaveOnboarding = async () => {
    if (!currentUserId || !hasRealSession) return;

    setSavingOnboarding(true);
    setError(null);

    try {
      completeRecommendationsOnboarding(currentUserId, selectedCategories);
      await loadRecommendations();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo guardar la selección."
      );
    } finally {
      setSavingOnboarding(false);
    }
  };

  const handleJoin = async (group: RecommendationGroupCard) => {
    if (!currentUserId || !hasRealSession) return;

    setJoinLoadingByGroup((prev) => ({ ...prev, [group.id]: true }));
    setError(null);

    try {
      if (group.visibility === "public") {
        await joinGroup(group.id, currentUserId);
        setJoinStates((prev) => ({ ...prev, [group.id]: "joined" }));
      } else if (group.visibility === "private") {
        await requestToJoin(group.id, currentUserId);
        setJoinStates((prev) => ({ ...prev, [group.id]: "pending" }));
      }

      trackGroupRecommendationSignalFromGroup({
        uid: currentUserId,
        category: group.category,
        tags: group.tags,
      });

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo completar la acción."
      );
    } finally {
      setJoinLoadingByGroup((prev) => ({ ...prev, [group.id]: false }));
    }
  };

  const showOnboarding = useMemo(() => {
    return !loading && result && !result.onboardingCompleted;
  }, [loading, result]);

  if (!currentUserId || !hasRealSession) {
    return null;
  }

  return (
    <section
      className={className}
      style={{
        width: "100%",
        borderRadius: 22,
        border: "1px solid rgba(255, 255, 255, 0.09)",
        background:
          "linear-gradient(180deg, rgba(34,34,37,0.97) 0%, rgba(24,24,27,0.97) 100%)",
        padding: 16,
        color: "#fff",
        boxShadow:
          "0 0 0 1px rgba(255,255,255,0.025) inset, 0 12px 28px rgba(0,0,0,0.18)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              fontFamily: fontStack,
              letterSpacing: "-0.01em",
            }}
          >
            {heading}
          </h3>
        </div>

        {context === "search_empty" && (
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
              background: "#ffffff",
              color: "#08111d",
              padding: "10px 14px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: fontStack,
            }}
          >
            Crear grupo
          </button>
        )}
      </div>

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
            personalizar tus grupos sugeridos.
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
            Aún no tenemos grupos disponibles para recomendarte.
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
              Crear grupo
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