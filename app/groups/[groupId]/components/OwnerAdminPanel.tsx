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
    currentAvatarUrl = null,
    currentCoverUrl = null,
    isOpen,
    onClose,
  } = props;

  const isOwner = useMemo(
    () => ownerId === currentUserId,
    [ownerId, currentUserId]
  );

  const [tab, setTab] = useState<TabKey>("general");

  const PANEL_WIDTH = 360;
  const PANEL_MIN_HEIGHT = 0;

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

      setGeneralMsg("✅ Cambios guardados.");
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

      setStatusMsg(isActive ? "✅ Grupo reactivado." : "✅ Grupo pausado.");
    } catch (e: any) {
      setStatusErr(e?.message ?? "No se pudo actualizar el estado.");
    } finally {
      setStatusBusy(false);
    }
  }

  if (!isOwner || !isOpen) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const card: React.CSSProperties = {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "rgba(12,12,12,0.92)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    overflow: "hidden",
    color: "#fff",
    backdropFilter: "blur(10px)",
  };

  const panel: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 12,
    padding: 10,
    background: "rgba(255,255,255,0.03)",
  };

  const subtle: React.CSSProperties = {
    fontSize: 12,
    color: "rgba(255,255,255,0.72)",
    fontWeight: 400,
  };

  const buttonPrimary: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.28)",
    background: "#fff",
    color: "#000",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 13,
  };

  const buttonSecondary: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.20)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 13,
  };

  const tabBase: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.20)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 13,
  };

  const tabActive: React.CSSProperties = {
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.28)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.22)",
    color: "#fff",
    outline: "none",
    fontSize: 13,
    fontWeight: 400,
    boxSizing: "border-box",
  };

  const messageBox: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: 400,
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        top: 144,
        width: PANEL_WIDTH,
        zIndex: 19999,
        fontFamily: fontStack,
      }}
    >
      <div style={card}>
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            border: "none",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 14,
          }}
          aria-label="Cerrar panel"
          title="Cerrar"
        >
          <span>Administración del grupo</span>
          <span style={{ fontSize: 12, opacity: 0.9, fontWeight: 400 }}>✕</span>
        </button>

        <div style={{ padding: 12, display: "grid", gap: 12, minHeight: PANEL_MIN_HEIGHT }}>
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
                Pausar / Baja
              </button>
            </div>
          </div>

          {tab === "general" && (
            <div style={panel}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>Nombre</div>
                  <input
                    style={inputStyle}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>Descripción</div>
                  <textarea
                    style={{
                      ...inputStyle,
                      minHeight: 84,
                      resize: "vertical",
                    }}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>Categoría</div>
                  <select
                    style={inputStyle}
                    value={category ?? "otros"}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="otros">Otros</option>
                    <option value="entretenimiento">Entretenimiento</option>
                    <option value="influencer">Influencer</option>
                    <option value="actor">Actor</option>
                    <option value="comediante">Comediante</option>
                    <option value="cantante">Cantante</option>
                    <option value="youtuber">YouTuber</option>
                    <option value="streamer">Streamer</option>
                    <option value="podcaster">Podcaster</option>
                    <option value="tecnologia">Tecnología</option>
                    <option value="videojuegos">Videojuegos</option>
                    <option value="fitness">Fitness</option>
                    <option value="negocios">Negocios</option>
                    <option value="educacion">Educación</option>
                    <option value="viajes">Viajes</option>
                    <option value="comida">Comida</option>
                  </select>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>Tags (coma)</div>
                  <input
                    style={inputStyle}
                    value={tagsRaw}
                    onChange={(e) => setTagsRaw(e.target.value)}
                  />
                  <div style={subtle}>Máximo 10 tags. Se guardan como array.</div>
                </div>

                {generalErr && (
                  <div style={messageBox}>
                    ❌ {generalErr}
                  </div>
                )}

                {generalMsg && (
                  <div style={messageBox}>
                    {generalMsg}
                  </div>
                )}

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
                    background: savingGeneral ? "rgba(255,255,255,0.15)" : "#fff",
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
                  Pausar un grupo lo marca como inactivo (soft). No borra contenido.
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                      background: statusBusy ? "rgba(255,255,255,0.15)" : "#fff",
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

                {statusErr && (
                  <div style={messageBox}>
                    ❌ {statusErr}
                  </div>
                )}

                {statusMsg && (
                  <div style={messageBox}>
                    {statusMsg}
                  </div>
                )}

                <div style={subtle}>
                  Más adelante podemos agregar confirmación fuerte y motivo/auditoría para “dar de baja”.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}