"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { followUser } from "@/lib/social/social-service";
import RefreshableArea from "@/components/refresh/RefreshableArea";

import { offersExperiences, type PublicUser } from "./GroupsSearchPanel";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";

export type ProfilesSearchFilter = "all" | "experiences";

type SearchProfilesResultsProps = {
  fontStack: string;
  profiles: PublicUser[];
  onNavigate: (href: string) => void;
  onRefresh?: () => Promise<void> | void;
  currentUserId?: string | null;
  filter?: ProfilesSearchFilter;
  indicatorTop?: string;
};

export default function SearchProfilesResults({
  fontStack,
  profiles,
  onNavigate,
  onRefresh,
  currentUserId,
  filter = "all",
  indicatorTop,
}: SearchProfilesResultsProps) {
  const tCommon = useTranslations("common");
  const [visibleCount, setVisibleCount] = useState(10);
  const [mobileRefreshEnabled, setMobileRefreshEnabled] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Seguir a un perfil: uid → ¿ya lo sigues? / ¿en curso?
  const [followMap, setFollowMap] = useState<Record<string, boolean>>({});
  const [followBusy, setFollowBusy] = useState<Record<string, boolean>>({});

  const filteredProfiles =
    filter === "experiences" ? profiles.filter((p) => offersExperiences(p)) : profiles;

  const hasResults = filteredProfiles.length > 0;
  const visibleProfiles = filteredProfiles.slice(0, visibleCount);
  const hasMoreProfiles = visibleCount < filteredProfiles.length;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleCount(10);
  }, [profiles, filter]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const syncMobileRefresh = () => setMobileRefreshEnabled(mediaQuery.matches);
    syncMobileRefresh();
    mediaQuery.addEventListener("change", syncMobileRefresh);
    return () => mediaQuery.removeEventListener("change", syncMobileRefresh);
  }, []);

  // Carga el estado de "siguiendo" de los perfiles visibles.
  useEffect(() => {
    let cancelled = false;
    async function loadFollowState() {
      if (!currentUserId) {
        setFollowMap({});
        return;
      }
      const uids = Array.from(
        new Set(
          profiles
            .map((p) => p.uid)
            .filter((id): id is string => !!id && id !== currentUserId)
        )
      );
      if (uids.length === 0) {
        setFollowMap({});
        return;
      }
      try {
        const entries = await Promise.all(
          uids.map(async (uid) => {
            const snap = await getDoc(
              doc(db, "users", currentUserId, "following", uid)
            );
            return [uid, snap.exists()] as const;
          })
        );
        if (cancelled) return;
        setFollowMap((prev) => {
          const merged = { ...prev };
          entries.forEach(([id, isF]) => {
            merged[id] = merged[id] || isF;
          });
          return merged;
        });
      } catch (e) {
        console.error(e);
      }
    }
    loadFollowState();
    return () => {
      cancelled = true;
    };
  }, [currentUserId, profiles]);

  async function handleFollow(uid: string | undefined) {
    if (!currentUserId || !uid || currentUserId === uid) return;
    if (followMap[uid] || followBusy[uid]) return;
    setFollowBusy((p) => ({ ...p, [uid]: true }));
    setFollowMap((p) => ({ ...p, [uid]: true })); // optimista
    try {
      await followUser({ currentUserId, targetUserId: uid });
    } catch (e) {
      console.error(e);
      setFollowMap((p) => ({ ...p, [uid]: false })); // revertir
    } finally {
      setFollowBusy((p) => ({ ...p, [uid]: false }));
    }
  }

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMoreProfiles) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisibleCount((prev) => prev + 10);
      },
      { root: null, rootMargin: "120px", threshold: 0.1 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreProfiles, visibleProfiles.length]);

  function openProfile(handle?: string | null) {
    if (!handle) return;
    onNavigate(`/u/${handle}`);
  }

  const shellStyle: CSSProperties = {
    minHeight: 0,
    overflow: "visible",
    padding: "0 4px 14px",
    display: "grid",
    gap: 0,
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

  if (!hasResults) {
    return (
      <RefreshableArea
        onRefresh={mobileRefreshEnabled && onRefresh ? onRefresh : async () => {}}
        indicatorTop={indicatorTop ?? "calc(env(safe-area-inset-top) + 116px)"}
      >
        <section style={shellStyle}>
          <div style={noResultsStyle}>{tCommon("noProfilesFound")}</div>
        </section>
      </RefreshableArea>
    );
  }

  return (
    <RefreshableArea
      onRefresh={mobileRefreshEnabled && onRefresh ? onRefresh : async () => {}}
      indicatorTop={indicatorTop ?? "calc(env(safe-area-inset-top) + 116px)"}
    >
      <section style={shellStyle}>
        {visibleProfiles.map((p) => {
          const fullName =
            p.displayName?.trim() ||
            `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() ||
            p.handle ||
            tCommon("user");

          const hasExperiences = offersExperiences(p);
          const isFollowing = !!p.uid && !!followMap[p.uid];
          const isSelf = !!currentUserId && p.uid === currentUserId;

          return (
            <div
              key={p.uid}
              className="result-item"
              onClick={() => openProfile(p.handle)}
            >
              <div className="result-grid">
                <div className="result-main-mobile">
                  <LiveRingAvatar
                    entityId={p.uid}
                    entityType="profile"
                    currentUserId={currentUserId}
                    photoURL={p.photoURL}
                    displayName={fullName}
                    size={42}
                    onClick={(e) => {
                      e.stopPropagation();
                      openProfile(p.handle);
                    }}
                  />
                  <div className="result-content">
                    <h3 className="result-name result-name-with-meta">
                      <span className="result-name-text">{fullName}</span>
                      {hasExperiences && (
                        <span className="name-inline-exp">
                          <span className="result-name-dot">·</span>
                          <span className="result-name-experiences">
                            Ofrece experiencias
                          </span>
                        </span>
                      )}
                    </h3>
                    {/* @handle debajo del nombre. En celular, si el perfil ofrece
                        servicios se oculta y se muestra "Ofrece experiencias" para
                        darle más espacio al nombre. */}
                    <div
                      className={`result-handle${
                        hasExperiences ? " handle-hide-mobile" : ""
                      }`}
                    >
                      @{p.handle}
                    </div>
                    {hasExperiences && (
                      <div className="result-name-experiences mobile-exp-line">
                        Ofrece experiencias
                      </div>
                    )}
                  </div>
                </div>

                {!isSelf && (
                  <div className="actions-wrap" onClick={(e) => e.stopPropagation()}>
                    {isFollowing ? (
                      <span className="member-state" style={{ cursor: "default" }}>
                        Siguiendo
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="primary-btn"
                        disabled={!!followBusy[p.uid]}
                        onClick={() => void handleFollow(p.uid)}
                      >
                        Seguir
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {hasMoreProfiles ? (
          <div
            ref={loadMoreRef}
            aria-hidden="true"
            style={{ width: "100%", height: 1 }}
          />
        ) : null}

        <style jsx>{`
          .result-item {
            padding: 10px 14px;
            transition: background 0.16s ease;
            cursor: pointer;
          }

          .result-item:hover {
            background: rgba(255, 255, 255, 0.035);
          }

          .result-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 10px;
            align-items: center;
          }

          .result-main-mobile {
            display: flex;
            gap: 10px;
            align-items: center;
            min-width: 0;
          }

          .result-content {
            min-width: 0;
            overflow: hidden;
            display: grid;
            gap: 5px;
          }

          .result-name {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.2;
            color: #fff;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .result-name-with-meta {
            display: flex;
            align-items: baseline;
            gap: 5px;
            min-width: 0;
          }

          .result-name-text {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .result-name-dot {
            flex-shrink: 0;
            color: rgba(255, 255, 255, 0.42);
            font-size: 11px;
            line-height: 1;
          }

          .result-name-experiences {
            flex-shrink: 0;
            color: rgba(168, 85, 255, 0.85);
            font-size: 11px;
            font-weight: 500;
            line-height: 1.2;
            white-space: nowrap;
          }

          /* @usuario debajo del nombre, alineado a la izquierda, sin contenedor */
          .result-handle {
            color: rgba(255, 255, 255, 0.44);
            font-size: 12px;
            line-height: 1.2;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .actions-wrap {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 6px;
            flex-wrap: nowrap;
            flex-shrink: 0;
          }

          .primary-btn {
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

          .primary-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }

          /* Estado "Siguiendo" — mismo tamaño que el botón, no accionable */
          .member-state {
            width: 134px;
            box-sizing: border-box;
            min-height: 34px;
            padding: 7px 8px;
            border-radius: 10px;
            border: none;
            background: rgba(255, 255, 255, 0.06);
            color: rgba(255, 255, 255, 0.5);
            font-weight: 600;
            font-size: 12px;
            letter-spacing: -0.01em;
            font-family: ${fontStack};
            display: inline-flex;
            align-items: center;
            justify-content: center;
            white-space: nowrap;
          }

          /* Línea "Ofrece experiencias" bajo el nombre: solo en celular. */
          .mobile-exp-line {
            display: none;
            font-size: 12px;
            line-height: 1.2;
          }

          @media (max-width: 640px) {
            .result-item {
              padding: 10px 12px;
            }

            /* En celular con servicios: el nombre ocupa toda su línea; el
               "Ofrece experiencias" baja debajo y se oculta el @handle. */
            .name-inline-exp {
              display: none;
            }
            .handle-hide-mobile {
              display: none;
            }
            .mobile-exp-line {
              display: block;
            }

            .result-grid {
              grid-template-columns: minmax(0, 1fr) auto;
              gap: 8px;
              align-items: center;
            }

            .result-main-mobile {
              gap: 8px;
              align-items: center;
            }

            .result-name {
              font-size: 13px;
            }

            .actions-wrap {
              justify-content: flex-end;
              width: auto;
            }

            .primary-btn,
            .member-state {
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
