"use client";

import type { CSSProperties } from "react";
import type { User } from "firebase/auth";

import type {
  CanonicalMemberStatus,
  Community,
} from "./GroupsSearchPanel";

type SearchGroupsResultsProps = {
  fontStack: string;
  currentUser: User | null;
  communities: Community[];
  memberMap: Record<string, CanonicalMemberStatus>;
  reqMap: Record<string, boolean>;
  onNavigate: (href: string) => void;
  onJoinPublic: (groupId: string) => Promise<void>;
  onRequestPrivate: (groupId: string) => Promise<void>;
  onCancelRequest: (groupId: string) => Promise<void>;
  onLeave: (groupId: string, ownerId?: string) => Promise<void>;
};

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "C";
}

function isJoinedStatus(status: CanonicalMemberStatus) {
  return status === "active" || status === "muted";
}

function isBlockedStatus(status: CanonicalMemberStatus) {
  return status === "banned" || status === "removed";
}

function membershipStatusLabel(status: CanonicalMemberStatus) {
  if (status === "active") return "Ya estás unido";
  if (status === "muted") return "Ya estás unido (muteado)";
  if (status === "banned") return "Baneado";
  if (status === "removed") return "Expulsado";
  return "";
}

export default function SearchGroupsResults({
  fontStack,
  currentUser,
  communities,
  memberMap,
  reqMap,
  onNavigate,
  onJoinPublic,
  onRequestPrivate,
  onCancelRequest,
  onLeave,
}: SearchGroupsResultsProps) {
  const shellStyle: CSSProperties = {
    minHeight: 0,
    overflowY: "auto",
    padding: 16,
    display: "grid",
    gap: 12,
  };

  const emptyStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "16px 18px",
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 1.5,
  };

  const cardStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.025)",
    padding: 14,
    display: "grid",
    gap: 12,
    cursor: "pointer",
  };

  const mainGridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    gap: 12,
    alignItems: "center",
  };

  const avatarStyle: CSSProperties = {
    width: 56,
    height: 56,
    borderRadius: "50%",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  };

  const fallbackStyle: CSSProperties = {
    color: "#fff",
    fontSize: 15,
    fontWeight: 700,
  };

  const contentStyle: CSSProperties = {
    minWidth: 0,
    display: "grid",
    gap: 8,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    color: "#fff",
    fontSize: 15.5,
    fontWeight: 700,
    lineHeight: 1.2,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const descStyle: CSSProperties = {
    margin: 0,
    color: "rgba(255,255,255,0.68)",
    fontSize: 12.5,
    lineHeight: 1.45,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const metaRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  };

  const pillStyle: CSSProperties = {
    fontSize: 12,
    padding: "4px 9px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.88)",
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };

  const paidPillStyle: CSSProperties = {
    ...pillStyle,
    border: "1px solid rgba(255,225,166,0.26)",
    background: "rgba(255,225,166,0.10)",
    fontWeight: 700,
  };

  const inlineMetaStyle: CSSProperties = {
    fontSize: 12,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.3,
  };

  const dangerMetaStyle: CSSProperties = {
    ...inlineMetaStyle,
    color: "rgba(255,176,176,0.9)",
  };

  const actionWrapStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    flexWrap: "wrap",
  };

  const primaryButtonStyle: CSSProperties = {
    minHeight: 38,
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "#fff",
    color: "#000",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    fontFamily: fontStack,
    whiteSpace: "nowrap",
  };

  const secondaryButtonStyle: CSSProperties = {
    minHeight: 38,
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    fontFamily: fontStack,
    whiteSpace: "nowrap",
  };

  const disabledButtonStyle: CSSProperties = {
    minHeight: 38,
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.68)",
    fontWeight: 700,
    fontSize: 13,
    fontFamily: fontStack,
    cursor: "default",
    whiteSpace: "nowrap",
  };

  if (communities.length === 0) {
    return (
      <section style={shellStyle}>
        <div style={emptyStyle}>
          No se encontraron grupos con esa búsqueda.
        </div>
      </section>
    );
  }

  return (
    <section style={shellStyle}>
      {communities.map((group) => {
        const isOwner =
          !!currentUser && !!group.ownerId && group.ownerId === currentUser.uid;

        const membershipStatus = isOwner ? "active" : memberMap[group.id] ?? null;
        const isMember = isOwner || isJoinedStatus(membershipStatus);
        const isBlocked = !isOwner && isBlockedStatus(membershipStatus);

        const isPrivate = group.visibility === "private";
        const isPublic = group.visibility === "public";
        const hasPendingReq = !!reqMap[group.id];

        const visLabel =
          group.visibility === "public"
            ? "Comunidad pública"
            : group.visibility === "private"
              ? "Comunidad privada"
              : "Comunidad oculta";

        const paid = !!group.monetization?.isPaid;
        const price = group.monetization?.priceMonthly ?? null;
        const cur = group.monetization?.currency ?? null;

        return (
          <article
            key={group.id}
            style={cardStyle}
            onClick={() => onNavigate(`/groups/${group.id}`)}
          >
            <div style={mainGridStyle}>
              <div style={avatarStyle}>
                {group.avatarUrl ? (
                  <img
                    src={group.avatarUrl}
                    alt={group.name ?? "Comunidad"}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <span style={fallbackStyle}>
                    {initialsFromName(group.name ?? "Comunidad")}
                  </span>
                )}
              </div>

              <div style={contentStyle}>
                <h3 style={titleStyle}>{group.name ?? "(sin nombre)"}</h3>

                {!!group.description && (
                  <p style={descStyle}>{group.description}</p>
                )}

                <div style={metaRowStyle}>
                  <span style={pillStyle}>{visLabel}</span>

                  {paid && (
                    <span style={paidPillStyle}>
                      Con suscripción
                      {price != null ? ` · ${price} ${cur ?? ""}` : ""}
                    </span>
                  )}

                  {isOwner && (
                    <span style={inlineMetaStyle}>(Eres owner)</span>
                  )}

                  {!isOwner && isMember && (
                    <span style={inlineMetaStyle}>
                      ({membershipStatusLabel(membershipStatus)})
                    </span>
                  )}

                  {!isOwner && isBlocked && (
                    <span style={dangerMetaStyle}>
                      ({membershipStatusLabel(membershipStatus)})
                    </span>
                  )}

                  {!isOwner &&
                    !isMember &&
                    !isBlocked &&
                    isPrivate &&
                    hasPendingReq && (
                      <span style={inlineMetaStyle}>(Pendiente)</span>
                    )}
                </div>
              </div>

              <div
                style={actionWrapStyle}
                onClick={(e) => e.stopPropagation()}
              >
                {!isOwner && !isMember && !isBlocked && isPublic && (
                  <button
                    type="button"
                    style={primaryButtonStyle}
                    onClick={() => void onJoinPublic(group.id)}
                  >
                    Unirme
                  </button>
                )}

                {!isOwner && !isMember && !isBlocked && isPrivate && (
                  <>
                    {!hasPendingReq ? (
                      <button
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={() => void onRequestPrivate(group.id)}
                      >
                        Solicitar acceso
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          style={disabledButtonStyle}
                          disabled
                        >
                          Solicitud enviada
                        </button>

                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={() => void onCancelRequest(group.id)}
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                  </>
                )}

                {isMember && !isOwner && (
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={() => void onLeave(group.id, group.ownerId)}
                  >
                    Salir
                  </button>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}