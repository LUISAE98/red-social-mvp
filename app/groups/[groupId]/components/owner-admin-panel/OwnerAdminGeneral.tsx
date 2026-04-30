"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

type GroupVisibility = "public" | "private" | "hidden";
type EditField = "name" | "description" | "visibility" | "category" | "tags";

type Props = {
  groupId: string;
  ownerId: string;
  currentUserId: string;
  currentName?: string | null;
  currentDescription?: string | null;
  currentCategory?: string | null;
  currentTags?: string[] | null;
  currentVisibility?: GroupVisibility | null;
};

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeVisibility(
  value: GroupVisibility | string | null | undefined
): GroupVisibility {
  if (value === "private") return "private";
  if (value === "hidden") return "hidden";
  return "public";
}

function getDiscoverableFromVisibility(visibility: GroupVisibility): boolean {
  return visibility !== "hidden";
}

function visibilityLabel(value: GroupVisibility) {
  if (value === "private") return "Privado";
  if (value === "hidden") return "Oculto";
  return "Público";
}

function categoryLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    otros: "Otros",
    entretenimiento: "Entretenimiento",
    influencer: "Influencer",
    actor: "Actor",
    comediante: "Comediante",
    cantante: "Cantante",
    youtuber: "YouTuber",
    streamer: "Streamer",
    podcaster: "Podcaster",
    tecnologia: "Tecnología",
    videojuegos: "Videojuegos",
    fitness: "Fitness",
    negocios: "Negocios",
    educacion: "Educación",
    viajes: "Viajes",
    comida: "Comida",
  };

  return labels[value || "otros"] ?? "Otros";
}

