"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { User } from "firebase/auth";

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
};

type GroupVisibilityFilter = "public" | "private";
type MonetizationFilter = "free" | "paid";

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "C";
}

function isJoinedStatus(status: CanonicalMemberStatus) {
  return status === "active" || status === "muted";
}

function isBlockedStatus(status: CanonicalMemberStatus) {
  return status === "banned" || status === "removed";
}

function membershipStatusLabel(status: CanonicalMemberStatus) {
  if (status === "active") return "Ya estás unido";
  if (status === "muted") return "Ya estás unido (muteado)";
  if (status === "banned") return "Baneado";
  if (status === "removed") return "Expulsado";
  return "";
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
}: SearchGroupsResultsProps) {
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [visibilityFilters, setVisibilityFilters] = useState<
    GroupVisibilityFilter[]
  >([]);
  const [monetizationFilters, setMonetizationFilters] = useState<
    MonetizationFilter[]
  >([]);

  const filtersPanelRef = useRef<HTMLDivElement | null>(null);

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

  const shellStyle: CSSProperties = {
    minHeight: 0,
    overflowY: "auto",
    padding: 14,
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
    margin: "2px 0 0 0",
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
    alignItems: "start",
    position: "relative",
  };

  const activeFiltersWrapStyle: CSSProperties = {
    minHeight: 36,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    padding: "0 2px",
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
    backdropFilter: "blur(12px)",
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
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.025)",
    padding: 10,
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

  const avatarStyle: CSSProperties = {
    width: 42,
    height: 42,
    borderRadius: "50%",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  };

  const fallbackStyle: CSSProperties = {
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
  };

  const contentStyle: CSSProperties = {
    minWidth: 0,
    display: "grid",
    gap: 5,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    color: "#fff",
    fontSize: 13.5,
    fontWeight: 700,
    lineHeight: 1.2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const metaRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  };

  const pillStyle: CSSProperties = {
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.88)",
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };

  const paidPillStyle: CSSProperties = {
    ...pillStyle,
    border: "1px solid rgba(255,225,166,0.26)",
    background: "rgba(255,225,166,0.10)",
    fontWeight: 700,
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
    flexWrap: "wrap",
    flexShrink: 0,
  };

  const primaryButtonStyle: CSSProperties = {
    minHeight: 32,
    padding: "6px 10px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "#fff",
    color: "#000",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 11.5,
    fontFamily: fontStack,
    whiteSpace: "nowrap",
  };

  const secondaryButtonStyle: CSSProperties = {
    minHeight: 32,
    padding: "6px 10px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 11.5,
    fontFamily: fontStack,
    whiteSpace: "nowrap",
  };

  const disabledButtonStyle: CSSProperties = {
    minHeight: 32,
    padding: "6px 10px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.68)",
    fontWeight: 700,
    fontSize: 11.5,
    fontFamily: fontStack,
    cursor: "default",
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
    if (visibilityFilters.includes("private") && group.visibility === "private") {
      return true;
    }
    return false;
  }

  function matchesMonetizationFilters(group: Community) {
    if (monetizationFilters.length === 0) return true;

    const isPaid = !!group.monetization?.isPaid;
    const isFree = !isPaid;

    if (monetizationFilters.includes("paid") && isPaid) return true;
    if (monetizationFilters.includes("free") && isFree) return true;

    return false;
  }

  const filteredByUi = useMemo(() => {
    return communities.filter((group) => {
      return (
        matchesVisibilityFilters(group) &&
        matchesMonetizationFilters(group)
      );
    });
  }, [communities, visibilityFilters, monetizationFilters]);

  const exactGroups = filteredByUi.filter(
    (group) => (group.searchMatchType ?? "exact") === "exact"
  );

  const relatedGroups = filteredByUi.filter(
    (group) => group.searchMatchType === "related"
  );

  const suggestedGroups = filteredByUi.filter(
    (group) => group.searchMatchType === "suggested"
  );

  const activeFilters = [
    ...visibilityFilters.map((value) => ({
      key: value,
      label: value === "public" ? "Públicas" : "Privadas",
      onRemove: () => toggleVisibilityFilter(value),
    })),
    ...monetizationFilters.map((value) => ({
      key: value,
      label: value === "free" ? "Gratuitas" : "De pago",
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
          <span aria-hidden="true">☰</span>
          Filtros
        </button>

        {isFiltersOpen && (
          <div style={filtersPanelStyle} className="search-groups-filters-panel">
            <div style={filterBlockStyle}>
              <p style={filterBlockTitleStyle}>Visibilidad</p>

              <button
                type="button"
                style={
                  visibilityFilters.includes("public")
                    ? filterOptionActiveStyle
                    : filterOptionButtonStyle
                }
                onClick={() => toggleVisibilityFilter("public")}
              >
                Públicas
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
                Privadas
              </button>
            </div>

            <div style={filterBlockStyle}>
              <p style={filterBlockTitleStyle}>Monetización</p>

              <button
                type="button"
                style={
                  monetizationFilters.includes("free")
                    ? filterOptionActiveStyle
                    : filterOptionButtonStyle
                }
                onClick={() => toggleMonetizationFilter("free")}
              >
                Gratuitas
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
                De pago
              </button>
            </div>

            <div style={filterActionsRowStyle}>
              <button
                type="button"
                style={filterActionSecondaryStyle}
                onClick={clearAllFilters}
              >
                Limpiar
              </button>

              <button
                type="button"
                style={filterActionPrimaryStyle}
                onClick={() => setIsFiltersOpen(false)}
              >
                Listo
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (filteredByUi.length === 0) {
    return (
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
                      aria-label={`Quitar filtro ${filter.label}`}
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
          No se encontraron comunidades con esos filtros.
        </div>

        <style jsx>{`
          .search-groups-filters-anchor {
            position: relative;
          }

          @media (max-width: 768px) {
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

    const visLabel =
      group.visibility === "public"
        ? "Comunidad pública"
        : group.visibility === "private"
          ? "Comunidad privada"
          : "Comunidad oculta";

    const paid = !!group.monetization?.isPaid;
    const price = group.monetization?.priceMonthly ?? null;
    const cur = group.monetization?.currency ?? null;

    return (
      <article
        key={group.id}
        style={cardStyle}
        onClick={() => onNavigate(`/groups/${group.id}`)}
      >
        <div style={mainGridStyle} className="search-groups-card-grid">
          <div style={mainInfoStyle}>
            <div style={avatarStyle}>
              {group.avatarUrl ? (
                <img
                  src={group.avatarUrl}
                  alt={group.name ?? "Comunidad"}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <span style={fallbackStyle}>
                  {initialsFromName(group.name ?? "Comunidad")}
                </span>
              )}
            </div>

            <div style={contentStyle}>
              <h3 style={titleStyle} className="search-groups-card-title">
                {group.name ?? "(sin nombre)"}
              </h3>

              <div style={metaRowStyle}>
                <span style={pillStyle}>{visLabel}</span>

                {paid && (
                  <span style={paidPillStyle}>
                    Con suscripción
                    {price != null ? ` · ${price} ${cur ?? ""}` : ""}
                  </span>
                )}

                {isOwner && (
                  <span style={inlineMetaStyle}>(Eres owner)</span>
                )}

                {!isOwner && isMember && (
                  <span style={inlineMetaStyle}>
                    ({membershipStatusLabel(membershipStatus)})
                  </span>
                )}

                {!isOwner && isBlocked && (
                  <span style={dangerMetaStyle}>
                    ({membershipStatusLabel(membershipStatus)})
                  </span>
                )}

                {!isOwner &&
                  !isMember &&
                  !isBlocked &&
                  isPrivate &&
                  hasPendingReq && (
                    <span style={inlineMetaStyle}>(Pendiente)</span>
                  )}
              </div>
            </div>
          </div>

          <div
            style={actionWrapStyle}
            className="search-groups-card-actions"
            onClick={(e) => e.stopPropagation()}
          >
            {!isOwner && !isMember && !isBlocked && isPublic && (
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => void onJoinPublic(group.id)}
              >
                Unirme
              </button>
            )}

            {!isOwner && !isMember && !isBlocked && isPrivate && (
              <>
                {!hasPendingReq ? (
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => void onRequestPrivate(group.id)}
                  >
                    Solicitar acceso
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      style={disabledButtonStyle}
                      disabled
                    >
                      Enviada
                    </button>

                    <button
                      type="button"
                      style={secondaryButtonStyle}
                      onClick={() => void onCancelRequest(group.id)}
                    >
                      Cancelar
                    </button>
                  </>
                )}
              </>
            )}

            {isMember && !isOwner && (
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => void onLeave(group.id, group.ownerId)}
              >
                Salir
              </button>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
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
                aria-label={`Quitar filtro ${filter.label}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>

        {renderFiltersPanel()}
      </div>

      {exactGroups.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Coincidencias</h2>
          {exactGroups.map(renderGroupCard)}
        </div>
      )}

      {relatedGroups.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Comunidades relacionadas</h2>
          {relatedGroups.map(renderGroupCard)}
        </div>
      )}

      {relatedGroups.length === 0 && suggestedGroups.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Comunidades que te pueden interesar</h2>
          {suggestedGroups.map(renderGroupCard)}
        </div>
      )}

      <style jsx>{`
        .search-groups-filters-anchor {
          position: relative;
        }

        @media (max-width: 768px) {
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

          .search-groups-card-grid {
            grid-template-columns: minmax(0, 1fr) !important;
            align-items: flex-start !important;
          }

          .search-groups-card-actions {
            width: 100%;
            justify-content: flex-start !important;
          }

          .search-groups-card-title {
            white-space: normal !important;
            overflow: visible !important;
            text-overflow: unset !important;
          }
        }
      `}</style>
    </section>
  );
}