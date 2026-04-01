"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type { User } from "firebase/auth";

import type {
  CanonicalMemberStatus,
  Community,
  PublicUser,
} from "./GroupsSearchPanel";
import SearchGroupsResults from "./SearchGroupsResults";
import SearchProfilesResults from "./SearchProfilesResults";
import SearchPostsResults from "./SearchPostsResults";

type SearchResultsExplorerPanelProps = {
  open: boolean;
  search: string;
  fontStack: string;
  currentUser: User | null;
  communities: Community[];
  profiles: PublicUser[];
  memberMap: Record<string, CanonicalMemberStatus>;
  reqMap: Record<string, boolean>;
  onClose: () => void;
  onNavigate: (href: string) => void;
  onJoinPublic: (groupId: string) => Promise<void>;
  onRequestPrivate: (groupId: string) => Promise<void>;
  onCancelRequest: (groupId: string) => Promise<void>;
  onLeave: (groupId: string, ownerId?: string) => Promise<void>;
};

type ResultTab = "groups" | "profiles" | "posts";

export function SearchResultsExplorerPanel({
  open,
  search,
  fontStack,
  currentUser,
  communities,
  profiles,
  memberMap,
  reqMap,
  onClose,
  onNavigate,
  onJoinPublic,
  onRequestPrivate,
  onCancelRequest,
  onLeave,
}: SearchResultsExplorerPanelProps) {
  const [activeTab, setActiveTab] = useState<ResultTab>("groups");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveTab("groups");
  }, [open, search]);

  useEffect(() => {
    if (!open) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyTouchAction = document.body.style.touchAction;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.touchAction = previousBodyTouchAction;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [open, onClose]);

  const normalizedSearch = useMemo(() => search.trim(), [search]);

  if (!mounted || !open) return null;

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2147483647,
    isolation: "isolate",
    background: "rgba(0,0,0,0.78)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    display: "grid",
    placeItems: "center",
    padding: 12,
    overscrollBehavior: "contain",
  };

  const panelStyle: CSSProperties = {
    position: "relative",
    zIndex: 2147483647,
    width: "min(960px, 100%)",
    height: "min(86dvh, 840px)",
    maxHeight: "calc(100dvh - 24px)",
    borderRadius: 26,
    border: "1px solid rgba(255,255,255,0.12)",
    background:
      "linear-gradient(180deg, rgba(12,12,12,0.99) 0%, rgba(8,8,8,0.985) 100%)",
    boxShadow:
      "0 32px 90px rgba(0,0,0,0.58), inset 0 1px 0 rgba(255,255,255,0.04)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    color: "#fff",
    fontFamily: fontStack,
    transform: "translateZ(0)",
    minHeight: 0,
  };

  const headerStyle: CSSProperties = {
    padding: "16px 16px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    background: "rgba(255,255,255,0.015)",
    flexShrink: 0,
  };

  const titleWrapStyle: CSSProperties = {
    minWidth: 0,
    display: "grid",
    gap: 4,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: "clamp(18px, 2vw, 22px)",
    fontWeight: 700,
    lineHeight: 1.08,
    letterSpacing: "-0.02em",
    color: "#fff",
  };

  const subtitleStyle: CSSProperties = {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.62)",
  };

  const closeButtonStyle: CSSProperties = {
    minWidth: 40,
    width: 40,
    height: 40,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    cursor: "pointer",
    display: "inline-grid",
    placeItems: "center",
    padding: 0,
    flexShrink: 0,
  };

  const menuShellStyle: CSSProperties = {
    padding: "14px 16px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    flexShrink: 0,
  };

  const segmentedStyle: CSSProperties = {
    width: "100%",
    maxWidth: 520,
    margin: "0 auto",
    borderRadius: 24,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
    padding: 8,
  };

  const tabButtonBaseStyle: CSSProperties = {
    minHeight: 72,
    borderRadius: 18,
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.56)",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    gap: 6,
    padding: "10px 12px",
    textAlign: "center",
    transition: "background 0.16s ease, color 0.16s ease",
  };

  const activeTabStyle: CSSProperties = {
    ...tabButtonBaseStyle,
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  };

  const bodyStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    display: "block",
    position: "relative",
    zIndex: 1,
    WebkitOverflowScrolling: "touch",
  };

  const tabs = [
    {
      key: "groups" as const,
      label: "Comunidades",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 7.5C5 6.12 6.12 5 7.5 5H16.5C17.88 5 19 6.12 19 7.5V16.5C19 17.88 17.88 19 16.5 19H7.5C6.12 19 5 17.88 5 16.5V7.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M8 9H16"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M8 12H16"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M8 15H13"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
    {
      key: "profiles" as const,
      label: "Perfiles",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M8 10.25C8 8.45507 9.45507 7 11.25 7C13.0449 7 14.5 8.45507 14.5 10.25C14.5 12.0449 13.0449 13.5 11.25 13.5C9.45507 13.5 8 12.0449 8 10.25Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M5.5 18C6.31837 15.9919 8.3987 14.75 10.75 14.75H11.75C14.1013 14.75 16.1816 15.9919 17 18"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M18.25 9.25C19.4926 9.25 20.5 10.2574 20.5 11.5C20.5 12.7426 19.4926 13.75 18.25 13.75"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
    {
      key: "posts" as const,
      label: "Publicaciones",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 6.5C6 5.67157 6.67157 5 7.5 5H16.5C17.3284 5 18 5.67157 18 6.5V14.5C18 15.3284 17.3284 16 16.5 16H10.2L7 19V16H7.5C6.67157 16 6 15.3284 6 14.5V6.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M9 9H15"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M9 12H13.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      ),
    },
  ];

  const content = (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={titleWrapStyle}>
            <h2 style={titleStyle}>Resultados de búsqueda</h2>
            <p style={subtitleStyle}>
              Explorando resultados para: <strong>{normalizedSearch || "—"}</strong>
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar resultados"
            title="Cerrar resultados"
            style={closeButtonStyle}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6L18 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div style={menuShellStyle}>
          <div style={segmentedStyle}>
            {tabs.map((tab) => {
              const selected = activeTab === tab.key;

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  style={selected ? activeTabStyle : tabButtonBaseStyle}
                  aria-pressed={selected}
                >
                  {tab.icon}
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: selected ? 700 : 600,
                      lineHeight: 1.2,
                    }}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={bodyStyle}>
          {activeTab === "groups" && (
            <SearchGroupsResults
              fontStack={fontStack}
              currentUser={currentUser}
              communities={communities}
              memberMap={memberMap}
              reqMap={reqMap}
              onNavigate={onNavigate}
              onJoinPublic={onJoinPublic}
              onRequestPrivate={onRequestPrivate}
              onCancelRequest={onCancelRequest}
              onLeave={onLeave}
            />
          )}

          {activeTab === "profiles" && (
            <SearchProfilesResults
              fontStack={fontStack}
              profiles={profiles}
              onNavigate={onNavigate}
            />
          )}

          {activeTab === "posts" && (
            <SearchPostsResults
              fontStack={fontStack}
              search={search}
              currentUser={currentUser}
              onNavigate={onNavigate}
            />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}