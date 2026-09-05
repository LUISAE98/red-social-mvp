"use client";

// Buscar a cualquier persona de Vibra para invitarla a MODERAR la comunidad,
// sea o no miembro.
//
// Por qué existe: hoy solo se puede ascender a moderador a alguien que ya está
// dentro, y en una comunidad de suscripción eso obliga a que el moderador pague
// para poder moderar, lo cual no tiene sentido. Desde aquí el dueño busca a la
// persona en TODA la plataforma y le manda la invitación.
//
// Panel: primitivo canónico `Modal` (= VibraResponsivePanel de vibra_style.md):
// en celular entra deslizando desde abajo; en laptop es panel centrado.

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui";
import { db } from "@/lib/firebase";
import { searchProfiles, type ProfileSearchResult } from "@/lib/profile/searchProfiles";
import { inviteGroupModerator } from "@/lib/groups/moderatorInvites";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

const SEARCH_DEBOUNCE_MS = 320;
const MIN_QUERY_LENGTH = 2;

type Props = {
  open: boolean;
  onClose: () => void;
  groupId: string;
  /** Se excluye de los resultados: ya es el dueño. */
  currentUserId?: string | null;
};

/** Estado del botón por persona: sin tocar → enviando → invitada (o error). */
type InviteState = "idle" | "sending" | "sent" | "error";

