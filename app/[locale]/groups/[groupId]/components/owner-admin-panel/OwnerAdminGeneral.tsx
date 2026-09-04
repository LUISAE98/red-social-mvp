"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { doc, onSnapshot, serverTimestamp, updateDoc, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildGroupSearchIndex } from "@/lib/groups/groupSearchIndex";
import type { Group } from "@/types/group";
import { GROUP_CATEGORY_OPTIONS, normalizeGroupCategory } from "@/types/group";
import OptionWheelPanel from "@/components/ui/OptionWheelPanel";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

/**
 * Este panel de administración es un modal a z-index 999999, y la rueda que se
 * abre desde dentro trae 999990 por omisión: quedaba justo debajo y parecía que
 * el campo no respondía. Lo advierte VibraResponsivePanel en su prop zIndexBase.
 */
const WHEEL_Z_BASE = 1000010;

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

/**
 * Etiqueta de una categoría de comunidad.
 *
 * El mapa guarda CLAVES, no nombres: los nombres viven en el catálogo y así
 * existen en los 47 idiomas. Antes estaban escritos aquí en español, y de las
 * dieciséis el escáner solo veía dos —las que llevan tilde—, así que el resto
 * no habría aparecido en ninguna lista.
 */
function categoryLabel(
  value: string | null | undefined,
  t: (key: string) => string
) {
  const claves: Record<string, string> = {
    otros: "catOtros",
    entretenimiento: "catEntretenimiento",
    influencer: "catInfluencer",
    actor: "catActor",
    comediante: "catComediante",
    cantante: "catCantante",
    youtuber: "catYoutuber",
    streamer: "catStreamer",
    podcaster: "catPodcaster",
    tecnologia: "catTecnologia",
    videojuegos: "catVideojuegos",
    fitness: "catFitness",
    negocios: "catNegocios",
    educacion: "catEducacion",
    viajes: "catViajes",
    comida: "catComida",
  };

  return t(claves[value || "otros"] ?? "catOtros");
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useBodyScrollLock(open);

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        height: "var(--vb-alto-pantalla)",
        zIndex: 999999,
        background: "rgba(0,0,0,0.76)",
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding:
          "max(16px, env(safe-area-inset-top)) 16px max(16px, var(--vb-safe-bottom, 0px))",
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
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");
  const tProfile = useTranslations("profile");
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

  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (generalErr) showToast(generalErr, "error"); }, [generalErr]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (generalMsg) showToast(generalMsg, "success"); }, [generalMsg]); // eslint-disable-line react-hooks/exhaustive-deps

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
  discoverable?: boolean | null;
  isActive?: boolean | null;
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
    'inherit';

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
    maxHeight: "calc(var(--vb-alto-pantalla) - 32px)",
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
  function buildNextSearchPatch(next: {
  name?: string;
  description?: string;
  visibility?: GroupVisibility;
  category?: string;
  tags?: string[];
}) {
  const nextName = next.name ?? name;
  const nextDescription = next.description ?? description;
  const nextVisibility = next.visibility ?? savedVisibility;
  const nextCategory = next.category ?? category ?? "otros";
  const nextTags = next.tags ?? parseTags(tagsRaw);
  const nextDiscoverable = getDiscoverableFromVisibility(nextVisibility);
  const nextIsActive = true;
  const nextUpdatedAt = serverTimestamp() as unknown as Timestamp;

  return {
    updatedAt: nextUpdatedAt,
    search: buildGroupSearchIndex({
      name: nextName,
      description: nextDescription,
      category: nextCategory as Group["category"],
      tags: nextTags,
      visibility: nextVisibility,
      discoverable: nextDiscoverable,
      isActive: nextIsActive,
      updatedAt: nextUpdatedAt,
    }),
  };
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
          setGeneralErr(tCommon("minLength3"));
          return;
        }

