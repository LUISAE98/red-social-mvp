"use client";

import { useState, type CSSProperties } from "react";
import { createLivePost } from "@/lib/posts/post-service";

type LiveComposerModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  contextType: "group" | "profile";
  groupId?: string | null;
  profileId?: string | null;
};

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

function toLocalDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export default function LiveComposerModal({
  open,
  onClose,
  onSuccess,
  contextType,
  groupId,
  profileId,
}: LiveComposerModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    if (creating) return;
    setTitle("");
    setDescription("");
    setScheduledAt("");
    setError(null);
    onClose();
  }

  async function handleSubmit() {
    if (creating) return;

    if (!title.trim()) {
      setError("El título es obligatorio.");
      return;
    }

    setError(null);
    setCreating(true);

    try {
      const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;

      if (contextType === "profile" && profileId) {
        await createLivePost({
          contextType: "profile",
          profileId,
          title: title.trim(),
          description: description.trim() || null,
          scheduledStartAt: scheduledDate,
        });
      } else if (groupId) {
        await createLivePost({
          groupId,
          title: title.trim(),
          description: description.trim() || null,
          scheduledStartAt: scheduledDate,
        });
      } else {
        throw new Error("Contexto inválido para crear el live.");
      }

      setTitle("");
      setDescription("");
      setScheduledAt("");
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el live.");
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
    background: "rgba(0,0,0,0.72)",
    backdropFilter: "blur(6px)",
  };

  const panelStyle: CSSProperties = {
    width: "100%",
    maxWidth: 460,
    borderRadius: 16,
    background: "rgba(15,10,28,0.96)",
    border: "1px solid rgba(168,85,255,0.18)",
    padding: "24px 20px 20px",
    fontFamily: fontStack,
    color: "#fff",
    boxSizing: "border-box",
    boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
  };

  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  };

  const titleTextStyle: CSSProperties = {
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    display: "flex",
    alignItems: "center",
    gap: 8,
  };

  const closeBtnStyle: CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 999,
    border: "none",
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.6)",
    cursor: "pointer",
    fontSize: 18,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  };

  const labelStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    marginBottom: 6,
    display: "block",
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    padding: "10px 12px",
    fontSize: 14,
    fontFamily: fontStack,
    outline: "none",
    boxSizing: "border-box",
    marginBottom: 16,
  };

  const textareaStyle: CSSProperties = {
    ...inputStyle,
    resize: "none",
    minHeight: 76,
  };

  const submitBtnStyle: CSSProperties = {
    width: "100%",
    borderRadius: 12,
    border: "none",
    background: creating
      ? "rgba(168,85,255,0.4)"
      : "linear-gradient(135deg,#a855ff,#7c3aed)",
    color: "#fff",
    padding: "12px 0",
    fontSize: 15,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: creating ? "not-allowed" : "pointer",
    letterSpacing: "-0.01em",
    marginTop: 4,
  };

  const errorStyle: CSSProperties = {
    borderRadius: 10,
    border: "1px solid rgba(255,90,90,0.24)",
    background: "rgba(120,18,18,0.28)",
    color: "#ffdada",
    padding: "9px 12px",
    fontSize: 12,
    lineHeight: 1.4,
    marginBottom: 14,
  };

  const minDatetime = toLocalDatetimeValue(new Date());

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={titleTextStyle}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#a855ff"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="2" />
              <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 7.76a6 6 0 0 0 0 8.49" />
              <path d="M20.66 4.34a12 12 0 0 1 0 15.32M3.34 4.34a12 12 0 0 0 0 15.32" />
            </svg>
            Live programado
          </span>
          <button
            type="button"
            onClick={handleClose}
            disabled={creating}
            style={closeBtnStyle}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        <label style={labelStyle}>Título *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="¿De qué va a tratar tu live?"
          disabled={creating}
          maxLength={120}
          style={inputStyle}
          autoFocus
        />

        <label style={labelStyle}>Descripción (opcional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Cuéntale a tu audiencia más detalles..."
          disabled={creating}
          maxLength={500}
          rows={3}
          style={textareaStyle}
        />

        <label style={labelStyle}>Fecha y hora de inicio (opcional)</label>
        <input
          type="datetime-local"
          value={scheduledAt}
          min={minDatetime}
          onChange={(e) => setScheduledAt(e.target.value)}
          disabled={creating}
          style={{
            ...inputStyle,
            colorScheme: "dark",
          }}
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={creating}
          style={submitBtnStyle}
        >
          {creating ? "Creando live..." : "Programar live"}
        </button>
      </div>
    </div>
  );
}
