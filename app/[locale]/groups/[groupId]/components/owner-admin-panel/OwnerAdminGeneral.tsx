"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, onSnapshot, serverTimestamp, updateDoc, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildGroupSearchIndex } from "@/lib/groups/groupSearchIndex";
import type { Group } from "@/types/group";
import { GROUP_CATEGORY_OPTIONS, normalizeGroupCategory } from "@/types/group";
import OptionWheelPanel from "@/components/ui/OptionWheelPanel";
import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";
import {
  TextButton,
  panelPrimaryBtn,
  panelPrimaryBtnDisabled,
} from "@/components/ui";
import {
  SettingsIcon,
  SettingsSection,
  settingsLabel,
  settingsRow,
  settingsValue,
} from "@/components/settings/settingsKit";
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

// El modal a mano se elimino: los paneles de esta pantalla usan ya
// VibraResponsivePanel, que es el canonico y trae su propio fondo, su bloqueo de
// scroll y su cierre. Con el se fueron `createPortal` y `useBodyScrollLock`, que
// solo existian para sostenerlo.

/** Nombre, descripcion, estado, categoria y tags: la ficha de la comunidad. */
const ICONO_DATOS = (
  <SettingsIcon>
    <path d="M4.6 5.4h14.8v13.2H4.6z" />
    <path d="M8 9.4h8" />
    <path d="M8 13h5.4" />
  </SettingsIcon>
);

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

  // Renglon, etiqueta y valor son los mismos objetos que en la configuracion
  // del perfil, no una copia con las mismas cifras.
  const itemStyle = settingsRow;
  const labelStyle = settingsLabel;
  const valueStyle = settingsValue;

  // Campo canonico de Vibra (vibra_style.md), el mismo que la configuracion del
  // perfil: fondo sutil SIN borde, radio 12, texto 13. El borde de 1px y el
  // texto de 14 eran del estilo viejo.
  const inputStyle: React.CSSProperties = {
    width: "100%",
    // 40 y 8px de aire, el mismo campo que la configuracion del perfil.
    minHeight: 40,
    padding: "8px 12px",
    borderRadius: 12,
    border: "none",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
    fontSize: 13,
    lineHeight: 1.5,
    fontFamily: fontStack,
    boxSizing: "border-box",
    WebkitAppearance: "none",
    appearance: "none",
  };

  const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    minHeight: 110,
    resize: "vertical",
  };

  const noticeStyle: React.CSSProperties = {
    borderRadius: 12,
    border: "none",
    background: "rgba(255,255,255,0.06)",
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.4,
    color: "rgba(255,255,255,0.84)",
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

        /* Misma linea sutil entre opciones que en la configuracion del perfil:
           entra 6px por cada lado en vez de cruzar de borde a borde. */
        .general-edit-item::after {
          content: "";
          position: absolute;
          inset-inline-start: 6px;
          inset-inline-end: 6px;
          bottom: 0;
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
        }

        .general-edit-item:last-of-type::after {
          display: none;
        }

        select,
        option,
        optgroup {
          background-color: #101010;
          color: #ffffff;
        }
      `}</style>

      {/* La misma tarjeta con icono que cada ajuste del perfil. Antes estos
          cinco renglones colgaban sueltos del panel, sin fondo ni titulo, y
          era lo que hacia que la pantalla se leyera de otra epoca. */}
      <SettingsSection
        icono={ICONO_DATOS}
        titulo="Datos de la comunidad"
        abierta
        fija
        onToggle={() => {}}
      >
      <div className="general-edit-item" style={itemStyle}>
        <div>
          <div style={labelStyle}>Nombre</div>
          <div style={valueStyle}>{name || "Sin nombre"}</div>
        </div>
        <TextButton
          className="general-edit-button"
          tone="brand"
          size="sm"
          style={{ justifySelf: "end", alignSelf: "center", fontFamily: "inherit", whiteSpace: "nowrap" }}
          onClick={() => openEdit("name")}
        >
          Modificar
        </TextButton>
      </div>

      <div className="general-edit-item" style={itemStyle}>
        <div>
          <div style={labelStyle}>Descripción</div>
          <div style={valueStyle}>{description || tProfile("noDescription")}</div>
        </div>
        <TextButton
          className="general-edit-button"
          tone="brand"
          size="sm"
          style={{ justifySelf: "end", alignSelf: "center", fontFamily: "inherit", whiteSpace: "nowrap" }}
          onClick={() => openEdit("description")}
        >
          Modificar
        </TextButton>
      </div>

      <div className="general-edit-item" style={itemStyle}>
        <div>
          <div style={labelStyle}>{tGroups("communityState")}</div>
          <div style={valueStyle}>
            {visibilityLabel(savedVisibility)}
            {isHiddenLocked ? tGroups("blockedSinceCreation") : ""}
          </div>
        </div>
        <TextButton
          className="general-edit-button"
          tone="brand"
          size="sm"
          style={{ justifySelf: "end", alignSelf: "center", fontFamily: "inherit", whiteSpace: "nowrap" }}
          onClick={() => openEdit("visibility")}
        >
          Modificar
        </TextButton>
      </div>

      <div className="general-edit-item" style={itemStyle}>
        <div>
          <div style={labelStyle}>Categoría</div>
          <div style={valueStyle}>{categoryLabel(category, tGroups)}</div>
        </div>
        <TextButton
          className="general-edit-button"
          tone="brand"
          size="sm"
          style={{ justifySelf: "end", alignSelf: "center", fontFamily: "inherit", whiteSpace: "nowrap" }}
          onClick={() => openEdit("category")}
        >
          Modificar
        </TextButton>
      </div>

      <div
        className="general-edit-item"
        style={{ ...itemStyle, borderBottom: "none" }}
      >
        <div>
          <div style={labelStyle}>Tags</div>
          <div style={valueStyle}>{tagsRaw || tGroups("noTags")}</div>
        </div>
        <TextButton
          className="general-edit-button"
          tone="brand"
          size="sm"
          style={{ justifySelf: "end", alignSelf: "center", fontFamily: "inherit", whiteSpace: "nowrap" }}
          onClick={() => openEdit("tags")}
        >
          Modificar
        </TextButton>
      </div>
      </SettingsSection>

      {/* El mismo panel que la configuracion del perfil: hoja por abajo en
          celular, tarjeta centrada en laptop, y su titulo y su cruz de cerrar
          resueltos por el propio panel. Antes era un modal a mano con su
          tarjeta, su borde y su degradado propios. */}
      <VibraResponsivePanel
        open={!!editField}
        onClose={() => !savingGeneral && closeEdit()}
        title={
          editField === "name"
            ? tProfile("editNameTitle")
            : editField === "description"
              ? tGroups("editDescription")
              : editField === "visibility"
                ? tGroups("editState")
                : editField === "category"
                  ? tGroups("editCategory")
                  : editField === "tags"
                    ? tGroups("editTags")
                    : ""
        }
        closeAriaLabel={tCommon("closeAriaLabel")}
        maxWidthDesktop={440}
        footer={
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={saveField}
              disabled={savingGeneral}
              style={savingGeneral ? panelPrimaryBtnDisabled : panelPrimaryBtn}
            >
              {savingGeneral ? (
                <>
                  <SpinningGear /> {tCommon("saving")}
                </>
              ) : (
                tCommon("save")
              )}
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 10 }}>

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

        </div>
      </VibraResponsivePanel>

      <VibraToast toast={toast} />
    </div>
  );
}