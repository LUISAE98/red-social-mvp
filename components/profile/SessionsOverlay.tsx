"use client";

import { useTranslations } from "next-intl";
import { CSSProperties, useEffect, useMemo, useState } from "react";

import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";
import ListSkeleton from "@/components/ui/ListSkeleton";
import type { UserSession } from "@/types/session";
import {
  getOrCreateSessionId,
  revokeAllSessions,
  subscribeUserSessions,
} from "@/lib/sessions/sessions-service";
import { useConfirm } from "@/lib/hooks/useConfirm";

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

// Distingue celular vs. ordenador a partir del user agent (o de la etiqueta
// legible como fallback). Sirve para elegir el ícono del dispositivo.
function isMobileSession(session: UserSession): boolean {
  const ua = session.userAgent ?? "";
  const label = session.deviceLabel ?? "";
  return (
    /Mobi|Android|iPhone|iPod|Windows Phone|iPad/i.test(ua) ||
    /Android|iOS|iPhone|iPad|iPod/i.test(label)
  );
}

function DeviceGlyph({ mobile }: { mobile: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 42,
        height: 42,
        borderRadius: 12,
        flex: "0 0 auto",
        border: "1px solid transparent",
        background: "transparent",
        display: "grid",
        placeItems: "center",
        color: "#fff",
      }}
    >
      {mobile ? (
        // Celular: teléfono vertical
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
          <rect x="6" y="2" width="12" height="20" rx="2.5" />
          <line x1="10" y1="18.5" x2="14" y2="18.5" />
        </svg>
      ) : (
        // Ordenador: monitor
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
      )}
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

  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { confirm, confirmPanel } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const uid = currentUserId?.trim() || "";

  useEffect(() => {
    setCurrentSessionId(getOrCreateSessionId());
  }, []);

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

  // Cerrar sesión es TODO o NADA, y por eso hay un solo botón.
  //
  // Firebase no sabe revocar un dispositivo suelto: una revocación que solo
  // escribía un campo en Firestore no detenía a quien se llevó el token —le
  // bastaba con no ejecutar el JavaScript de la app—. Los botones por
  // dispositivo llamaban igualmente a `revokeAllSessions`, así que prometían una
  // precisión que no existía: pulsar "cerrar" en un aparato ajeno te cerraba
  // también el tuyo. La lista se queda como lo que sí es, un registro de dónde
  // hay sesión abierta.
  async function handleRevokeOthers() {
    if (!uid || !currentSessionId || busyKey) return;
    const ok = await confirm({
      title: tProfile("sessionsRevokeOthers"),
      body: tProfile("sessionRevokeAllConfirm"),
      confirmLabel: tProfile("sessionRevoke"),
      tone: "danger",
      // La pregunta se abre DESDE este panel, que ya está en 999990. Sin subirla
      // empatan y solo se ve por el orden en que caen en el body; con esto queda
      // por encima por regla, no por casualidad.
      zIndexBase: 1000010,
    });
    if (!ok) return;

    setBusyKey("__others__");
    setError(null);

    try {
      await revokeAllSessions();
    } catch (err: unknown) {
      setError(
        (err instanceof Error ? err.message : null) ??
          tProfile("sessionRevokeError")
      );
    } finally {
      setBusyKey(null);
    }
  }

  const fontStack = "inherit";

  return (
    <VibraResponsivePanel
      open={open}
      onClose={onClose}
      title={tProfile("sessionsTitle")}
      subtitle={tProfile("sessionsDesc")}
      closeAriaLabel={tCommon("closeAriaLabel")}
      maxWidthDesktop={480}
      contentPadding="14px"
    >
      <div>
        <main
          style={{
            display: "grid",
            gap: 10,
            minHeight: 0,
            alignContent: "start",
          }}
        >
          {!uid && <EmptyState text={tProfile("sessionsLoginRequired")} />}

          {/* El renglón de una sesión es glifo del aparato + nombre y lugar. Sin
              `trailing`: ya no hay botón por dispositivo al que reservarle hueco
              a la derecha. */}
          {uid && loading && (
            <ListSkeleton
              rows={4}
              avatarSize={34}
              avatarShape="square"
              padding="0"
            />
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
                width: "100%",
                height: 36,
                borderRadius: 6,
                border: "none",
                background: "rgba(239,68,68,0.16)",
                color: "#ff6b6b",
                fontWeight: 500,
                fontSize: 13,
                fontFamily: fontStack,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: busyKey === "__others__" ? 0.7 : 1,
                cursor: busyKey === "__others__" ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {busyKey === "__others__"
                ? tProfile("sessionRevoking")
                : tProfile("sessionsRevokeOthers")}
            </button>
          )}

          {sessions.map((session) => {
            const isCurrent = session.id === currentSessionId;
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
                  border: "1px solid transparent",
                  background: "transparent",
                  padding: "12px 2px",
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
                  <DeviceGlyph mobile={isMobileSession(session)} />

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
                          fontWeight: 500,
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
                            fontWeight: 500,
                            color: "#bfe9c8",
                            border: "1px solid transparent",
                            background: "transparent",
                            padding: 0,
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

              </div>
            );
          })}
        </main>
      </div>
      {confirmPanel}
    </VibraResponsivePanel>
  );
}
