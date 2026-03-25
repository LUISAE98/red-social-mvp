"use client";

import type { CSSProperties } from "react";

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
  const shellStyle: CSSProperties = {
    minHeight: 0,
    overflowY: "auto",
    padding: 16,
    display: "grid",
    gap: 12,
  };

  const emptyStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "16px 18px",
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 1.5,
  };

  const cardStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.025)",
    padding: 14,
    display: "grid",
    gap: 12,
    cursor: "pointer",
  };

  const rowStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    gap: 12,
    alignItems: "center",
  };

  const avatarStyle: CSSProperties = {
    width: 56,
    height: 56,
    borderRadius: "50%",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    display: "grid",
    placeItems: "center",
  };

  const fallbackStyle: CSSProperties = {
    color: "#fff",
    fontSize: 15,
    fontWeight: 700,
  };

  const contentStyle: CSSProperties = {
    minWidth: 0,
    display: "grid",
    gap: 7,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    color: "#fff",
    fontSize: 15.5,
    fontWeight: 700,
    lineHeight: 1.2,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const metaRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  };

  const pillStyle: CSSProperties = {
    fontSize: 12,
    padding: "4px 9px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.88)",
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };

  const inlineStyle: CSSProperties = {
    fontSize: 12,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.3,
  };

  const ctaStyle: CSSProperties = {
    minHeight: 38,
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    fontFamily: fontStack,
    whiteSpace: "nowrap",
  };

  if (profiles.length === 0) {
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
      {profiles.map((profile) => {
        const fullName =
          profile.displayName?.trim() ||
          `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() ||
          profile.handle ||
          "Usuario";

        return (
          <article
            key={profile.uid}
            style={cardStyle}
            onClick={() => onNavigate(`/u/${profile.handle}`)}
          >
            <div style={rowStyle}>
              <div style={avatarStyle}>
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

                <div style={metaRowStyle}>
                  <span style={pillStyle}>@{profile.handle}</span>
                  <span style={inlineStyle}>Perfil público</span>
                </div>
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
    </section>
  );
}