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

const cardStyles = {
  background: "rgba(9, 24, 44, 0.72)",
  border: "1px solid rgba(123, 178, 255, 0.18)",
  borderRadius: 16,
  minWidth: 216,
  maxWidth: 216,
  padding: 12,
  color: "#fff",
  display: "flex",
  flexDirection: "column" as const,
  gap: 10,
  scrollSnapAlign: "start" as const,
  boxShadow: "0 0 0 1px rgba(123, 178, 255, 0.03) inset",
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
    const requestSnap = await getDoc(doc(db, "groups", groupId, "joinRequests", userId));
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
          : "1px solid rgba(123,178,255,0.16)",
        background: selected ? "#ffffff" : "rgba(15, 32, 56, 0.8)",
        color: selected ? "#08111d" : "#ffffff",
        borderRadius: 999,
        padding: "8px 12px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
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
        borderRadius: 10,
        padding: "9px 11px",
        border: "none",
        fontWeight: 800,
        fontSize: 13,
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
      ? "Pública"
      : group.visibility === "private"
      ? "Privada"
      : "Oculta";

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
            width: "100%",
            height: 88,
            borderRadius: 12,
            overflow: "hidden",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(123,178,255,0.15)",
            position: "relative",
          }}
        >
          {group.coverUrl ? (
            <img
              src={group.coverUrl}
              alt={`Portada de ${group.name}`}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "grid",
                placeItems: "center",
                color: "rgba(255,255,255,0.45)",
                fontSize: 11,
              }}
            >
              Sin portada
            </div>
          )}

          <div
            style={{
              position: "absolute",
              left: 10,
              bottom: 10,
              width: 40,
              height: 40,
              borderRadius: 10,
              overflow: "hidden",
              border: "2px solid rgba(4, 12, 25, 0.75)",
              background: "#0b1625",
            }}
          >
            {group.avatarUrl ? (
              <img
                src={group.avatarUrl}
                alt={`Avatar de ${group.name}`}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "grid",
                  placeItems: "center",
                  color: "rgba(255,255,255,0.45)",
                  fontSize: 10,
                  fontWeight: 800,
                }}
              >
                {group.name.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <strong
            style={{
              fontSize: 14,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {group.name}
          </strong>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              fontSize: 11,
              color: "rgba(220,233,255,0.74)",
            }}
          >
            <span>{visibilityLabel}</span>
            <span>•</span>
            <span>{categoryLabel}</span>
          </div>

          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "rgba(227,236,255,0.76)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              minHeight: 32,
            }}
          >
            {group.description || "Sin descripción disponible."}
          </p>
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
  const [selectedCategories, setSelectedCategories] = useState<CanonicalGroupCategory[]>([]);
  const [result, setResult] = useState<RecommendationFetchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinStates, setJoinStates] = useState<Record<string, RecommendationJoinState>>({});
  const [joinLoadingByGroup, setJoinLoadingByGroup] = useState<Record<string, boolean>>({});

  const heading = title ?? getDefaultTitle();
  const subheading = subtitle ?? getDefaultSubtitle(context);
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
            const state = await resolveJoinState(group.id, currentUserId, group.visibility);
            return [group.id, state] as const;
          })
        );

        setJoinStates(Object.fromEntries(entries));
      } else {
        setJoinStates({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar recomendaciones.");
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
      setError(err instanceof Error ? err.message : "No se pudo guardar la selección.");
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
      setError(err instanceof Error ? err.message : "No se pudo completar la acción.");
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
        border: "1px solid rgba(123, 178, 255, 0.18)",
        background:
          "linear-gradient(180deg, rgba(12,27,49,0.92) 0%, rgba(8,18,34,0.92) 100%)",
        padding: 16,
        color: "#fff",
        boxShadow:
          "0 0 0 1px rgba(123,178,255,0.03) inset, 0 10px 30px rgba(4,10,20,0.18)",
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
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{heading}</h3>
          <p style={{ margin: 0, fontSize: 13, color: "rgba(222,234,255,0.78)" }}>
            {subheading}
            {context === "search_empty" && emptySearchTerm
              ? ` Búsqueda: "${emptySearchTerm}".`
              : ""}
          </p>
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
              fontWeight: 800,
              cursor: "pointer",
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
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div style={{ fontSize: 14, color: "rgba(222,234,255,0.74)" }}>
          Cargando recomendaciones...
        </div>
      ) : null}

      {showOnboarding ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              fontSize: 14,
              color: "rgba(233,241,255,0.86)",
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
              disabled={savingOnboarding || selectedCategories.length < minCategories}
              style={{
                border: "none",
                borderRadius: 12,
                padding: "11px 16px",
                fontWeight: 800,
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
              }}
            >
              {savingOnboarding ? "Guardando..." : "Continuar"}
            </button>

            <span style={{ fontSize: 12, color: "rgba(222,234,255,0.68)" }}>
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
          <p style={{ margin: 0, fontSize: 14, color: "rgba(222,234,255,0.74)" }}>
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
                fontWeight: 800,
                cursor: "pointer",
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
                border: "1px solid rgba(123,178,255,0.18)",
                borderRadius: 12,
                padding: "10px 14px",
                background: "transparent",
                color: "#ffffff",
                fontWeight: 700,
                cursor: "pointer",
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