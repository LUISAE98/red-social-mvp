"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";

export type MediaTabKey = "feed" | "photos" | "videos" | "lives";

/** Orden de las sub-pestañas, para calcular la dirección del slide (como Wallet). */
export const MEDIA_TAB_ORDER: Record<MediaTabKey, number> = {
  feed: 0,
  photos: 1,
  videos: 2,
  lives: 3,
};

const TABS: { key: MediaTabKey; labelKey: string }[] = [
  { key: "feed", labelKey: "mediaTabPosts" },
  { key: "photos", labelKey: "mediaTabPhotos" },
  { key: "videos", labelKey: "mediaTabVideos" },
  { key: "lives", labelKey: "mediaTabLives" },
];

/**
 * Sub-subnav secundario dentro de la pestaña Publicaciones/Feed:
 * Publicaciones · Fotos · Videos · En vivo.
 */
export default function PostsMediaSubnav({
  active,
  onChange,
}: {
  active: MediaTabKey;
  onChange: (key: MediaTabKey) => void;
}) {
  const tPosts = useTranslations("posts");

  return (
    <div style={wrapStyle} role="tablist" aria-label={tPosts("mediaTabsLabel")}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            style={{
              ...tabButtonStyle,
              color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
              fontWeight: isActive ? 700 : 500,
            }}
          >
            {tPosts(tab.labelKey)}
            <span
              aria-hidden="true"
              style={{
                ...indicatorStyle,
                background: isActive ? "#fff" : "transparent",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: 2,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  marginBottom: 12,
};

const tabButtonStyle: CSSProperties = {
  position: "relative",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  padding: "10px 4px 11px",
  fontSize: 13,
  letterSpacing: "-0.01em",
  fontFamily: "inherit",
  WebkitTapHighlightColor: "transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const indicatorStyle: CSSProperties = {
  position: "absolute",
  left: 8,
  right: 8,
  bottom: -1,
  height: 2,
  borderRadius: 2,
  transition: "background 160ms ease",
};