export default function GroupModeratorInvitePanel({
  open,
  onClose,
  groupId,
  currentUserId = null,
}: Props) {
  const tGroups = useTranslations("groups");
  const { toast: inviteToast, showToast: showInviteToast } = useVibraToast();
  const [inviteStates, setInviteStates] = useState<Record<string, InviteState>>({});

  async function handleInvite(userId: string) {
    if (inviteStates[userId] === "sending" || inviteStates[userId] === "sent") return;

    setInviteStates((prev) => ({ ...prev, [userId]: "sending" }));
    try {
      await inviteGroupModerator(groupId, userId);
      setInviteStates((prev) => ({ ...prev, [userId]: "sent" }));
      showInviteToast(tGroups("inviteModeratorSent"), "success");
    } catch (error) {
      setInviteStates((prev) => ({ ...prev, [userId]: "error" }));
      showInviteToast(
        (error instanceof Error ? error.message : null) ??
          tGroups("inviteModeratorError"),
        "error"
      );
    }
  }

  const [queryText, setQueryText] = useState("");
  // El resultado se guarda JUNTO a la búsqueda que lo produjo; así "buscando" y
  // "resultados" se derivan por comparación, sin escribir estado en el efecto.
  const [payload, setPayload] = useState<{
    query: string;
    rows: ProfileSearchResult[];
  } | null>(null);

  const trimmed = queryText.trim();
  const isQueryLongEnough = trimmed.length >= MIN_QUERY_LENGTH;
  const isResolved = payload?.query === trimmed;

  const results = isResolved ? payload!.rows : [];
  const searching = isQueryLongEnough && !isResolved;

  function handleClose() {
    // Se limpia al cerrar para que la próxima apertura arranque en blanco.
    setQueryText("");
    setPayload(null);
    onClose();
  }

  useEffect(() => {
    if (!open || !isQueryLongEnough || isResolved) return;

    let cancelled = false;

    const timer = window.setTimeout(() => {
      void searchProfiles({ db, rawQuery: trimmed, currentUserId })
        .then((rows) => {
          if (!cancelled) setPayload({ query: trimmed, rows });
        })
        .catch(() => {
          if (!cancelled) setPayload({ query: trimmed, rows: [] });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, trimmed, isQueryLongEnough, isResolved, currentUserId]);

  const skeletonRows = useMemo(() => [0, 1, 2, 3], []);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={tGroups("inviteModeratorPanelTitle")}
      maxWidthDesktop={520}
    >
      <div className="mipWrap">
        {/* Buscador: mismo campo que /search, con la lupa morada al final. */}
        <div className="mipField">
          <input
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder={tGroups("inviteModeratorSearchPlaceholder")}
            aria-label={tGroups("inviteModeratorSearchPlaceholder")}
            className="mipInput"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <span aria-hidden="true" className="mipLupa">
            <VibraNavigationIcon type="search" size={20} strokeWidth={2.2} />
          </span>
        </div>

        {!isQueryLongEnough ? null : searching ? (
          // Skeletons con el relleno y la onda canónicos (vibra_style.md).
          <ul className="mipList" aria-hidden="true">
            {skeletonRows.map((row) => (
              <li key={row} className="mipRow">
                <span className="vb-skel mipSkelAvatar" />
                <span className="mipSkelText">
                  <span className="vb-skel mipSkelLine mipSkelLineWide" />
                  <span className="vb-skel mipSkelLine mipSkelLineNarrow" />
                </span>
                <span className="vb-skel mipSkelBtn" />
              </li>
            ))}
          </ul>
        ) : results.length === 0 ? (
          <p className="mipHint">{tGroups("inviteModeratorEmpty")}</p>
        ) : (
          <ul className="mipList">
            {results.map((person, index) => (
              <li
                key={person.uid}
                className="mipRow mipRowReveal"
                // Entrada escalonada: los resultados aparecen suavemente, no de golpe.
                style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
              >
                <span className="mipAvatar">
                  {person.photoURL ? (
                    <Image src={person.photoURL} alt="" width={40} height={40} />
                  ) : (
                    <span className="mipAvatarFallback">
                      {(person.displayName || person.handle || "?")
                        .slice(0, 1)
                        .toUpperCase()}
                    </span>
                  )}
                </span>

                <span className="mipInfo">
                  <span className="mipName">{person.displayName}</span>
                  <span className="mipHandle">@{person.handle}</span>
                </span>

                <button
                  type="button"
                  className={
                    inviteStates[person.uid] === "sent"
                      ? "mipInvite mipInviteSent"
                      : "mipInvite"
                  }
                  disabled={
                    inviteStates[person.uid] === "sending" ||
                    inviteStates[person.uid] === "sent"
                  }
                  onClick={() => void handleInvite(person.uid)}
                >
                  {inviteStates[person.uid] === "sending"
                    ? tGroups("inviteModeratorSending")
                    : inviteStates[person.uid] === "sent"
                      ? tGroups("inviteModeratorSentShort")
                      : tGroups("inviteModeratorAction")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <VibraToast toast={inviteToast} />

      <style jsx>{`
        .mipWrap {
          display: grid;
          gap: 14px;
        }

        /* Campo canónico: relleno tenue, radio 12, sin borde. */
        .mipField {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 12px;
          padding: 8px 10px 8px 12px;
          box-sizing: border-box;
        }
        .mipInput {
          flex: 1;
          min-width: 0;
          border: none;
          background: transparent;
          outline: none;
          color: #fff;
          font-size: 13px;
          font-family: inherit;
          line-height: 1.5;
        }
        .mipInput::placeholder {
          color: rgba(255, 255, 255, 0.4);
        }
        .mipLupa {
          flex-shrink: 0;
          display: grid;
          place-items: center;
        }

        .mipHint {
          margin: 0;
          padding: 2px 0 6px;
          font-size: 12.5px;
          line-height: 1.4;
          color: rgba(255, 255, 255, 0.5);
        }

        .mipList {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 2px;
        }
        .mipRow {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 0;
        }

        /* Revelado suave de cada resultado. */
        .mipRowReveal {
          opacity: 0;
          animation: mipRevealIn var(--duration-normal) var(--ease-smooth) forwards;
        }
        @keyframes mipRevealIn {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .mipAvatar {
          flex: 0 0 auto;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.06);
          display: grid;
          place-items: center;
        }
        .mipAvatar :global(img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .mipAvatarFallback {
          color: #a855f7;
          font-weight: 700;
          font-size: 16px;
        }

        .mipInfo {
          flex: 1;
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .mipName {
          font-size: 13px;
          font-weight: 500;
          letter-spacing: -0.02em;
          color: #fff;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .mipHandle {
          font-size: 11.5px;
          color: rgba(255, 255, 255, 0.5);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .mipInvite {
          flex: 0 0 auto;
          padding: 5px 14px;
          border-radius: 8px;
          border: none;
          background: #a855f7;
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          line-height: 1.25;
          cursor: pointer;
          transition: background var(--duration-fast) var(--ease-smooth);
        }
        .mipInvite:hover:not(:disabled) {
          background: #9333ea;
        }
        .mipInvite:disabled {
          cursor: default;
          opacity: 0.65;
        }
        .mipInviteSent {
          background: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.75);
          opacity: 1;
        }

        /* ── Skeletons (relleno y onda canónicos de vibra_style.md) ── */
        .mipSkelAvatar {
          flex: 0 0 auto;
          width: 40px;
          height: 40px;
          border-radius: 50%;
        }
        .mipSkelText {
          flex: 1;
          min-width: 0;
          display: grid;
          gap: 7px;
        }
        .mipSkelLine {
          height: 11px;
          border-radius: 6px;
        }
        .mipSkelLineWide {
          width: 58%;
        }
        .mipSkelLineNarrow {
          width: 34%;
        }
        .mipSkelBtn {
          flex: 0 0 auto;
          width: 72px;
          height: 26px;
          border-radius: 8px;
        }

        @media (prefers-reduced-motion: reduce) {
          .mipRowReveal {
            animation: none;
            opacity: 1;
          }
        }
      `}</style>
    </Modal>
  );
}
