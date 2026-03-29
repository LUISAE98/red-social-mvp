"use client";

import React, { useEffect, useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

type PostingMode = "members" | "owner_only";

type Props = {
  groupId: string;
  ownerId: string;
  currentUserId: string;
  currentPostingMode?: PostingMode | string | null;
  currentCommentsEnabled?: boolean | null;
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

type SwitchRowProps = {
  label: string;
  description: string;
  checked: boolean;
  busy: boolean;
  leftLabel: string;
  rightLabel: string;
  onToggle: () => void;
};

function PermissionSwitchRow({
  label,
  description,
  checked,
  busy,
  leftLabel,
  rightLabel,
  onToggle,
}: SwitchRowProps) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.035)",
        padding: 12,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "#fff",
            lineHeight: 1.2,
          }}
        >
          {label}
        </div>

        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.66)",
            lineHeight: 1.35,
          }}
        >
          {description}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: checked ? "rgba(255,255,255,0.58)" : "#fff",
            fontWeight: checked ? 500 : 600,
          }}
        >
          {leftLabel}
        </span>

        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          onClick={onToggle}
          disabled={busy}
          style={{
            position: "relative",
            width: 52,
            height: 30,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.14)",
            background: checked ? "#fff" : "rgba(255,255,255,0.10)",
            cursor: busy ? "not-allowed" : "pointer",
            transition: "all 160ms ease",
            opacity: busy ? 0.72 : 1,
            padding: 0,
            WebkitAppearance: "none",
            appearance: "none",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 3,
              left: checked ? 25 : 3,
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: checked ? "#000" : "#fff",
              transition: "all 160ms ease",
              boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
            }}
          />
        </button>

        <span
          style={{
            fontSize: 11,
            color: checked ? "#fff" : "rgba(255,255,255,0.58)",
            fontWeight: checked ? 600 : 500,
          }}
        >
          {rightLabel}
        </span>
      </div>
    </div>
  );
}

export default function OwnerAdminStatus({
  groupId,
  ownerId,
  currentUserId,
  currentPostingMode = "members",
  currentCommentsEnabled = true,
}: Props) {
  const isOwner = useMemo(
    () => ownerId === currentUserId,
    [ownerId, currentUserId]
  );

  const normalizedPostingMode: PostingMode =
    currentPostingMode === "owner_only" ? "owner_only" : "members";

  const normalizedCommentsEnabled = currentCommentsEnabled !== false;

  const [postingMode, setPostingMode] =
    useState<PostingMode>(normalizedPostingMode);
  const [commentsEnabled, setCommentsEnabled] = useState<boolean>(
    normalizedCommentsEnabled
  );

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);

  const [statusBusy, setStatusBusy] = useState(false);
  const [postingBusy, setPostingBusy] = useState(false);
  const [commentsBusy, setCommentsBusy] = useState(false);

  useEffect(() => {
    setPostingMode(normalizedPostingMode);
  }, [normalizedPostingMode]);

  useEffect(() => {
    setCommentsEnabled(normalizedCommentsEnabled);
  }, [normalizedCommentsEnabled]);

  async function setActive(isActive: boolean) {
    if (!isOwner) return;

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

  async function savePostingMode(nextMode: PostingMode) {
    if (!isOwner) return;

    const previousMode = postingMode;

    setPostingBusy(true);
    setStatusMsg(null);
    setStatusErr(null);
    setPostingMode(nextMode);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        "permissions.postingMode": nextMode,
        updatedAt: Date.now(),
      });

      setStatusMsg(
        nextMode === "owner_only"
          ? "Ahora solo el owner puede publicar."
          : "Ahora cualquier miembro puede publicar."
      );
    } catch (e: any) {
      setPostingMode(previousMode);
      setStatusErr(
        e?.message ?? "No se pudo actualizar el permiso de publicación."
      );
    } finally {
      setPostingBusy(false);
    }
  }

  async function saveCommentsEnabled(nextValue: boolean) {
    if (!isOwner) return;

    const previousValue = commentsEnabled;

    setCommentsBusy(true);
    setStatusMsg(null);
    setStatusErr(null);
    setCommentsEnabled(nextValue);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        "permissions.commentsEnabled": nextValue,
        updatedAt: Date.now(),
      });

      setStatusMsg(
        nextValue
          ? "Ahora cualquier miembro autorizado puede comentar."
          : "Ahora solo el owner puede comentar."
      );
    } catch (e: any) {
      setCommentsEnabled(previousValue);
      setStatusErr(
        e?.message ?? "No se pudo actualizar el permiso de comentarios."
      );
    } finally {
      setCommentsBusy(false);
    }
  }

  if (!isOwner) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  const contentStyle: React.CSSProperties = {
    display: "grid",
    gap: 12,
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

  const sectionTitleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 12.5,
    fontWeight: 600,
    color: "#fff",
    letterSpacing: "-0.01em",
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
        Aquí controlas el estado general del grupo y las reglas base de
        publicación/comentarios.
      </div>

      <div
        style={{
          display: "grid",
          gap: 10,
        }}
      >
        <h4 style={sectionTitleStyle}>Permisos del grupo</h4>

        <PermissionSwitchRow
          label="Publicaciones"
          description="Define si solo tú puedes publicar o si cualquier miembro puede hacerlo."
          checked={postingMode === "owner_only"}
          busy={postingBusy}
          leftLabel="Cualquier miembro puede publicar"
          rightLabel="Solo yo puedo publicar"
          onToggle={() =>
            savePostingMode(
              postingMode === "owner_only" ? "members" : "owner_only"
            )
          }
        />

        <PermissionSwitchRow
          label="Comentarios"
          description="Define si los comentarios quedan abiertos para miembros o reservados al owner."
          checked={!commentsEnabled}
          busy={commentsBusy}
          leftLabel="Cualquier miembro puede comentar"
          rightLabel="Solo yo puedo comentar"
          onToggle={() => saveCommentsEnabled(!commentsEnabled)}
        />
      </div>

      <div
        style={{
          display: "grid",
          gap: 10,
          marginTop: 2,
        }}
      >
        <h4 style={sectionTitleStyle}>Estado del grupo</h4>

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
      </div>

      {statusErr && <div style={noticeStyle}>{statusErr}</div>}
      {statusMsg && <div style={noticeStyle}>{statusMsg}</div>}

      <div style={subtleTextStyle}>
        Esta pantalla guarda como fuente de verdad únicamente{" "}
        <code>permissions.postingMode</code>,{" "}
        <code>permissions.commentsEnabled</code>, <code>isActive</code> y{" "}
        <code>updatedAt</code>.
      </div>
    </div>
  );
}