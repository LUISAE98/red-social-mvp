"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, storage } from "@/lib/firebase";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";
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

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function getDaysInMonth(month: string, year: string): number {
  const m = parseInt(month);
  const y = parseInt(year);
  if (!m || !y) return 31;
  return new Date(y, m, 0).getDate();
}

function buildCurrentYears(): number[] {
  const current = new Date().getFullYear();
  return [current, current + 1, current + 2, current + 3];
}

function buildScheduledDate(
  day: string, month: string, year: string,
  hour: string, minute: string, period: "AM" | "PM",
): Date | null {
  if (!day && !month && !year && !hour && !minute) return null;
  if (!day || !month || !year || !hour || !minute) {
    throw new Error("Completa todos los campos de fecha y hora.");
  }
  let h = parseInt(hour);
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, parseInt(minute), 0);
  if (isNaN(date.getTime())) throw new Error("Fecha u hora inválida.");
  return date;
}

async function uploadLiveCover(file: File): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Debes iniciar sesión para subir la portada.");

  const normalized = await normalizeImageFile(file, { maxSizeBytes: 150 * 1024 * 1024 });

  const ext = normalized.file.type === "image/png" ? "png" : "jpg";
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  const path = `live-covers/${uid}/${Date.now()}-${randomId}.${ext}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, normalized.file, {
    contentType: normalized.file.type,
    customMetadata: { uploadedBy: uid, usage: "live_cover" },
  });

  return getDownloadURL(storageRef);
}

function SelectWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      {children}
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="rgba(255,255,255,0.4)" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
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
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);

  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");
  const [period, setPeriod] = useState<"AM" | "PM">("AM");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (open) { setShouldRender(true); return; }
    const t = window.setTimeout(() => setShouldRender(false), 200);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onCloseRef.current(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Revocar URL de preview al desmontar
  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  const daysInMonth = getDaysInMonth(month, year);
  const years = buildCurrentYears();

  function resetForm() {
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setCoverFile(null);
    setCoverPreviewUrl(null);
    setTitle(""); setDescription("");
    setDay(""); setMonth(""); setYear("");
    setHour(""); setMinute(""); setPeriod("AM");
    setError(null);
  }

  function handleClose() {
    if (creating) return;
    resetForm();
    onClose();
  }

  function handleCoverClick() {
    if (creating) return;
    coverInputRef.current?.click();
  }

  function handleCoverFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0] ?? null;
    e.currentTarget.value = "";
    if (!file) return;

    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setCoverFile(file);
    setCoverPreviewUrl(URL.createObjectURL(file));
  }

  async function handleSubmit() {
    if (creating) return;
    if (!title.trim()) { setError("El título es obligatorio."); return; }

    let scheduledDate: Date | null = null;
    try {
      scheduledDate = buildScheduledDate(day, month, year, hour, minute, period);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fecha u hora inválida.");
      return;
    }

    setError(null);
    setCreating(true);

    try {
      let coverUrl: string | null = null;
      if (coverFile) {
        coverUrl = await uploadLiveCover(coverFile);
      }

      if (contextType === "profile" && profileId) {
        await createLivePost({
          contextType: "profile",
          profileId,
          title: title.trim(),
          description: description.trim() || null,
          coverUrl,
          scheduledStartAt: scheduledDate,
        });
      } else if (groupId) {
        await createLivePost({
          groupId,
          title: title.trim(),
          description: description.trim() || null,
          coverUrl,
          scheduledStartAt: scheduledDate,
        });
      } else {
        throw new Error("Contexto inválido para crear el live.");
      }

      resetForm();
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el live.");
    } finally {
      setCreating(false);
    }
  }

  if (!shouldRender || !mounted) return null;

  const selectStyle: CSSProperties = {
    width: "100%",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "#1a0f2e",
    color: "#fff",
    padding: "8px 30px 8px 12px",
    fontSize: 14,
    fontFamily: fontStack,
    outline: "none",
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    cursor: creating ? "not-allowed" : "pointer",
    colorScheme: "dark",
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    padding: "8px 12px",
    fontSize: 14,
    fontFamily: fontStack,
    outline: "none",
    boxSizing: "border-box",
    marginBottom: 8,
  };

  const labelStyle: CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    marginBottom: 3,
    display: "block",
  };

  return createPortal(
    <>
      <style>{`
        @keyframes vibraLiveBackdropIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes vibraLiveBackdropOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        @keyframes vibraLiveModalIn {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
        @keyframes vibraLiveModalOut {
          from { opacity: 1; transform: scale(1)    translateY(0);    }
          to   { opacity: 0; transform: scale(0.94) translateY(10px); }
        }
        .vibra-live-select option {
          background: #1a0f2e;
          color: #fff;
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(0,0,0,0.72)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          animation: open
            ? "vibraLiveBackdropIn 180ms ease-out"
            : "vibraLiveBackdropOut 200ms ease-in forwards",
        }}
      >
        {/* Panel */}
        <div
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Programar live"
          style={{
            width: "100%",
            maxWidth: 460,
            maxHeight: "90vh",
            overflowY: "auto",
            borderRadius: 16,
            background: "rgba(15,10,28,0.97)",
            border: "1px solid rgba(168,85,255,0.18)",
            padding: "12px 20px 12px",
            fontFamily: fontStack,
            color: "#fff",
            boxSizing: "border-box",
            boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
            animation: open
              ? "vibraLiveModalIn 180ms ease-out"
              : "vibraLiveModalOut 200ms ease-in forwards",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="8" stroke="#ef4444" strokeWidth="1.2" fill="none" />
                <circle cx="9" cy="9" r="4.5" fill="#ef4444" />
              </svg>
              Live programado
            </span>
            <button
              type="button"
              onClick={handleClose}
              disabled={creating}
              aria-label="Cerrar"
              style={{
                width: 32, height: 32, borderRadius: 999, border: "none",
                background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)",
                cursor: creating ? "not-allowed" : "pointer",
                fontSize: 18, display: "grid", placeItems: "center", flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              borderRadius: 10, border: "1px solid rgba(255,90,90,0.24)",
              background: "rgba(120,18,18,0.28)", color: "#ffdada",
              padding: "9px 12px", fontSize: 12, lineHeight: 1.4, marginBottom: 14,
            }}>
              {error}
            </div>
          )}

          {/* Portada */}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            style={{ display: "none" }}
            onChange={handleCoverFileChange}
          />

          <label style={labelStyle}>Portada (opcional)</label>
          <button
            type="button"
            onClick={handleCoverClick}
            disabled={creating}
            aria-label={coverPreviewUrl ? "Cambiar portada" : "Agregar portada"}
            style={{
              width: "100%",
              aspectRatio: "16/7",
              borderRadius: 12,
              border: coverPreviewUrl
                ? "none"
                : "1.5px dashed rgba(255,255,255,0.18)",
              background: coverPreviewUrl
                ? "transparent"
                : "radial-gradient(ellipse at center, rgba(180,180,200,0.22) 0%, rgba(120,120,150,0.10) 60%, rgba(80,80,110,0.06) 100%)",
              cursor: creating ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 8,
              overflow: "hidden",
              padding: 0,
              position: "relative",
            }}
          >
            {coverPreviewUrl ? (
              <>
                <img
                  src={coverPreviewUrl}
                  alt="Portada del live"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
                {/* Overlay "Cambiar" */}
                <div style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.45)",
                  opacity: 0,
                  transition: "opacity 150ms ease",
                }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = "0"; }}
                >
                  <span style={{
                    fontSize: 13, fontWeight: 600, color: "#fff",
                    fontFamily: fontStack, letterSpacing: "-0.01em",
                  }}>
                    Cambiar portada
                  </span>
                </div>
              </>
            ) : (
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ pointerEvents: "none" }}>
                <circle cx="18" cy="18" r="16" stroke="#ef4444" strokeWidth="1.8" fill="none" />
                <circle cx="18" cy="18" r="9" fill="#ef4444" />
              </svg>
            )}
          </button>

          {/* Título */}
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

          {/* Descripción */}
          <label style={labelStyle}>Descripción (opcional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Cuéntale a tu audiencia más detalles..."
            disabled={creating}
            maxLength={500}
            rows={3}
            style={{ ...inputStyle, resize: "none", minHeight: 44 }}
          />

          {/* Fecha */}
          <label style={labelStyle}>Fecha de inicio (opcional)</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <SelectWrapper>
              <select value={day} onChange={(e) => setDay(e.target.value)} disabled={creating} style={selectStyle} className="vibra-live-select">
                <option value="">Día</option>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={String(d)}>{d}</option>
                ))}
              </select>
            </SelectWrapper>
            <SelectWrapper>
              <select
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  if (day && parseInt(day) > getDaysInMonth(e.target.value, year)) setDay("");
                }}
                disabled={creating}
                style={selectStyle}
                className="vibra-live-select"
              >
                <option value="">Mes</option>
                {MONTHS_ES.map((name, i) => (
                  <option key={i + 1} value={String(i + 1)}>{name}</option>
                ))}
              </select>
            </SelectWrapper>
            <SelectWrapper>
              <select value={year} onChange={(e) => setYear(e.target.value)} disabled={creating} style={selectStyle} className="vibra-live-select">
                <option value="">Año</option>
                {years.map((y) => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </SelectWrapper>
          </div>

          {/* Hora */}
          <label style={labelStyle}>Hora de inicio (opcional)</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <SelectWrapper>
              <select value={hour} onChange={(e) => setHour(e.target.value)} disabled={creating} style={selectStyle} className="vibra-live-select">
                <option value="">Hora</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={String(h)}>{h}</option>
                ))}
              </select>
            </SelectWrapper>
            <SelectWrapper>
              <select value={minute} onChange={(e) => setMinute(e.target.value)} disabled={creating} style={selectStyle} className="vibra-live-select">
                <option value="">Min</option>
                {["00","05","10","15","20","25","30","35","40","45","50","55"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </SelectWrapper>
            <SelectWrapper>
              <select value={period} onChange={(e) => setPeriod(e.target.value as "AM" | "PM")} disabled={creating} style={selectStyle} className="vibra-live-select">
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </SelectWrapper>
          </div>

          {/* Botón */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={creating}
            style={{
              width: "100%", borderRadius: 12, border: "none",
              background: creating ? "rgba(168,85,255,0.4)" : "linear-gradient(135deg,#a855ff,#7c3aed)",
              color: "#fff", padding: "12px 0", fontSize: 15, fontWeight: 600,
              fontFamily: fontStack, cursor: creating ? "not-allowed" : "pointer",
              letterSpacing: "-0.01em",
            }}
          >
            {creating ? "Creando live..." : "Programar live"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
