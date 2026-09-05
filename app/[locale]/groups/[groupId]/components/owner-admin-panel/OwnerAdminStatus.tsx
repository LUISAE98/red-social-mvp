"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { Switch } from "@/components/profile/ProfileSettings.parts";
import {
  SettingsIcon,
  SettingsRow,
  SettingsSection,
  settingsHint,
  settingsLabel,
  settingsValue,
} from "@/components/settings/settingsKit";

type PostingMode = "members" | "owner_only";

type Props = {
  groupId: string;
  ownerId: string;
  currentUserId: string;
  currentPostingMode?: PostingMode | string | null;
  currentCommentsEnabled?: boolean | null;

  /**
   * Si la comunidad esta en pie o pausada.
   *
   * Esta pantalla no lo leia, y por eso el estado se ofrecia con dos botones
   * —Pausar y Reactivar— en vez de con un interruptor: sin saber cual de los
   * dos estaba puesto, no habia nada que encender ni que apagar.
   */
  currentIsActive?: boolean | null;
};

/** Quien puede publicar y comentar: un escudo. */
const ICONO_PERMISOS = (
  <SettingsIcon>
    <path d="M12 3l7 3v5.4c0 4.2-2.9 7.7-7 8.6-4.1-.9-7-4.4-7-8.6V6l7-3z" />
    <path d="M9.2 11.8l2 2 3.6-3.8" />
  </SettingsIcon>
);

/** Activa o en pausa: el glifo de encendido. */
const ICONO_ESTADO = (
  <SettingsIcon>
    <path d="M12 3.8v8" />
    <path d="M7.4 6.6a7 7 0 1 0 9.2 0" />
  </SettingsIcon>
);

