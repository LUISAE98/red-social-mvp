"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

type GroupVisibility = "public" | "private" | "hidden";

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
          opacity: 0.9,
        }}
      >
        ⚙
      </span>
    </>
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
  const [visibility, setVisibility] = useState<GroupVisibility>(
    normalizeVisibility(currentVisibility)
  );

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
    setVisibility(normalizeVisibility(currentVisibility));
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

    const ref = doc(db, "groups", groupId);

    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;

        const data = snap.data() as {
          visibility?: string | null;
        };

        const nextVisibility = normalizeVisibility(data?.visibility);

        setSavedVisibility(nextVisibility);
        setVisibility((prev) => {
          if (savingGeneral) return prev;
          return nextVisibility;
        });
      },
      () => {
        // Silencioso para no romper UX si falla el listener.
      }
    );

    return () => unsubscribe();
  }, [groupId, savingGeneral]);

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

    const isHiddenLocked = savedVisibility === "hidden";

    let finalVisibility: GroupVisibility;

    if (isHiddenLocked) {
      finalVisibility = "hidden";
    } else {
      finalVisibility = visibility === "private" ? "private" : "public";
    }

    const tags = parseTags(tagsRaw);
    const discoverable = getDiscoverableFromVisibility(finalVisibility);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        name: trimmedName,
        description: trimmedDesc,
        category: category ?? "otros",
        tags,
        visibility: finalVisibility,
        discoverable,
        updatedAt: Date.now(),
      });

      setSavedVisibility(finalVisibility);
      setVisibility(finalVisibility);
      setGeneralMsg("Cambios guardados.");
    } catch (e: any) {
      setGeneralErr(e?.message ?? "No se pudieron guardar cambios.");
    } finally {
      setSavingGeneral(false);
    }
  }

  if (!isOwner) return null;

  const isHiddenLocked = savedVisibility === "hidden";

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

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
    appearance: "none",
  };

  const disabledInputStyle: React.CSSProperties = {
    ...inputStyle,
    opacity: 0.72,
    cursor: "not-allowed",
  };

  return (
    <div style={contentStyle}>
      <style jsx>{`
        select,
        option,
        optgroup {
          background-color: #101010;
          color: #ffffff;
        }

        select:focus {
          outline: none;
        }

        select:disabled {
          opacity: 0.72;
          cursor: not-allowed;
        }
      `}</style>

      <div style={fieldStyle}>
        <span style={labelStyle}>Nombre</span>
        <input
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre de la comunidad"
        />
      </div>

      <div style={fieldStyle}>
        <span style={labelStyle}>Descripción</span>
        <textarea
          style={textareaStyle}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe el propósito de la comunidad"
        />
      </div>

      <div style={fieldStyle}>
        <span style={labelStyle}>Estado de la comunidad</span>

        {isHiddenLocked ? (
          <>
            <input
              style={disabledInputStyle}
              value="Oculto (bloqueado desde creación)"
              disabled
              readOnly
            />
            <div style={subtleTextStyle}>
              Esta comunidad fue creada como oculta. No puede cambiar a público o
              privado.
            </div>
          </>
        ) : (
          <>
            <select
              style={inputStyle}
              value={visibility}
              onChange={(e) =>
                setVisibility(
                  e.target.value === "private" ? "private" : "public"
                )
              }
            >
              <option value="public">Público</option>
              <option value="private">Privado (requiere aprobación)</option>
            </select>

            <div style={subtleTextStyle}>
              {visibility === "public" &&
                "Visible en exploración y acceso normal según reglas de la comunidad."}
              {visibility === "private" &&
                "Visible, pero el acceso requiere solicitud o aprobación."}
            </div>
          </>
        )}
      </div>

      <div style={fieldStyle}>
        <span style={labelStyle}>Categoría</span>
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

      <div style={fieldStyle}>
        <span style={labelStyle}>Tags</span>
        <input
          style={inputStyle}
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="drift, autos, carreras"
        />
        <div style={subtleTextStyle}>
          Máximo 10 tags separadas por coma.
        </div>
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
  );
}