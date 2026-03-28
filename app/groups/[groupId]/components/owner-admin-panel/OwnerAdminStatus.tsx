"use client";

import React, { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

type Props = {
  groupId: string;
  ownerId: string;
  currentUserId: string;
};

function SpinningGear() {
  return (
    <>
      <style jsx>{`
        @keyframes ownerStatusGearSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          animation: "ownerStatusGearSpin 0.9s linear infinite",
          transformOrigin: "50% 50%",
          opacity: 0.9,
        }}
      >
        ⚙
      </span>
    </>
  );
}

export default function OwnerAdminStatus({
  groupId,
  ownerId,
  currentUserId,
}: Props) {
  const isOwner = useMemo(
    () => ownerId === currentUserId,
    [ownerId, currentUserId]
  );

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  async function setActive(isActive: boolean) {
    setStatusBusy(true);
    setStatusMsg(null);
    setStatusErr(null);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        isActive,
        updatedAt: Date.now(),
      });

      setStatusMsg(isActive ? "Comunidad reactivada." : "Comunidad pausada.");
    } catch (e: any) {
      setStatusErr(e?.message ?? "No se pudo actualizar el estado.");
    } finally {
      setStatusBusy(false);
    }
  }

  if (!isOwner) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  const contentStyle: React.CSSProperties = {
    display: "grid",
    gap: 10,
  };

  const subtleTextStyle: React.CSSProperties = {
    fontSize: 10.5,
    color: "rgba(255,255,255,0.60)",
    lineHeight: 1.35,
  };

  const noticeStyle: React.CSSProperties = {
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.035)",
    padding: "8px 10px",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.84)",
  };

  const primaryButtonStyle: React.CSSProperties = {
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#fff",
    color: "#000",
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    WebkitAppearance: "none",
    appearance: "none",
    width: "auto",
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
  };

  const statusActionsStyle: React.CSSProperties = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  };

  return (
    <div style={contentStyle}>
      <div style={subtleTextStyle}>
        Pausar una comunidad la marca como inactiva. No elimina contenido.
      </div>

      <div style={statusActionsStyle}>
        <button
          type="button"
          onClick={() => setActive(false)}
          disabled={statusBusy}
          style={{
            ...secondaryButtonStyle,
            flex: "1 1 160px",
            opacity: statusBusy ? 0.72 : 1,
            cursor: statusBusy ? "not-allowed" : "pointer",
          }}
        >
          {statusBusy ? (
            <>
              <SpinningGear />
              Procesando...
            </>
          ) : (
            "Pausar"
          )}
        </button>

        <button
          type="button"
          onClick={() => setActive(true)}
          disabled={statusBusy}
          style={{
            ...primaryButtonStyle,
            flex: "1 1 160px",
            opacity: statusBusy ? 0.84 : 1,
            cursor: statusBusy ? "not-allowed" : "pointer",
            background: statusBusy ? "rgba(255,255,255,0.18)" : "#fff",
            color: statusBusy ? "#fff" : "#000",
          }}
        >
          {statusBusy ? (
            <>
              <SpinningGear />
              Procesando...
            </>
          ) : (
            "Reactivar"
          )}
        </button>
      </div>

      {statusErr && <div style={noticeStyle}>{statusErr}</div>}
      {statusMsg && <div style={noticeStyle}>{statusMsg}</div>}

      <div style={subtleTextStyle}>
        Después puedes agregar confirmación fuerte y motivo de auditoría para una baja más avanzada.
      </div>
    </div>
  );
}