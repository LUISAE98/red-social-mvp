"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useTranslations } from "next-intl";
import {
  panelPrimaryBtn,
  panelPrimaryBtnDisabled,
  panelSecondaryBtnStyle,
  TextButton,
} from "@/components/ui";
import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";
import {
  SettingsIcon,
  SettingsRow,
  SettingsSection,
  settingsHint,
  settingsLabel,
  settingsValue,
} from "@/components/settings/settingsKit";
import { db } from "@/lib/firebase";
import { softDeleteGroup } from "@/lib/groups/groupDeletion";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

type OwnerAdminDangerZoneProps = {
  groupId: string;
  groupName?: string | null;
};

/** Lo que no tiene vuelta atras: el triangulo de aviso. */
const ICONO_PELIGRO = (
  <SettingsIcon>
    <path d="M12 4.4L3.2 19.2h17.6L12 4.4z" />
    <path d="M12 10.2v3.6" />
    <path d="M12 16.6h.01" />
  </SettingsIcon>
);

export default function OwnerAdminDangerZone({
  groupId,
  groupName,
}: OwnerAdminDangerZoneProps) {
  const tGroups = useTranslations("groups");
  const router = useRouter();
  const tCommon = useTranslations("common");

  const [isOpen, setIsOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [showFinalOverlay, setShowFinalOverlay] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (errorMessage) showToast(errorMessage, "error"); }, [errorMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  const normalizedConfirmText = confirmText.trim().toUpperCase();

  const canDelete = useMemo(() => {
    return normalizedConfirmText === "ELIMINAR";
  }, [normalizedConfirmText]);

  async function handlePauseGroup() {
    if (isPausing || isDeleting) return;

    try {
      setIsPausing(true);
      setErrorMessage(null);

      await updateDoc(doc(db, "groups", groupId), {
        isActive: false,
        // El descubrimiento filtra por `search.isActive`, así que sin esta línea
        // una comunidad pausada seguía apareciendo en las búsquedas.
        "search.isActive": false,
        updatedAt: serverTimestamp(),
      });

      setShowFinalOverlay(false);

      // Quedo pausada, no borrada. El formulario de borrado que estaba detras
      // ya no pinta nada, y dejarlo abierto con ELIMINAR escrito invita a
      // rematar por accidente.
      setIsOpen(false);
      setConfirmText("");
      setReason("");

      router.refresh();
    } catch (error) {
      console.error("Error pausing group", error);

      const message =
        error instanceof Error
          ? error.message
          : tGroups("pauseCommunityError");

      setErrorMessage(message);
    } finally {
      setIsPausing(false);
    }
  }

  async function handleDeleteGroup() {
    if (!canDelete || isDeleting || isPausing) return;

    try {
      setIsDeleting(true);
      setErrorMessage(null);

      await softDeleteGroup({
        groupId,
        reason: reason.trim() || "owner_deleted",
      });

      router.replace("/groups");
      router.refresh();
    } catch (error) {
      console.error("Error deleting group", error);

      const message =
        error instanceof Error
          ? error.message
          : tGroups("deleteCommunityError");

      setErrorMessage(message);
      setIsDeleting(false);
      setShowFinalOverlay(false);
    }
  }

  const ocupado = isDeleting || isPausing;

  // Campo canonico de Vibra, el mismo que la configuracion del perfil.
  const campoStyle: React.CSSProperties = {
    width: "100%",
    borderRadius: 12,
    border: "none",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    minHeight: 40,
    padding: "8px 12px",
    fontSize: 13,
    lineHeight: 1.5,
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };

  // El rojo de la plataforma. Eliminar era un boton blanco sobre negro, que
  // en esta pantalla se leia igual que un guardar cualquiera.
  const botonEliminar: React.CSSProperties = canDelete
    ? { ...panelPrimaryBtn, background: "#ef4444" }
    : panelPrimaryBtnDisabled;

  function cerrarFormulario() {
    if (ocupado) return;

    setIsOpen(false);
    setErrorMessage(null);

    // Al cerrar se limpia lo escrito: dejar un ELIMINAR a medias guardado es
    // una trampa esperando a que alguien vuelva a abrir el panel.
    setConfirmText("");
    setReason("");
  }

  return (
    <>
      {/* Un renglon con su accion a la derecha, como los de Modificar, y no
          una pestana que se despliega hacia abajo. El formulario de borrado
          es una decision, no un ajuste que se consulta de pasada, asi que va
          en su panel y no colgando de la pantalla. */}
      <SettingsSection
        icono={ICONO_PELIGRO}
        titulo={tGroups("deleteCommunityButton")}
        abierta
        fija
        onToggle={() => {}}
      >
        <SettingsRow>
          <div style={{ minWidth: 0 }}>
            {groupName ? (
              <div style={settingsValue}>{groupName}</div>
            ) : null}
            <div style={settingsHint}>{tGroups("deleteOrPauseExplain")}</div>
          </div>

          {/* El mismo boton de texto que Modificar, en el rojo de la
              plataforma. `tone` no tiene rojo y ponerselo aqui es mas honesto
              que abrir un cuarto tono para un solo sitio. */}
          <TextButton
            tone="brand"
            size="sm"
            style={{
              justifySelf: "end",
              alignSelf: "center",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
              color: "#ef4444",
            }}
            onClick={() => setIsOpen(true)}
          >
            Eliminar
          </TextButton>
        </SettingsRow>
      </SettingsSection>

      <VibraResponsivePanel
        open={isOpen}
        onClose={cerrarFormulario}
        title={tGroups("deleteCommunityButton")}
        closeAriaLabel={tCommon("closeAriaLabel")}
        maxWidthDesktop={440}
        footer={
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => setShowFinalOverlay(true)}
              disabled={!canDelete || ocupado}
              style={botonEliminar}
            >
              {tGroups("deleteCommunityButton")}
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          <p
            style={{
              margin: 0,
              fontSize: 11.5,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.58)",
            }}
          >
            {tGroups("hideCommunityWarning")}
          </p>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={settingsLabel}>
              {tGroups("internalReasonOptional")}
            </span>

            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={ocupado}
              rows={2}
              maxLength={240}
              placeholder={tGroups("deletionReasonPlaceholder")}
              style={{
                ...campoStyle,
                minHeight: 64,
                maxHeight: 130,
                resize: "vertical",
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={settingsLabel}>{tGroups("typeDeleteToConfirm")}</span>

            <input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              disabled={ocupado}
              placeholder="ELIMINAR"
              style={campoStyle}
            />
          </label>
        </div>
      </VibraResponsivePanel>

      {/* La pregunta final se abre ENCIMA del formulario, que sigue detras
          con lo escrito. Por eso lleva su propio z-index: con el de serie los
          dos paneles empatan y el de abajo tapa a este. */}
      <VibraResponsivePanel
        open={showFinalOverlay}
        onClose={() => !ocupado && setShowFinalOverlay(false)}
        title={tGroups("deleteOrPauseQuestion")}
        closeAriaLabel={tCommon("closeAriaLabel")}
        maxWidthDesktop={440}
        zIndexBase={1000010}
        footer={
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={handleDeleteGroup}
              disabled={ocupado}
              style={
                ocupado
                  ? panelPrimaryBtnDisabled
                  : { ...panelPrimaryBtn, background: "#ef4444" }
              }
            >
              {isDeleting ? "Eliminando" : tGroups("yesDeleteCommunity")}
            </button>

            {/* Esto NO es un cancelar, es la otra respuesta a la pregunta. Sin
                el, a eliminar o pausar solo se podria contestar una cosa. */}
            <button
              type="button"
              onClick={handlePauseGroup}
              disabled={ocupado}
              style={panelSecondaryBtnStyle(ocupado)}
            >
              {isPausing ? "Pausando" : tGroups("justPause")}
            </button>
          </div>
        }
      >
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "rgba(255,255,255,0.68)",
          }}
        >
          {tGroups("deleteOrPauseExplain")}
        </p>
      </VibraResponsivePanel>

      <VibraToast toast={toast} />
    </>
  );
}
