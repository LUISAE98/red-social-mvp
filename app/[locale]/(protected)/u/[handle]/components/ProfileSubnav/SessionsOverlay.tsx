"use client";

import { useTranslations } from "next-intl";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { UserSession } from "@/types/session";
import {
  getOrCreateSessionId,
  revokeOtherSessions,
  revokeSession,
  subscribeUserSessions,
} from "@/lib/sessions/sessions-service";

type SessionsOverlayProps = {
  open: boolean;
  currentUserId: string | null | undefined;
  onClose: () => void;
};

function formatRelative(
  lastSeen: UserSession["lastSeenAt"],
  labels: {
    now: string;
    minutes: (n: number) => string;
    hours: (n: number) => string;
    days: (n: number) => string;
    unknown: string;
  }
): string {
  const ms = lastSeen?.toMillis?.();
  if (!ms) return labels.unknown;

  const diff = Date.now() - ms;
  if (diff < 60 * 1000) return labels.now;

  const minutes = Math.floor(diff / (60 * 1000));
  if (minutes < 60) return labels.minutes(minutes);

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return labels.hours(hours);

  const days = Math.floor(hours / 24);
  return labels.days(days);
}

function DeviceGlyph() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 42,
        height: 42,
        borderRadius: 12,
        flex: "0 0 auto",
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.08)",
        display: "grid",
        placeItems: "center",
        color: "#fff",
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px dashed rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.04)",
        padding: 18,
        color: "rgba(255,255,255,0.62)",
        fontSize: 13,
        lineHeight: 1.45,
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

