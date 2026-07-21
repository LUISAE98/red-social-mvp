"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  buildInviteAbsoluteUrl,
  listInviteLinks,
  revokeInviteLink,
  type InviteLinkListItem,
} from "@/lib/groups/inviteLinks";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

type Props = {
  groupId: string;
  /** Cambia para forzar un re-fetch (p. ej. tras crear un link). */
  refreshKey?: number;
};

async function copyToClipboardWithFallback(text: string) {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof window !== "undefined" &&
    window.isSecureContext
  ) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document === "undefined") return false;

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  try {
    const ok = document.execCommand("copy");
    document.body.removeChild(textArea);
    return ok;
  } catch {
    document.body.removeChild(textArea);
    return false;
  }
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export default function InviteLinksList({ groupId, refreshKey }: Props) {
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");
  const { toast, showToast } = useVibraToast();

  const [links, setLinks] = useState<InviteLinkListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const fetchLinks = useCallback(async () => {
    try {
      const res = await listInviteLinks(groupId);
      setLinks(Array.isArray(res.links) ? res.links : []);
    } catch {
      /* silencioso: si falla, no mostramos nada */
    } finally {
      setLoaded(true);
    }
  }, [groupId]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks, refreshKey]);

  // Solo vigentes (no expirados). El "reloj" se recalcula cada segundo.
  const visibleLinks = useMemo(
    () => links.filter((l) => (l.expiresAtMs ?? 0) > now),
    [links, now]
  );

  // Un solo intervalo mientras haya links por mostrar.
  useEffect(() => {
    if (links.length === 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [links.length]);

  const formatRemaining = useCallback(
    (msLeft: number) => {
      const totalSec = Math.max(0, Math.floor(msLeft / 1000));
      const days = Math.floor(totalSec / 86400);
      if (days >= 1) {
        // Faltan días → solo días.
        return tGroups("linkExpiresInDays", { count: days });
      }
      // Menos de un día → horas:minutos:segundos.
      const h = Math.floor((totalSec % 86400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    },
    [tGroups]
  );

  const handleCopy = useCallback(
    async (l: InviteLinkListItem) => {
      const url = buildInviteAbsoluteUrl(l.token);
      try {
        const ok = await copyToClipboardWithFallback(url);
        if (!ok) {
          showToast(tGroups("copyManuallyError"), "error");
          return;
        }
        showToast(tCommon("linkCopiedToClipboard"), "success");
      } catch {
        showToast(tGroups("copyManuallyError"), "error");
      }
    },
    [showToast, tGroups, tCommon]
  );

  const handleKill = useCallback(
    async (l: InviteLinkListItem) => {
      // Dos toques: el primero pide confirmación, el segundo ejecuta.
      if (confirmId !== l.id) {
        setConfirmId(l.id);
        return;
      }
      try {
        setRevokingId(l.id);
        await revokeInviteLink({ groupId, inviteLinkId: l.id });
        setLinks((cur) => cur.filter((x) => x.id !== l.id));
        showToast(tGroups("linkRevokedSuccess"), "success");
      } catch {
        showToast(tGroups("linkRevokeError"), "error");
      } finally {
        setRevokingId(null);
        setConfirmId(null);
      }
    },
    [confirmId, groupId, showToast, tGroups]
  );

  if (!loaded || visibleLinks.length === 0) return null;

  const cardStyle: React.CSSProperties = {
    display: "grid",
    gap: 6,
    padding: "10px 12px",
    borderRadius: 8,
    border: "none",
    background: "rgba(20,10,35,0.55)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    color: "#fff",
    maxWidth: 260,
    boxSizing: "border-box",
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  };

  const iconButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 26,
    height: 26,
    padding: 0,
    borderRadius: 6,
    border: "none",
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    cursor: "pointer",
  };

  const linkTextStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.2,
    color: "rgba(255,255,255,0.92)",
  };

  const metaStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    lineHeight: 1.2,
    color: "rgba(255,255,255,0.7)",
  };

  const countdownStyle: React.CSSProperties = {
    fontVariantNumeric: "tabular-nums",
    fontWeight: 700,
    color: "rgba(255,255,255,0.9)",
  };

  const killButtonStyle: React.CSSProperties = {
    justifySelf: "start",
    padding: 0,
    border: "none",
    background: "transparent",
    color: "#ff6b6b",
    fontSize: 11.5,
    fontWeight: 700,
    lineHeight: 1,
    cursor: "pointer",
  };

  return (
    <>
      <VibraToast toast={toast} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visibleLinks.map((l) => {
          const display = buildInviteAbsoluteUrl(l.token).replace(
            /^https?:\/\//,
            ""
          );
          const usesText =
            l.maxUses != null
              ? tGroups("linkUsesWithMax", { used: l.usedCount, max: l.maxUses })
              : tGroups("linkUses", { count: l.usedCount });
          const msLeft = (l.expiresAtMs ?? 0) - now;
          const isConfirming = confirmId === l.id;
          const isRevoking = revokingId === l.id;

          return (
            <div key={l.id} style={cardStyle}>
              <div style={rowStyle}>
                <button
                  type="button"
                  onClick={() => handleCopy(l)}
                  style={iconButtonStyle}
                  title={tGroups("copyLinkButton")}
                  aria-label={tGroups("copyLinkButton")}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      fill="currentColor"
                      d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"
                    />
                  </svg>
                </button>
                <span style={linkTextStyle} title={display}>
                  {display}
                </span>
              </div>

              <div style={metaStyle}>
                <span>{usesText}</span>
                <span aria-hidden="true">·</span>
                <span style={countdownStyle}>
                  {msLeft > 0 ? formatRemaining(msLeft) : tGroups("linkExpired")}
                </span>
              </div>

              <button
                type="button"
                onClick={() => handleKill(l)}
                disabled={isRevoking}
                style={{
                  ...killButtonStyle,
                  opacity: isRevoking ? 0.6 : 1,
                  cursor: isRevoking ? "not-allowed" : "pointer",
                }}
              >
                {isRevoking
                  ? tGroups("killingLink")
                  : isConfirming
                  ? tGroups("killLinkConfirm")
                  : tGroups("killLink")}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
