"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import RefreshableArea from "@/components/refresh/RefreshableArea";

import type { PublicUser } from "./GroupsSearchPanel";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";

type SearchProfilesResultsProps = {
  fontStack: string;
  profiles: PublicUser[];
  onNavigate: (href: string) => void;
  onRefresh?: () => Promise<void> | void;
  currentUserId?: string | null;
};

export default function SearchProfilesResults({
  fontStack,
  profiles,
  onNavigate,
  onRefresh,
  currentUserId,
}: SearchProfilesResultsProps) {
  const [visibleCount, setVisibleCount] = useState(10);
  const [mobileRefreshEnabled, setMobileRefreshEnabled] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const hasResults = profiles.length > 0;
  const visibleProfiles = profiles.slice(0, visibleCount);
  const hasMoreProfiles = visibleCount < profiles.length;

  useEffect(() => {
    setVisibleCount(10);
  }, [profiles]);

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

  useEffect(() => {
    const target = loadMoreRef.current;

    if (!target || !hasMoreProfiles) return;

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

  const emptyStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "15px 16px",
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 1.45,
  };

  const cardStyle: CSSProperties = {
    borderRadius: 0,
    border: "none",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "transparent",
    padding: "10px 2px",
    display: "grid",
    cursor: "pointer",
  };

  const rowStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
  };

  const contentStyle: CSSProperties = {
    minWidth: 0,
    display: "grid",
    gap: 4,
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

  const handleStyle: CSSProperties = {
    color: "rgba(255,255,255,0.48)",
    fontSize: 11,
    fontWeight: 500,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const ctaStyle: CSSProperties = {
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

  if (!hasResults) {
    return (
<RefreshableArea
  onRefresh={mobileRefreshEnabled && onRefresh ? onRefresh : async () => {}}
  indicatorTop="calc(env(safe-area-inset-top) + 116px)"
>
        <section style={shellStyle}>
          <div style={emptyStyle}>
            No se encontraron perfiles con esa búsqueda.
          </div>
        </section>
      </RefreshableArea>
    );
  }

  return (
<RefreshableArea
  onRefresh={mobileRefreshEnabled && onRefresh ? onRefresh : async () => {}}
  indicatorTop="calc(env(safe-area-inset-top) + 116px)"
>
      <section style={shellStyle}>
      {visibleProfiles.map((profile) => {
        const fullName =
          profile.displayName?.trim() ||
          `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() ||
          profile.handle ||
          "Usuario";

        const canOpenProfile = Boolean(profile.handle);

        return (
          <article
            key={profile.uid}
            style={{
              ...cardStyle,
              cursor: canOpenProfile ? "pointer" : "default",
            }}
            className="search-profile-item"
            onClick={() => openProfile(profile.handle)}
          >
            <div style={rowStyle} className="search-profile-row">
              <LiveRingAvatar
                entityId={profile.uid}
                entityType="profile"
                currentUserId={currentUserId}
                photoURL={profile.photoURL}
                displayName={fullName}
                size={42}
                onClick={(e) => { e.stopPropagation(); openProfile(profile.handle); }}
              />

              <div style={contentStyle}>
                <h3 style={titleStyle}>{fullName}</h3>

                {profile.handle ? (
                  <span style={handleStyle}>@{profile.handle}</span>
                ) : null}
              </div>

              <button
                type="button"
                style={ctaStyle}
                disabled={!canOpenProfile}
                onClick={(event) => {
                  event.stopPropagation();
                  openProfile(profile.handle);
                }}
              >
                Abrir
              </button>
            </div>
          </article>
        );
      })}

      {hasMoreProfiles ? (
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
        .search-profile-item {
          transition: background 0.16s ease;
        }

        .search-profile-item:hover {
          background: rgba(255, 255, 255, 0.035) !important;
        }

        .search-profile-row button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        @media (max-width: 640px) {
          .search-profile-item {
            padding: 10px 2px !important;
          }

          .search-profile-row {
            grid-template-columns: auto minmax(0, 1fr) auto !important;
            gap: 8px !important;
          }

          .search-profile-avatar {
            width: 38px !important;
            height: 38px !important;
          }

          .search-profile-row button {
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