await updateDoc(groupRef, {
  name: nextName,
  ...buildNextSearchPatch({ name: nextName }),
});

        setName(nextName);
        setGeneralMsg(tProfile("nameUpdated"));
      }

      if (editField === "description") {
        const nextDescription = draftValue.trim();

        if (nextDescription.length < 10) {
          setGeneralErr(tGroups("descriptionMinLength"));
          return;
        }

await updateDoc(groupRef, {
  description: nextDescription,
  ...buildNextSearchPatch({ description: nextDescription }),
});

        setDescription(nextDescription);
        setGeneralMsg(tProfile("descriptionUpdated"));
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
  ...buildNextSearchPatch({ visibility: nextVisibility }),
});

        setSavedVisibility(nextVisibility);
        setGeneralMsg(tGroups("statusUpdated"));
      }

      if (editField === "category") {
        const nextCategory = draftValue || "otros";

await updateDoc(groupRef, {
  category: nextCategory,
  ...buildNextSearchPatch({ category: nextCategory }),
});

        setCategory(nextCategory);
        setGeneralMsg(tGroups("categoryUpdated"));
      }

      if (editField === "tags") {
        const nextTags = parseTags(draftValue);

await updateDoc(groupRef, {
  tags: nextTags,
  ...buildNextSearchPatch({ tags: nextTags }),
});

        setTagsRaw(nextTags.join(", "));
        setGeneralMsg(tGroups("tagsUpdated"));
      }

      setEditField(null);
      setDraftValue("");
    } catch (e: unknown) {
      setGeneralErr((e instanceof Error ? e.message : null) ?? tCommon("generalError"));
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
          <div style={valueStyle}>{description || tProfile("noDescription")}</div>
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
          <div style={labelStyle}>{tGroups("communityState")}</div>
          <div style={valueStyle}>
            {visibilityLabel(savedVisibility)}
            {isHiddenLocked ? tGroups("blockedSinceCreation") : ""}
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
          <div style={valueStyle}>{categoryLabel(category, tGroups)}</div>
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
          <div style={valueStyle}>{tagsRaw || tGroups("noTags")}</div>
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

      <FullScreenModal open={!!editField} onClose={closeEdit}>
        <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
          <strong style={{ fontSize: 16, color: "#fff", lineHeight: 1.2 }}>
            {editField === "name" && tProfile("editNameTitle")}
            {editField === "description" && tGroups("editDescription")}
            {editField === "visibility" && tGroups("editState")}
            {editField === "category" && tGroups("editCategory")}
            {editField === "tags" && tGroups("editTags")}
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
                {tGroups("hiddenCantChangeVisibility")}
              </div>
            ) : (
              <OptionWheelPanel
                zIndexBase={WHEEL_Z_BASE}
                value={draftValue}
                onChange={setDraftValue}
                title="Visibilidad"
                confirmLabel="Guardar"
                closeAriaLabel="Cerrar"
                options={[
                  { value: "public", label: "Público" },
                  { value: "private", label: "Privado" },
                ]}
              />
            )
          ) : editField === "category" ? (
            /**
             * Las MISMAS categorías que al crear la comunidad.
             *
             * Aquí había dieciséis escritas a mano que no coincidían con las
             * canónicas: incluían valores viejos —"influencer", "actor",
             * "videojuegos"— y les faltaban la mitad de las actuales. O sea que
             * la misma comunidad ofrecía un juego de categorías al crearla y
             * otro al editarla, y desde aquí se le podía poner una que ya no
             * existe en el catálogo, con lo que dejaba de aparecer en las
             * recomendaciones y en la búsqueda, que sí van por las canónicas.
             *
             * Las viejas siguen leyéndose bien: `normalizeGroupCategory` las
             * traduce a su equivalente actual.
             */
            <OptionWheelPanel
              zIndexBase={WHEEL_Z_BASE}
              value={normalizeGroupCategory(draftValue) ?? draftValue}
              onChange={setDraftValue}
              title="Categoría"
              confirmLabel="Guardar"
                closeAriaLabel="Cerrar"
              options={GROUP_CATEGORY_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          ) : (
            <input
              style={inputStyle}
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
            />
          )}

          {editField === "tags" && (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)" }}>
              {tGroups("maxTenTags")}
            </div>
          )}

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
              {tCommon("cancel")}
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
                tCommon("save")
              )}
            </button>
          </div>
        </div>
      </FullScreenModal>

      <VibraToast toast={toast} />
    </div>
  );
}