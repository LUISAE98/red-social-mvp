"use client";

import React, { useEffect, useMemo, useState } from "react";
import { updateDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";

type Props = {
  groupId: string;
  ownerId: string;
  currentUserId: string;

  currentName?: string | null;
  currentDescription?: string | null;
  currentCategory?: string | null;
  currentTags?: string[] | null;

  currentAvatarUrl?: string | null;
  currentCoverUrl?: string | null;
};

type TabKey = "general" | "status";

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function SpinningGear() {
  return (
    <>
      <style jsx>{`
        @keyframes ownerGearSpin {
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
          animation: "ownerGearSpin 0.9s linear infinite",
          transformOrigin: "50% 50%",
          opacity: 0.9,
        }}
      >
        ⚙
      </span>
    </>
  );
}

export default function OwnerAdminPanel(props: Props) {
  const {
    groupId,
    ownerId,
    currentUserId,
    currentName = "",
    currentDescription = "",
    currentCategory = null,
    currentTags = null,
  } = props;

  const isOwner = useMemo(
    () => ownerId === currentUserId,
    [ownerId, currentUserId]
  );

  const [tab, setTab] = useState<TabKey>("general");

  const [name, setName] = useState(currentName ?? "");
  const [description, setDescription] = useState(currentDescription ?? "");
  const [category, setCategory] = useState(currentCategory ?? "otros");
  const [tagsRaw, setTagsRaw] = useState((currentTags ?? []).join(", "));
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [generalMsg, setGeneralMsg] = useState<string | null>(null);
  const [generalErr, setGeneralErr] = useState<string | null>(null);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    setName(currentName ?? "");
    setDescription(currentDescription ?? "");
    setCategory(currentCategory ?? "otros");
    setTagsRaw((currentTags ?? []).join(", "));

    setGeneralMsg(null);
    setGeneralErr(null);
    setStatusMsg(null);
    setStatusErr(null);
    setTab("general");
  }, [currentName, currentDescription, currentCategory, currentTags]);

  async function saveGeneral() {
    setSavingGeneral(true);
    setGeneralMsg(null);
    setGeneralErr(null);

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();

    if (trimmedName.length < 3) {
      setSavingGeneral(false);
      setGeneralErr("El nombre debe tener al menos 3 caracteres.");
      return;
    }

    if (trimmedDesc.length < 10) {
      setSavingGeneral(false);
      setGeneralErr("La descripción debe tener al menos 10 caracteres.");
      return;
    }

    const tags = parseTags(tagsRaw);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        name: trimmedName,
        description: trimmedDesc,
        category: category ?? "otros",
        tags,
        updatedAt: Date.now(),
      });

      setGeneralMsg("Cambios guardados.");
    } catch (e: any) {
      setGeneralErr(e?.message ?? "No se pudieron guardar cambios.");
    } finally {
      setSavingGeneral(false);
    }
  }

  async function setActive(isActive: boolean) {
    setStatusBusy(true);
    setStatusMsg(null);
    setStatusErr(null);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        isActive,
        updatedAt: Date.now(),
      });

      setStatusMsg(isActive ? "Grupo reactivado." : "Grupo pausado.");
    } catch (e: any) {
      setStatusErr(e?.message ?? "No se pudo actualizar el estado.");
    } finally {
      setStatusBusy(false);
    }
  }

  if (!isOwner) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  const shellStyle: React.CSSProperties = {
    width: "100%",
    marginTop: 14,
    fontFamily: fontStack,
  };

  const cardStyle: React.CSSProperties = {
    width: "100%",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.028)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    color: "#fff",
    overflow: "hidden",
    boxSizing: "border-box",
  };

  const headerStyle: React.CSSProperties = {
    padding: "14px 14px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: "clamp(15px, 1.8vw, 17px)",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    lineHeight: 1.08,
    color: "#fff",
  };

  const subtitleStyle: React.CSSProperties = {
    margin: "4px 0 0 0",
    fontSize: 12,
    color: "rgba(255,255,255,0.64)",
    lineHeight: 1.35,
  };

  const bodyStyle: React.CSSProperties = {
    padding: 12,
    display: "grid",
    gap: 12,
  };

  const tabsRowStyle: React.CSSProperties = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  };

  const tabBaseStyle: React.CSSProperties = {
    minHeight: 34,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.88)",
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: fontStack,
    lineHeight: 1,
    cursor: "pointer",
    WebkitAppearance: "none",
  };

  const tabActiveStyle: React.CSSProperties = {
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.16)",
  };

  const contentStyle: React.CSSProperties = {
    display: "grid",
    gap: 10,
  };

  const fieldStyle: React.CSSProperties = {
    display: "grid",
    gap: 5,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 500,
    color: "rgba(255,255,255,0.88)",
    lineHeight: 1.15,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 40,
    padding: "0 11px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.035)",
    color: "#fff",
    outline: "none",
    fontSize: 12.5,
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
    WebkitAppearance: "none",
    appearance: "none",
  };

  const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    minHeight: 96,
    padding: "10px 11px",
    resize: "vertical",
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
    width: "100%",
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
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    width: "auto",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
  };

  const statusActionsStyle: React.CSSProperties = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  };

  return (
    <div style={shellStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <h3 style={titleStyle}>Administración del grupo</h3>
          <p style={subtitleStyle}>Configura nombre, descripción, categoría y estado.</p>
        </div>

        <div style={bodyStyle}>
          <div style={tabsRowStyle}>
            <button
              type="button"
              onClick={() => setTab("general")}
              style={{
                ...tabBaseStyle,
                ...(tab === "general" ? tabActiveStyle : {}),
              }}
            >
              General
            </button>

            <button
              type="button"
              onClick={() => setTab("status")}
              style={{
                ...tabBaseStyle,
                ...(tab === "status" ? tabActiveStyle : {}),
              }}
            >
              Estado
            </button>
          </div>

          {tab === "general" && (
            <div style={contentStyle}>
              <div style={fieldStyle}>
                <span style={labelStyle}>Nombre</span>
                <input
                  style={inputStyle}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nombre del grupo"
                />
              </div>

              <div style={fieldStyle}>
                <span style={labelStyle}>Descripción</span>
                <textarea
                  style={textareaStyle}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe el propósito del grupo"
                />
              </div>

              <div style={fieldStyle}>
                <span style={labelStyle}>Categoría</span>
                <select
                  style={inputStyle}
                  value={category ?? "otros"}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="otros" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Otros
                  </option>
                  <option value="entretenimiento" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Entretenimiento
                  </option>
                  <option value="influencer" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Influencer
                  </option>
                  <option value="actor" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Actor
                  </option>
                  <option value="comediante" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Comediante
                  </option>
                  <option value="cantante" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Cantante
                  </option>
                  <option value="youtuber" style={{ background: "#0c0c0c", color: "#fff" }}>
                    YouTuber
                  </option>
                  <option value="streamer" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Streamer
                  </option>
                  <option value="podcaster" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Podcaster
                  </option>
                  <option value="tecnologia" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Tecnología
                  </option>
                  <option value="videojuegos" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Videojuegos
                  </option>
                  <option value="fitness" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Fitness
                  </option>
                  <option value="negocios" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Negocios
                  </option>
                  <option value="educacion" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Educación
                  </option>
                  <option value="viajes" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Viajes
                  </option>
                  <option value="comida" style={{ background: "#0c0c0c", color: "#fff" }}>
                    Comida
                  </option>
                </select>
              </div>

              <div style={fieldStyle}>
                <span style={labelStyle}>Tags</span>
                <input
                  style={inputStyle}
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="drift, autos, carreras"
                />
                <div style={subtleTextStyle}>Máximo 10 tags separadas por coma.</div>
              </div>

              {generalErr && <div style={noticeStyle}>{generalErr}</div>}
              {generalMsg && <div style={noticeStyle}>{generalMsg}</div>}

              <button
                type="button"
                onClick={saveGeneral}
                disabled={savingGeneral}
                style={{
                  ...primaryButtonStyle,
                  opacity: savingGeneral ? 0.84 : 1,
                  cursor: savingGeneral ? "not-allowed" : "pointer",
                  background: savingGeneral ? "rgba(255,255,255,0.18)" : "#fff",
                  color: savingGeneral ? "#fff" : "#000",
                }}
              >
                {savingGeneral ? (
                  <>
                    <SpinningGear />
                    Guardando...
                  </>
                ) : (
                  "Guardar cambios"
                )}
              </button>
            </div>
          )}

          {tab === "status" && (
            <div style={contentStyle}>
              <div style={subtleTextStyle}>
                Pausar un grupo lo marca como inactivo. No elimina contenido.
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
                    width: "auto",
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
                Después puedes agregar confirmación fuerte y motivo de auditoría
                para una baja más avanzada.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}