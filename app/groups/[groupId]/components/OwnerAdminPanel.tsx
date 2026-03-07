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

  isOpen: boolean;
  onClose: () => void;
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
          fontWeight: 400,
          opacity: 0.92,
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
    isOpen,
    onClose,
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
    if (!isOpen) return;

    setName(currentName ?? "");
    setDescription(currentDescription ?? "");
    setCategory(currentCategory ?? "otros");
    setTagsRaw((currentTags ?? []).join(", "));

    setGeneralMsg(null);
    setGeneralErr(null);
    setStatusMsg(null);
    setStatusErr(null);
    setTab("general");
  }, [isOpen, currentName, currentDescription, currentCategory, currentTags]);

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

  if (!isOwner || !isOpen) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const shellStyle: React.CSSProperties = {
    position: "fixed",
    right: 14,
    top: 96,
    width: "min(320px, calc(100vw - 24px))",
    maxHeight: "calc(100vh - 110px)",
    zIndex: 19999,
    fontFamily: fontStack,
  };

  const card: React.CSSProperties = {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(12,12,12,0.92)",
    boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
    overflow: "hidden",
    color: "#fff",
    backdropFilter: "blur(10px)",
    display: "flex",
    flexDirection: "column",
    maxHeight: "calc(100vh - 110px)",
  };

  const scrollBody: React.CSSProperties = {
    padding: 12,
    display: "grid",
    gap: 10,
    overflowY: "auto",
    minHeight: 0,
  };

  const panel: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 10,
    background: "rgba(255,255,255,0.03)",
  };

  const subtle: React.CSSProperties = {
    fontSize: 12,
    color: "rgba(255,255,255,0.68)",
    fontWeight: 400,
    lineHeight: 1.35,
  };

  const labelStyle: React.CSSProperties = {
    fontWeight: 500,
    fontSize: 12,
    color: "#fff",
  };

  const buttonPrimary: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "#fff",
    color: "#000",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 13,
    lineHeight: 1.1,
  };

  const buttonSecondary: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 13,
    lineHeight: 1.1,
  };

  const tabBase: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 13,
    lineHeight: 1.1,
  };

  const tabActive: React.CSSProperties = {
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.18)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 11px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.22)",
    color: "#fff",
    outline: "none",
    fontSize: 13,
    fontWeight: 400,
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    background: "rgba(0,0,0,0.22)",
    color: "#fff",
  };

  const messageBox: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 400,
    lineHeight: 1.35,
  };

  return (
    <div style={shellStyle}>
      <div style={card}>
        <div
          style={{
            padding: "11px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ display: "grid", gap: 3 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "#fff",
                letterSpacing: -0.2,
              }}
            >
              Administración del grupo
            </div>
            <div style={subtle}>Panel compacto de edición</div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel"
            title="Cerrar"
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.04)",
              color: "#fff",
              width: 30,
              height: 30,
              borderRadius: 9,
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        <div style={scrollBody}>
          <div style={panel}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setTab("general")}
                style={{
                  ...tabBase,
                  ...(tab === "general" ? tabActive : {}),
                }}
              >
                General
              </button>

              <button
                type="button"
                onClick={() => setTab("status")}
                style={{
                  ...tabBase,
                  ...(tab === "status" ? tabActive : {}),
                }}
              >
                Estado
              </button>
            </div>
          </div>

          {tab === "general" && (
            <div style={panel}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={labelStyle}>Nombre</div>
                  <input
                    style={inputStyle}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={labelStyle}>Descripción</div>
                  <textarea
                    style={{
                      ...inputStyle,
                      minHeight: 82,
                      resize: "vertical",
                    }}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={labelStyle}>Categoría</div>
                  <select
                    style={selectStyle}
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

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={labelStyle}>Tags</div>
                  <input
                    style={inputStyle}
                    value={tagsRaw}
                    onChange={(e) => setTagsRaw(e.target.value)}
                    placeholder="drift, autos, carreras"
                  />
                  <div style={subtle}>Máximo 10 tags separadas por coma.</div>
                </div>

                {generalErr && <div style={messageBox}>{generalErr}</div>}
                {generalMsg && <div style={messageBox}>{generalMsg}</div>}

                <button
                  type="button"
                  onClick={saveGeneral}
                  disabled={savingGeneral}
                  style={{
                    ...buttonPrimary,
                    width: "100%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    background: savingGeneral ? "rgba(255,255,255,0.18)" : "#fff",
                    color: savingGeneral ? "#fff" : "#000",
                    cursor: savingGeneral ? "not-allowed" : "pointer",
                    opacity: savingGeneral ? 0.8 : 1,
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
            </div>
          )}

          {tab === "status" && (
            <div style={panel}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={subtle}>
                  Pausar un grupo lo marca como inactivo. No elimina contenido.
                </div>

                <div
                  style={{
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 10,
                    background: "rgba(0,0,0,0.18)",
                    padding: 9,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setActive(false)}
                    disabled={statusBusy}
                    style={{
                      ...buttonSecondary,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      cursor: statusBusy ? "not-allowed" : "pointer",
                      opacity: statusBusy ? 0.7 : 1,
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
                      ...buttonPrimary,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      background: statusBusy ? "rgba(255,255,255,0.18)" : "#fff",
                      color: statusBusy ? "#fff" : "#000",
                      cursor: statusBusy ? "not-allowed" : "pointer",
                      opacity: statusBusy ? 0.8 : 1,
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

                {statusErr && <div style={messageBox}>{statusErr}</div>}
                {statusMsg && <div style={messageBox}>{statusMsg}</div>}

                <div style={subtle}>
                  Después puedes agregar confirmación fuerte y motivo de auditoría para una baja más avanzada.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}