export default function SessionsOverlay({
  open,
  currentUserId,
  onClose,
}: SessionsOverlayProps) {
  const tProfile = useTranslations("profile");
  const tCommon = useTranslations("common");

  const [mounted, setMounted] = useState(false);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const uid = currentUserId?.trim() || "";

  useEffect(() => {
    setMounted(true);
    setCurrentSessionId(getOrCreateSessionId());
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !uid) {
      setSessions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const unsubscribe = subscribeUserSessions(
      uid,
      (next) => {
        setSessions(next);
        setLoading(false);
      },
      (err) => {
        setError(err.message || tProfile("sessionsLoadError"));
        setLoading(false);
      }
    );

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, uid]);

  const otherCount = useMemo(
    () => sessions.filter((s) => s.id !== currentSessionId).length,
    [sessions, currentSessionId]
  );

  const relativeLabels = useMemo(
    () => ({
      now: tProfile("sessionActiveNow"),
      minutes: (n: number) => tProfile("sessionActiveMinutes", { count: n }),
      hours: (n: number) => tProfile("sessionActiveHours", { count: n }),
      days: (n: number) => tProfile("sessionActiveDays", { count: n }),
      unknown: tProfile("sessionActiveUnknown"),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  async function handleRevokeOne(session: UserSession) {
    if (!uid || busyKey) return;

    setBusyKey(session.id);
    setError(null);

    try {
      await revokeSession(uid, session.id);
    } catch (err: unknown) {
      setError(
        (err instanceof Error ? err.message : null) ??
          tProfile("sessionRevokeError")
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRevokeOthers() {
    if (!uid || !currentSessionId || busyKey || otherCount === 0) return;

    setBusyKey("__others__");
    setError(null);

    try {
      await revokeOtherSessions(uid, currentSessionId);
    } catch (err: unknown) {
      setError(
        (err instanceof Error ? err.message : null) ??
          tProfile("sessionRevokeError")
      );
    } finally {
      setBusyKey(null);
    }
  }

  if (!open || !mounted || typeof document === "undefined") return null;

  const fontStack = "inherit";

  const buttonStyle: CSSProperties = {
    minHeight: 34,
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.07)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 800,
    fontFamily: fontStack,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const cardStyle: CSSProperties = {
    width: "min(680px, calc(100vw - 28px))",
    maxHeight: "calc(100dvh - 28px)",
    overflow: "hidden",
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "linear-gradient(180deg, rgba(18,18,18,0.98), rgba(8,8,8,0.98))",
    color: "#fff",
    boxShadow: "0 24px 90px rgba(0,0,0,0.78)",
    fontFamily: fontStack,
    boxSizing: "border-box",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tProfile("sessionsTitle")}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "rgba(0,0,0,0.76)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding:
          "max(14px, env(safe-area-inset-top)) 14px max(14px, env(safe-area-inset-bottom))",
        boxSizing: "border-box",
      }}
    >
      <div style={cardStyle} onClick={(event) => event.stopPropagation()}>
        <style jsx>{`
          @media (max-width: 560px) {
            .session-row {
              grid-template-columns: 1fr !important;
            }

            .session-action {
              width: 100%;
            }
          }
        `}</style>

        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: 18,
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                lineHeight: 1.2,
                fontWeight: 850,
                color: "#fff",
              }}
            >
              {tProfile("sessionsTitle")}
            </h2>

            <p
              style={{
                margin: "6px 0 0",
                fontSize: 12.5,
                lineHeight: 1.45,
                color: "rgba(255,255,255,0.58)",
              }}
            >
              {tProfile("sessionsDesc")}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              ...buttonStyle,
              minWidth: 38,
              padding: "8px 10px",
              fontSize: 16,
              lineHeight: 1,
            }}
            aria-label={tCommon("closeAriaLabel")}
          >
            ×
          </button>
        </header>

        <main
          style={{
            overflowY: "auto",
            padding: 14,
            display: "grid",
            gap: 10,
            minHeight: 0,
            alignContent: "start",
          }}
        >
          {!uid && <EmptyState text={tProfile("sessionsLoginRequired")} />}

          {uid && loading && (
            <EmptyState text={tProfile("sessionsLoading")} />
          )}

          {uid && error && (
            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,90,90,0.28)",
                background: "rgba(255,90,90,0.10)",
                color: "rgba(255,255,255,0.88)",
                padding: 12,
                fontSize: 12.5,
                lineHeight: 1.4,
              }}
            >
              {error}
            </div>
          )}

          {uid && !loading && sessions.length === 0 && !error && (
            <EmptyState text={tProfile("sessionsEmpty")} />
          )}

          {uid && otherCount > 0 && (
            <button
              type="button"
              disabled={busyKey === "__others__"}
              onClick={handleRevokeOthers}
              style={{
                ...buttonStyle,
                width: "100%",
                justifyContent: "center",
                background:
                  busyKey === "__others__"
                    ? "rgba(255,255,255,0.12)"
                    : "rgba(255,90,90,0.14)",
                border: "1px solid rgba(255,90,90,0.30)",
                opacity: busyKey === "__others__" ? 0.75 : 1,
                cursor: busyKey === "__others__" ? "not-allowed" : "pointer",
              }}
            >
              {busyKey === "__others__"
                ? tProfile("sessionRevoking")
                : tProfile("sessionsRevokeOthers")}
            </button>
          )}

          {sessions.map((session) => {
            const isCurrent = session.id === currentSessionId;
            const isBusy = busyKey === session.id;
            const relative = formatRelative(session.lastSeenAt, relativeLabels);
            const location = session.locationLabel?.trim();

            return (
              <div
                className="session-row"
                key={session.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: 12,
                  alignItems: "center",
                  borderRadius: 16,
                  border: isCurrent
                    ? "1px solid rgba(120,200,140,0.35)"
                    : "1px solid rgba(255,255,255,0.09)",
                  background: isCurrent
                    ? "rgba(120,200,140,0.07)"
                    : "rgba(255,255,255,0.04)",
                  padding: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    minWidth: 0,
                  }}
                >
                  <DeviceGlyph />

                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 800,
                          color: "#fff",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {session.deviceLabel}
                      </span>

                      {isCurrent && (
                        <span
                          style={{
                            flex: "0 0 auto",
                            fontSize: 10.5,
                            fontWeight: 800,
                            color: "#bfe9c8",
                            border: "1px solid rgba(120,200,140,0.4)",
                            background: "rgba(120,200,140,0.12)",
                            borderRadius: 999,
                            padding: "2px 8px",
                          }}
                        >
                          {tProfile("sessionThisDevice")}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        marginTop: 3,
                        fontSize: 12,
                        color: "rgba(255,255,255,0.56)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {location ? `${location} · ` : ""}
                      {relative}
                    </div>
                  </div>
                </div>

                {!isCurrent && (
                  <button
                    className="session-action"
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleRevokeOne(session)}
                    style={{
                      ...buttonStyle,
                      background: isBusy ? "rgba(255,255,255,0.12)" : "#fff",
                      color: isBusy ? "#fff" : "#000",
                      opacity: isBusy ? 0.75 : 1,
                      cursor: isBusy ? "not-allowed" : "pointer",
                    }}
                  >
                    {isBusy
                      ? tProfile("sessionRevoking")
                      : tProfile("sessionRevoke")}
                  </button>
                )}
              </div>
            );
          })}
        </main>
      </div>
    </div>,
    document.body
  );
}
