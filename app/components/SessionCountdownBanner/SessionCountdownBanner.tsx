"use client";

import { useEffect, useState } from "react";
import { useBuyerNextSession } from "@/lib/hooks/useBuyerNextSession";
import { setMeetGreetPreparing } from "@/lib/meetGreet/meetGreetRequests";
import { setExclusiveSessionPreparing } from "@/lib/exclusiveSession/exclusiveSessionRequests";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export default function SessionCountdownBanner({ uid }: { uid: string }) {
  const { session, loading } = useBuyerNextSession(uid);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  if (loading || !session) return null;

  const msLeft = session.scheduledAt.getTime() - now;
  const canPrepare = msLeft <= 15 * 60 * 1000;
  const serviceLabel =
    session.serviceKind === "exclusive_session" ? "exclusiva" : "en vivo";
  const creatorName = session.creatorDisplayName ?? "tu creador";

  async function handlePrepare() {
    if (!session || busy || !canPrepare) return;
    setBusy(true);
    try {
      if (session.serviceKind === "meet_greet") {
        await setMeetGreetPreparing({ requestId: session.id, role: "buyer" });
      } else {
        await setExclusiveSessionPreparing({ requestId: session.id, role: "buyer" });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        width: "100%",
        background:
          "linear-gradient(135deg, rgba(90,41,174,0.22) 0%, rgba(168,85,255,0.14) 100%)",
        border: "1px solid rgba(168,85,255,0.28)",
        borderRadius: 12,
        padding: "16px 18px",
        marginBottom: 14,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.55)",
          marginBottom: 6,
          fontWeight: 500,
          letterSpacing: "-0.01em",
        }}
      >
        Sesión {serviceLabel} con {creatorName}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "#fff",
          letterSpacing: "-0.03em",
          fontVariantNumeric: "tabular-nums",
          marginBottom: 14,
        }}
      >
        Faltan {formatCountdown(msLeft)}
      </div>
      {!canPrepare && (
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.45)",
            marginBottom: 10,
            lineHeight: 1.4,
          }}
        >
          Faltando 15 minutos podrás prepararte para entrar a tu sesión
        </div>
      )}
      <button
        type="button"
        onClick={handlePrepare}
        disabled={!canPrepare || busy}
        style={{
          width: "100%",
          height: 40,
          borderRadius: 8,
          border: "none",
          background:
            canPrepare && !busy
              ? "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)"
              : "rgba(255,255,255,0.08)",
          color: canPrepare && !busy ? "#fff" : "rgba(255,255,255,0.28)",
          fontSize: 15,
          fontWeight: 600,
          cursor: canPrepare && !busy ? "pointer" : "not-allowed",
          fontFamily: "inherit",
          letterSpacing: "-0.02em",
          transition: "background 0.2s",
        }}
      >
        {busy ? "Procesando..." : "Prepararse"}
      </button>
    </div>
  );
}
