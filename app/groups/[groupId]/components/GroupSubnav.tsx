"use client";

import { CSSProperties } from "react";

type TabKey = "feed" | "members";

type GroupSubnavProps = {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
};

export default function GroupSubnav({
  activeTab,
  onChange,
}: GroupSubnavProps) {
  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const wrapStyle: CSSProperties = {
    display: "flex",
    justifyContent: "center",
    gap: 10,
    flexWrap: "wrap",
  };

  const tabBase: CSSProperties = {
    minWidth: 132,
    height: 42,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.82)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "0 14px",
    cursor: "pointer",
    fontFamily: fontStack,
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1,
    backdropFilter: "blur(10px)",
    transition: "all 160ms ease",
  };

  const activeStyle: CSSProperties = {
    border: "1px solid rgba(255,255,255,0.22)",
    background: "#fff",
    color: "#000",
  };

  return (
    <div style={wrapStyle}>
      <button
        type="button"
        onClick={() => onChange("feed")}
        style={{
          ...tabBase,
          ...(activeTab === "feed" ? activeStyle : null),
        }}
        aria-pressed={activeTab === "feed"}
        title="Publicaciones"
      >
        <span aria-hidden="true">☰</span>
        <span>Publicaciones</span>
      </button>

      <button
        type="button"
        onClick={() => onChange("members")}
        style={{
          ...tabBase,
          ...(activeTab === "members" ? activeStyle : null),
        }}
        aria-pressed={activeTab === "members"}
        title="Integrantes"
      >
        <span aria-hidden="true">👥</span>
        <span>Integrantes</span>
      </button>
    </div>
  );
}