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
import RefreshableArea from "@/components/refresh/RefreshableArea";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";

import {
  offersExperiences,
  type CanonicalMemberStatus,
  type Community,
} from "./GroupsSearchPanel";

// Filtro multi-select de comunidades. "all" = sin filtro.
export type CommunitiesSearchFilter =
  | "all"
  | "public"
  | "private"
  | "subscription"
  | "free"
  | "experiences";

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
  indicatorTop?: string;
  filter?: CommunitiesSearchFilter[];
};

function getDescriptionPreview(value?: string) {
  const clean = (value ?? "").trim().replace(/\s+/g, " ");

  if (!clean) return "";
  if (clean.length <= 60) return clean;

  return `${clean.slice(0, 80).trim()}...`;
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
  filter,
  indicatorTop,
}: SearchGroupsResultsProps) {
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");

  const [isMobile, setIsMobile] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= 640);
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const shellStyle: CSSProperties = {
    minHeight: 0,
    overflow: "visible",
    padding: "0 4px 14px",
    display: "grid",
    gap: 10,
    position: "relative",
  };

  // Sin resultados: solo texto, centrado en la pantalla, sin contenedor.
  const noResultsStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    minHeight: "45vh",
    padding: "0 24px",
    color: "rgba(255,255,255,0.55)",
    fontSize: 15,
    lineHeight: 1.5,
  };

  // Coincidencia con el filtro multi-select. Dentro de una misma categoría es OR
  // (públicas/privadas; suscripción/gratuitas); entre categorías es AND.
  function communityMatchesFilter(group: Community): boolean {
    const active = (filter ?? []).filter((f) => f !== "all");
    if (active.length === 0) return true;

    const visSel = active.filter((f) => f === "public" || f === "private");
    if (visSel.length && !(visSel as string[]).includes(group.visibility ?? "")) {
      return false;
    }

    const monSel = active.filter((f) => f === "subscription" || f === "free");
    if (monSel.length) {
      const paid = resolveSubscriptionEnabled(group);
      const ok =
        (monSel.includes("subscription") && paid) ||
        (monSel.includes("free") && !paid);
      if (!ok) return false;
    }

    if (active.includes("experiences") && !offersExperiences(group)) return false;

    return true;
  }

  const filteredByUi = useMemo(() => {
    return communities.filter((group) => communityMatchesFilter(group));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communities, filter]);

  const displayGroups = useMemo(() => {
    return filteredByUi.slice(0, visibleCount);
  }, [filteredByUi, visibleCount]);

  const hasMoreGroups = visibleCount < filteredByUi.length;

  useEffect(() => {
    setVisibleCount(10);
  }, [communities, filter]);

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

    const hasExperiences = offersExperiences(group);

    return (
      <div
        key={group.id}
        className="result-item"
        onClick={() => onNavigate(`/groups/${group.id}`)}
      >
        <div className="result-grid">
          <div className="result-main-mobile">
            <LiveRingAvatar
              entityId={group.id}
              entityType="group"
              currentUserId={currentUser?.uid ?? null}
              photoURL={group.avatarUrl ?? null}
              displayName={group.name ?? tGroups("title")}
              size={42}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(`/groups/${group.id}`);
              }}
            />

            <div className="result-content">
              <h3 className="result-name result-name-with-meta">
                <span className="result-name-text">
                  {group.name ?? tGroups("title")}
                </span>
                {/* Desktop: · Pública/Privada · Ofrece experiencias en la línea del nombre */}
                <span className="result-name-dot visibility-desktop">·</span>
                <span className="result-name-visibility visibility-desktop">
                  {visLabel}
                </span>
                {hasExperiences && (
                  <>
                    <span className="result-name-dot visibility-desktop">·</span>
                    <span className="result-name-experiences visibility-desktop">
                      Ofrece experiencias
                    </span>
                  </>
                )}
              </h3>

              {/* Desktop: descripción en una sola línea con puntos suspensivos */}
              {getDescriptionPreview(group.description) ? (
                <p className="result-description-preview">
                  {getDescriptionPreview(group.description)}
                </p>
              ) : null}

              {/* Móvil: Pública/Privada · Ofrece experiencias debajo del nombre */}
              <div className="result-meta-mobile">
                <span className="mobile-visibility-label">{visLabel}</span>
                {hasExperiences && (
                  <>
                    <span className="mobile-service-separator">·</span>
                    <span className="mobile-experiences-label">
                      Ofrece experiencias
                    </span>
                  </>
                )}
              </div>

              <div className="result-meta">
                {!isOwner && isBlocked && (
                  <span className="meta-inline meta-danger">
                    (
                    {membershipStatusKey(membershipStatus)
                      ? tGroups(membershipStatusKey(membershipStatus))
                      : ""}
                    )
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="actions-wrap" onClick={(e) => e.stopPropagation()}>
            {!isOwner && !isMember && !isBlocked && isPublic && (
              <button
                onClick={() => void onJoinPublic(group.id)}
                className="primary-btn"
                type="button"
              >
                {tGroups("join")}
              </button>
            )}

            {!isOwner && !isMember && !isBlocked && paidPrivate && (
              <button
                onClick={() => onNavigate(`/groups/${group.id}`)}
                className="primary-btn subscribe-btn"
                type="button"
              >
                💎 {tGroups("subscribe")}
              </button>
            )}

            {!isOwner &&
              !isMember &&
              !isBlocked &&
              isPrivate &&
              !paidPrivate && (
                <>
                  {!hasPendingReq ? (
                    <button
                      onClick={() => void onRequestPrivate(group.id)}
                      className="primary-btn"
                      type="button"
                    >
                      {tGroups("requestAccess")}
                    </button>
                  ) : (
                    <button
                      onClick={() => void onCancelRequest(group.id)}
                      className="secondary-btn"
                      type="button"
                    >
                      {tCommon("cancel")}
                    </button>
                  )}
                </>
              )}

            {isMember &&
              !isOwner &&
              (membershipStatus === "subscribed" ? (
                <button
                  type="button"
                  className="member-state"
                  onClick={() => onNavigate(`/groups/${group.id}`)}
                >
                  Suscrito
                </button>
              ) : (
                <button
                  type="button"
                  className="member-state"
                  onClick={() => void onLeave(group.id, group.ownerId)}
                >
                  Ya perteneces
                </button>
              ))}
          </div>
        </div>
      </div>
    );
  }

  if (filteredByUi.length === 0) {
    return (
      <RefreshableArea
        onRefresh={onRefresh ?? (() => {})}
        enabled={isMobile && Boolean(onRefresh)}
        indicatorTop={indicatorTop ?? "calc(env(safe-area-inset-top) + 116px)"}
      >
        <section style={shellStyle}>
          <div style={noResultsStyle}>{tGroups("noGroupsFound")}</div>
        </section>
      </RefreshableArea>
    );
  }

  return (
    <RefreshableArea
      onRefresh={onRefresh ?? (() => {})}
      enabled={isMobile && Boolean(onRefresh)}
      indicatorTop={indicatorTop ?? "calc(env(safe-area-inset-top) + 116px)"}
    >
      <section style={shellStyle} className="sgr-scope">
{displayGroups.length > 0 && (
  <div>{displayGroups.map(renderGroupCard)}</div>
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

      {/* Global + prefijado con .sgr-scope: renderGroupCard es una función anidada
          y styled-jsx no le aplica el scope; con global se garantiza el estilo. */}
      <style jsx global>{`
        .sgr-scope .search-groups-filters-anchor {
          position: relative;
        }

        .sgr-scope .result-item {
          padding: 10px 14px;
          transition: background 0.16s ease;
          cursor: pointer;
        }

        .sgr-scope .result-item:hover {
          background: rgba(255, 255, 255, 0.035);
        }

        .sgr-scope .result-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
        }

        .sgr-scope .result-main-mobile {
          display: flex;
          gap: 10px;
          align-items: center;
          min-width: 0;
        }

        .sgr-scope .result-content {
          min-width: 0;
          overflow: hidden;
          display: grid;
          gap: 5px;
        }

        .sgr-scope .result-name {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.2;
          color: #fff;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sgr-scope .result-name-with-meta {
          display: flex;
          align-items: baseline;
          gap: 5px;
          min-width: 0;
        }

        .sgr-scope .result-name-text {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sgr-scope .result-name-dot {
          flex-shrink: 0;
          color: rgba(255, 255, 255, 0.42);
          font-size: 11px;
          line-height: 1;
        }

        .sgr-scope .result-name-visibility {
          flex-shrink: 0;
          color: rgba(255, 255, 255, 0.48);
          font-size: 11px;
          font-weight: 500;
          line-height: 1.2;
          white-space: nowrap;
        }

        .sgr-scope .result-name-experiences {
          flex-shrink: 0;
          color: rgba(168, 85, 255, 0.85);
          font-size: 11px;
          font-weight: 500;
          line-height: 1.2;
          white-space: nowrap;
        }

        .sgr-scope .result-description-preview {
          display: block;
          margin: -1px 0 0;
          max-width: 100%;
          overflow: hidden;
          color: rgba(255, 255, 255, 0.5);
          font-size: 11px;
          font-weight: 400;
          line-height: 1.25;
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        .sgr-scope .result-meta-mobile {
          display: none;
        }

        .sgr-scope .result-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .sgr-scope .meta-inline {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.56);
          line-height: 1.25;
        }

        .sgr-scope .meta-danger {
          color: rgba(255, 176, 176, 0.9);
        }

        .sgr-scope .actions-wrap {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          flex-wrap: nowrap;
          flex-shrink: 0;
        }

        .sgr-scope .primary-btn {
          width: 134px;
          box-sizing: border-box;
          min-height: 34px;
          padding: 7px 8px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, #ec4899, #9333ea);
          color: #fff;
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          letter-spacing: -0.01em;
          font-family: ${fontStack};
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }

        /* Suscribirse (privada de pago) — azul */
        .sgr-scope .subscribe-btn {
          background: #70aefb;
        }

        /* Estado de miembro (Ya perteneces / Suscrito) — accionable */
        .sgr-scope .member-state {
          width: 134px;
          box-sizing: border-box;
          min-height: 34px;
          padding: 7px 8px;
          border-radius: 10px;
          border: none;
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.5);
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          letter-spacing: -0.01em;
          font-family: ${fontStack};
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }

        .sgr-scope .secondary-btn {
          width: 134px;
          box-sizing: border-box;
          min-height: 34px;
          padding: 7px 8px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(255, 255, 255, 0.14);
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          font-weight: 600;
          font-size: 12px;
          letter-spacing: -0.01em;
          font-family: ${fontStack};
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }

        @media (max-width: 640px) {
          .sgr-scope .search-groups-topbar {
            grid-template-columns: minmax(0, 1fr);
          }

          .sgr-scope .search-groups-filters-anchor {
            width: 100%;
          }

          .sgr-scope .search-groups-filters-anchor button {
            width: 100%;
            justify-content: center;
          }

          .sgr-scope .search-groups-filters-panel {
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            margin-top: 10px;
          }

          .sgr-scope .result-item {
            padding: 10px 12px;
          }

          .sgr-scope .result-grid {
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px;
            align-items: center;
          }

          .sgr-scope .result-main-mobile {
            gap: 8px;
            align-items: center;
          }

          .sgr-scope .result-name {
            font-size: 13px;
          }

          .sgr-scope .result-description-preview {
            display: none;
          }

          .sgr-scope .visibility-desktop {
            display: none;
          }

          .sgr-scope .result-meta-mobile {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-height: 14px;
            margin-top: 1px;
          }

          .sgr-scope .mobile-service-separator {
            color: rgba(255, 255, 255, 0.34);
            font-size: 10px;
            line-height: 1;
            flex-shrink: 0;
          }

          .sgr-scope .mobile-visibility-label {
            color: rgba(255, 255, 255, 0.48);
            font-size: 10px;
            font-weight: 500;
            line-height: 1.2;
            white-space: nowrap;
          }

          .sgr-scope .mobile-experiences-label {
            color: rgba(168, 85, 255, 0.85);
            font-size: 10px;
            font-weight: 500;
            line-height: 1.2;
            white-space: nowrap;
          }

          .sgr-scope .actions-wrap {
            justify-content: flex-end;
            width: auto;
            flex-wrap: nowrap;
          }

          .sgr-scope .primary-btn,
          .sgr-scope .secondary-btn,
          .sgr-scope .member-state {
            width: 118px;
            min-height: 32px;
            padding: 6px 8px;
            font-size: 11px;
          }
        }
      `}</style>
      </section>
    </RefreshableArea>
  );
}