function SpinningGear() {
  return (
    <>
      <style jsx>{`
        @keyframes ownerGeneralGearSpin {
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
          animation: "ownerGeneralGearSpin 0.9s linear infinite",
          transformOrigin: "50% 50%",
        }}
      >
        ⚙
      </span>
    </>
  );
}

function FullScreenModal({
  open,
  children,
  onClose,
}: {
  open: boolean;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "rgba(0,0,0,0.76)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding:
          "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>,
    document.body
  );
}

export default function OwnerAdminGeneral({
  groupId,
  ownerId,
  currentUserId,
  currentName = "",
  currentDescription = "",
  currentCategory = null,
  currentTags = null,
  currentVisibility = "public",
}: Props) {
  const isOwner = useMemo(
    () => ownerId === currentUserId,
    [ownerId, currentUserId]
  );

  const [name, setName] = useState(currentName ?? "");
  const [description, setDescription] = useState(currentDescription ?? "");
  const [category, setCategory] = useState(currentCategory ?? "otros");
  const [tagsRaw, setTagsRaw] = useState((currentTags ?? []).join(", "));
  const [savedVisibility, setSavedVisibility] = useState<GroupVisibility>(
    normalizeVisibility(currentVisibility)
  );

  const [editField, setEditField] = useState<EditField | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [generalMsg, setGeneralMsg] = useState<string | null>(null);
  const [generalErr, setGeneralErr] = useState<string | null>(null);

  const initializedGroupRef = useRef<string | null>(null);

  useEffect(() => {
    if (initializedGroupRef.current === groupId) return;

    setName(currentName ?? "");
    setDescription(currentDescription ?? "");
    setCategory(currentCategory ?? "otros");
    setTagsRaw((currentTags ?? []).join(", "));
    setSavedVisibility(normalizeVisibility(currentVisibility));
    setGeneralMsg(null);
    setGeneralErr(null);

    initializedGroupRef.current = groupId;
  }, [
    groupId,
    currentName,
    currentDescription,
    currentCategory,
    currentTags,
    currentVisibility,
  ]);

  useEffect(() => {
    if (!groupId) return;

    const unsubscribe = onSnapshot(doc(db, "groups", groupId), (snap) => {
      if (!snap.exists()) return;

      const data = snap.data() as {
        name?: string | null;
        description?: string | null;
        category?: string | null;
        tags?: string[] | null;
        visibility?: string | null;
      };

      if (!savingGeneral) {
        setName(data.name ?? "");
        setDescription(data.description ?? "");
        setCategory(data.category ?? "otros");
        setTagsRaw((data.tags ?? []).join(", "));
        setSavedVisibility(normalizeVisibility(data.visibility));
      }
    });

    return () => unsubscribe();
  }, [groupId, savingGeneral]);

  if (!isOwner) return null;

  const isHiddenLocked = savedVisibility === "hidden";

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  const contentStyle: React.CSSProperties = {
    display: "grid",
    gap: 10,
  };

  const itemStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
    padding: "12px 0",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: "rgba(255,255,255,0.58)",
    lineHeight: 1.2,
  };

  const valueStyle: React.CSSProperties = {
    marginTop: 4,
    fontSize: 14,
    color: "rgba(255,255,255,0.92)",
    fontWeight: 600,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  };

  const buttonStyle: React.CSSProperties = {
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.07)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    fontFamily: fontStack,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 46,
    padding: "0 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
    fontSize: 14,
    fontFamily: fontStack,
    boxSizing: "border-box",
    WebkitAppearance: "none",
    appearance: "none",
  };

  const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    minHeight: 130,
    padding: "12px",
    resize: "vertical",
  };

  const noticeStyle: React.CSSProperties = {
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    padding: "9px 11px",
    fontSize: 12,
    lineHeight: 1.4,
    color: "rgba(255,255,255,0.84)",
  };

  const modalCardStyle: React.CSSProperties = {
    width: "min(560px, calc(100vw - 32px))",
    maxHeight: "calc(100dvh - 32px)",
    overflowY: "auto",
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "linear-gradient(180deg, rgba(18,18,18,0.98), rgba(8,8,8,0.98))",
    color: "#fff",
    boxShadow: "0 24px 90px rgba(0,0,0,0.78)",
    padding: 18,
    display: "grid",
    gap: 14,
    fontFamily: fontStack,
    boxSizing: "border-box",
  };

  function openEdit(field: EditField) {
    setGeneralErr(null);
    setGeneralMsg(null);
    setEditField(field);

    if (field === "name") setDraftValue(name);
    if (field === "description") setDraftValue(description);
    if (field === "visibility") setDraftValue(savedVisibility);
    if (field === "category") setDraftValue(category ?? "otros");
    if (field === "tags") setDraftValue(tagsRaw);
  }

  function closeEdit() {
    if (savingGeneral) return;
    setEditField(null);
    setDraftValue("");
    setGeneralErr(null);
  }

  async function saveField() {
    if (!editField) return;

    setSavingGeneral(true);
    setGeneralErr(null);
    setGeneralMsg(null);

    try {
      const groupRef = doc(db, "groups", groupId);

      if (editField === "name") {
        const nextName = draftValue.trim();

        if (nextName.length < 3) {
          setGeneralErr("El nombre debe tener al menos 3 caracteres.");
          return;
        }

        await updateDoc(groupRef, {
          name: nextName,
          updatedAt: Date.now(),
        });

        setName(nextName);
        setGeneralMsg("Nombre actualizado.");
      }

      if (editField === "description") {
        const nextDescription = draftValue.trim();

        if (nextDescription.length < 10) {
          setGeneralErr("La descripción debe tener al menos 10 caracteres.");
          return;
        }

        await updateDoc(groupRef, {
          description: nextDescription,
          updatedAt: Date.now(),
        });

        setDescription(nextDescription);
        setGeneralMsg("Descripción actualizada.");
      }

      if (editField === "visibility") {
        const nextVisibility: GroupVisibility = isHiddenLocked
          ? "hidden"
          : draftValue === "private"
          ? "private"
          : "public";

        await updateDoc(groupRef, {
          visibility: nextVisibility,
          discoverable: getDiscoverableFromVisibility(nextVisibility),
          updatedAt: Date.now(),
        });

        setSavedVisibility(nextVisibility);
        setGeneralMsg("Estado actualizado.");
      }

      if (editField === "category") {
        const nextCategory = draftValue || "otros";

        await updateDoc(groupRef, {
          category: nextCategory,
          updatedAt: Date.now(),
        });

        setCategory(nextCategory);
        setGeneralMsg("Categoría actualizada.");
      }

      if (editField === "tags") {
        const nextTags = parseTags(draftValue);

        await updateDoc(groupRef, {
          tags: nextTags,
          updatedAt: Date.now(),
        });

        setTagsRaw(nextTags.join(", "));
        setGeneralMsg("Tags actualizadas.");
      }

      setEditField(null);
      setDraftValue("");
    } catch (e: any) {
      setGeneralErr(e?.message ?? "No se pudo guardar el cambio.");
    } finally {
      setSavingGeneral(false);
    }
  }

  return (
    <div style={contentStyle}>
      <style jsx>{`
        @media (max-width: 520px) {
          .general-edit-item {
            grid-template-columns: 1fr !important;
          }

          .general-edit-button {
            width: 100%;
          }
        }

        select,
        option,
        optgroup {
          background-color: #101010;
          color: #ffffff;
        }
      `}</style>

      <div className="general-edit-item" style={itemStyle}>
        <div>
          <div style={labelStyle}>Nombre</div>
          <div style={valueStyle}>{name || "Sin nombre"}</div>
        </div>
        <button
          className="general-edit-button"
          type="button"
          style={buttonStyle}
          onClick={() => openEdit("name")}
        >
          Modificar
        </button>
      </div>

      <div className="general-edit-item" style={itemStyle}>
        <div>
          <div style={labelStyle}>Descripción</div>
          <div style={valueStyle}>{description || "Sin descripción"}</div>
        </div>
        <button
          className="general-edit-button"
          type="button"
          style={buttonStyle}
          onClick={() => openEdit("description")}
        >
          Modificar
        </button>
      </div>

      <div className="general-edit-item" style={itemStyle}>
        <div>
          <div style={labelStyle}>Estado de la comunidad</div>
          <div style={valueStyle}>
            {visibilityLabel(savedVisibility)}
            {isHiddenLocked ? " · bloqueado desde creación" : ""}
          </div>
        </div>
        <button
          className="general-edit-button"
          type="button"
          style={buttonStyle}
          onClick={() => openEdit("visibility")}
        >
          Modificar
        </button>
      </div>

      <div className="general-edit-item" style={itemStyle}>
        <div>
          <div style={labelStyle}>Categoría</div>
          <div style={valueStyle}>{categoryLabel(category)}</div>
        </div>
        <button
          className="general-edit-button"
          type="button"
          style={buttonStyle}
          onClick={() => openEdit("category")}
        >
          Modificar
        </button>
      </div>

      <div
        className="general-edit-item"
        style={{ ...itemStyle, borderBottom: "none" }}
      >
        <div>
          <div style={labelStyle}>Tags</div>
          <div style={valueStyle}>{tagsRaw || "Sin tags"}</div>
        </div>
        <button
          className="general-edit-button"
          type="button"
          style={buttonStyle}
          onClick={() => openEdit("tags")}
        >
          Modificar
        </button>
      </div>

      {generalMsg && <div style={noticeStyle}>{generalMsg}</div>}

      <FullScreenModal open={!!editField} onClose={closeEdit}>
        <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
          <strong style={{ fontSize: 16, color: "#fff", lineHeight: 1.2 }}>
            {editField === "name" && "Modificar nombre"}
            {editField === "description" && "Modificar descripción"}
            {editField === "visibility" && "Modificar estado"}
            {editField === "category" && "Modificar categoría"}
            {editField === "tags" && "Modificar tags"}
          </strong>

          {editField === "description" ? (
            <textarea
              style={textareaStyle}
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
            />
          ) : editField === "visibility" ? (
            isHiddenLocked ? (
              <div style={noticeStyle}>
                Esta comunidad oculta no puede cambiar a público o privado.
              </div>
            ) : (
              <select
                style={inputStyle}
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
              >
                <option value="public">Público</option>
                <option value="private">Privado</option>
              </select>
            )
          ) : editField === "category" ? (
            <select
              style={inputStyle}
              value={draftValue || "otros"}
              onChange={(e) => setDraftValue(e.target.value)}
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
          ) : (
            <input
              style={inputStyle}
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
            />
          )}

          {editField === "tags" && (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)" }}>
              Máximo 10 tags separadas por coma.
            </div>
          )}

          {generalErr && <div style={noticeStyle}>{generalErr}</div>}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={closeEdit}
              disabled={savingGeneral}
              style={{
                ...buttonStyle,
                flex: "1 1 140px",
                opacity: savingGeneral ? 0.7 : 1,
                cursor: savingGeneral ? "not-allowed" : "pointer",
              }}
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={saveField}
              disabled={savingGeneral}
              style={{
                ...buttonStyle,
                flex: "1 1 160px",
                background: savingGeneral ? "rgba(255,255,255,0.16)" : "#fff",
                color: savingGeneral ? "#fff" : "#000",
                opacity: savingGeneral ? 0.8 : 1,
                cursor: savingGeneral ? "not-allowed" : "pointer",
              }}
            >
              {savingGeneral ? (
                <>
                  <SpinningGear /> Guardando...
                </>
              ) : (
                "Guardar"
              )}
            </button>
          </div>
        </div>
      </FullScreenModal>
    </div>
  );
}