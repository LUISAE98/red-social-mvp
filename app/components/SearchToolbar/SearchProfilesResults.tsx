"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { PublicUser } from "./GroupsSearchPanel";

type SearchProfilesResultsProps = {
  fontStack: string;
  profiles: PublicUser[];
  onNavigate: (href: string) => void;
};

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "U";
}

export default function SearchProfilesResults({
  fontStack,
  profiles,
  onNavigate,
}: SearchProfilesResultsProps) {
  const [visibleCount, setVisibleCount] = useState(10);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const hasResults = profiles.length > 0;
  const visibleProfiles = profiles.slice(0, visibleCount);
  const hasMoreProfiles = visibleCount < profiles.length;

  useEffect(() => {
    setVisibleCount(10);
  }, [profiles]);

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
      <section style={shellStyle}>
        <div style={emptyStyle}>
          No se encontraron perfiles con esa búsqueda.
        </div>
      </section>
    );
  }

  return (
    <section style={shellStyle}>
      {visibleProfiles.map((profile) => {
        const fullName =
          profile.displayName?.trim() ||
          `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() ||
          profile.handle ||
          "Usuario";

        return (
          <article
            key={profile.uid}
            style={cardStyle}
            className="search-profile-item"
            onClick={() => onNavigate(`/u/${profile.handle}`)}
          >
            <div style={rowStyle} className="search-profile-row">
              <div style={avatarStyle} className="search-profile-avatar">
                {profile.photoURL ? (
                  <img
                    src={profile.photoURL}
                    alt={fullName}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <span style={fallbackStyle}>
                    {initialsFromName(fullName)}
                  </span>
                )}
              </div>

              <div style={contentStyle}>
                <h3 style={titleStyle}>{fullName}</h3>

                {profile.handle ? (
                  <span style={handleStyle}>@{profile.handle}</span>
                ) : null}
              </div>

              <button
                type="button"
                style={ctaStyle}
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigate(`/u/${profile.handle}`);
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
  );
}