export default function OwnerAdminStatus({
  groupId,
  ownerId,
  currentUserId,
  currentPostingMode = "members",
  currentCommentsEnabled = true,
  currentIsActive = true,
}: Props) {
  const tGroups = useTranslations("groups");

  const isOwner = useMemo(
    () => ownerId === currentUserId,
    [ownerId, currentUserId]
  );

  const normalizedPostingMode: PostingMode =
    currentPostingMode === "owner_only" ? "owner_only" : "members";

  const normalizedCommentsEnabled = currentCommentsEnabled !== false;
  const normalizedIsActive = currentIsActive !== false;

  const [postingMode, setPostingMode] =
    useState<PostingMode>(normalizedPostingMode);
  const [commentsEnabled, setCommentsEnabled] = useState<boolean>(
    normalizedCommentsEnabled
  );

  const [isActive, setIsActive] = useState<boolean>(normalizedIsActive);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);

  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (statusErr) showToast(statusErr, "error"); }, [statusErr]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (statusMsg) showToast(statusMsg, "success"); }, [statusMsg]); // eslint-disable-line react-hooks/exhaustive-deps

  const [statusBusy, setStatusBusy] = useState(false);
  const [postingBusy, setPostingBusy] = useState(false);
  const [commentsBusy, setCommentsBusy] = useState(false);

  useEffect(() => {
    setPostingMode(normalizedPostingMode);
  }, [normalizedPostingMode]);

  useEffect(() => {
    setCommentsEnabled(normalizedCommentsEnabled);
  }, [normalizedCommentsEnabled]);

  useEffect(() => {
    setIsActive(normalizedIsActive);
  }, [normalizedIsActive]);

  async function setActive(next: boolean) {
    if (!isOwner) return;

    const anterior = isActive;

    setStatusBusy(true);
    setStatusMsg(null);
    setStatusErr(null);

    // El interruptor cambia de sitio al momento y vuelve solo si la
    // escritura falla, igual que los de publicaciones y comentarios.
    setIsActive(next);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        isActive: next,
        // ⚠️ El índice de búsqueda va junto, no después.
        //
        // El descubrimiento filtra por `search.isActive`, no por `isActive`. Al
        // pausar solo se escribía el segundo, así que **la comunidad pausada
        // seguía saliendo en búsquedas**. Y al reactivar pasaba lo contrario si
        // el índice se había quedado en `false`.
        "search.isActive": next,
        updatedAt: serverTimestamp(),
      });

      setStatusMsg(
        next ? tGroups("statusReactivated") : tGroups("statusPaused")
      );
    } catch (e: unknown) {
      setIsActive(anterior);
      setStatusErr(
        (e instanceof Error ? e.message : null) ?? tGroups("statusUpdateError")
      );
    } finally {
      setStatusBusy(false);
    }
  }

  async function savePostingMode(nextMode: PostingMode) {
    if (!isOwner) return;

    const previousMode = postingMode;

    setPostingBusy(true);
    setStatusMsg(null);
    setStatusErr(null);
    setPostingMode(nextMode);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        permissions: {
          postingMode: nextMode,
          commentsEnabled,
        },
        updatedAt: serverTimestamp(),
      });

      setStatusMsg(
        nextMode === "owner_only"
          ? tGroups("postingOwnerOnlyMsg")
          : tGroups("postingMembersMsg")
      );
    } catch (e: unknown) {
      setPostingMode(previousMode);
      setStatusErr(
        (e instanceof Error ? e.message : null) ?? tGroups("postingUpdateError")
      );
    } finally {
      setPostingBusy(false);
    }
  }

  async function saveCommentsEnabled(nextValue: boolean) {
    if (!isOwner) return;

    const previousValue = commentsEnabled;

    setCommentsBusy(true);
    setStatusMsg(null);
    setStatusErr(null);
    setCommentsEnabled(nextValue);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        permissions: {
          postingMode,
          commentsEnabled: nextValue,
        },
        updatedAt: serverTimestamp(),
      });

      setStatusMsg(
        nextValue
          ? tGroups("commentsMembersMsg")
          : tGroups("commentsOwnerOnlyMsg")
      );
    } catch (e: unknown) {
      setCommentsEnabled(previousValue);
      setStatusErr(
        (e instanceof Error ? e.message : null) ?? tGroups("commentsUpdateError")
      );
    } finally {
      setCommentsBusy(false);
    }
  }

  if (!isOwner) return null;

  // El interruptor encendido siempre significa "restringido", igual que en la
  // configuracion del perfil. Antes eran dos textos a los lados del control y
  // habia que leer los dos para saber cual estaba activo.
  const soloYoPublico = postingMode === "owner_only";
  const soloYoComento = !commentsEnabled;

  return (
    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
      {/* Las dos pestanas van fijas: este panel ya vive dentro de una pestana
          del panel del creador, y plegarlas otra vez seria un segundo nivel de
          desplegables para ver cuatro renglones. */}
      <SettingsSection
        icono={ICONO_PERMISOS}
        titulo={tGroups("permissionsTitle")}
        abierta
        fija
        onToggle={() => {}}
      >
        <SettingsRow>
          <div style={{ minWidth: 0 }}>
            <div style={settingsLabel}>Publicaciones</div>
            <div style={settingsValue}>
              {soloYoPublico
                ? "Solo yo puedo publicar"
                : "Cualquier miembro puede publicar"}
            </div>
            <div style={settingsHint}>{tGroups("permissionsWhoPosts")}</div>
          </div>

          <Switch
            checked={soloYoPublico}
            disabled={postingBusy}
            onChange={() =>
              savePostingMode(soloYoPublico ? "members" : "owner_only")
            }
            label="Publicaciones"
          />
        </SettingsRow>

        <SettingsRow>
          <div style={{ minWidth: 0 }}>
            <div style={settingsLabel}>Comentarios</div>
            <div style={settingsValue}>
              {soloYoComento
                ? "Solo yo puedo comentar"
                : "Cualquier miembro puede comentar"}
            </div>
            <div style={settingsHint}>{tGroups("permissionsWhoComments")}</div>
          </div>

          <Switch
            checked={soloYoComento}
            disabled={commentsBusy}
            onChange={() => saveCommentsEnabled(soloYoComento)}
            label="Comentarios"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        icono={ICONO_ESTADO}
        titulo="Estado de la comunidad"
        abierta
        fija
        onToggle={() => {}}
      >
        <SettingsRow>
          <div style={{ minWidth: 0 }}>
            <div style={settingsLabel}>Disponibilidad</div>
            <div style={settingsValue}>
              {isActive ? "Activa" : "En pausa"}
            </div>
            <div style={settingsHint}>{tGroups("pauseExplains")}</div>
          </div>

          <Switch
            checked={isActive}
            disabled={statusBusy}
            onChange={(next) => setActive(next)}
            label={isActive ? "Pausar" : "Reactivar"}
          />
        </SettingsRow>
      </SettingsSection>

      <VibraToast toast={toast} />
    </div>
  );
}
