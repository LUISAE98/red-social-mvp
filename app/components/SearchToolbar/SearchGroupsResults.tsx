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
    padding: 14,
    display: "grid",
    gap: 10,
  };

  const emptyStyle: CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "15px 16px",
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 1.45,
  };

  const sectionStyle: CSSProperties = {
    display: "grid",
    gap: 8,
  };

  const sectionTitleStyle: CSSProperties = {
    margin: "2px 0 0 0",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.54)",
    padding: "0 2px",
  };

  const cardStyle: CSSProperties = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.025)",
    padding: 12,
    display: "grid",
    gap: 10,
    cursor: "pointer",
  };

  const mainGridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
  };

  const mainInfoStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  };

  const avatarStyle: CSSProperties = {
    width: 48,
    height: 48,
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
    fontSize: 13,
    fontWeight: 700,
  };

  const contentStyle: CSSProperties = {
    minWidth: 0,
    display: "grid",
    gap: 6,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    color: "#fff",
    fontSize: 14.5,
    fontWeight: 700,
    lineHeight: 1.2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const metaRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  };

  const pillStyle: CSSProperties = {
    fontSize: 11,
    padding: "3px 8px",
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
    fontSize: 11,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.25,
  };

  const dangerMetaStyle: CSSProperties = {
    ...inlineMetaStyle,
    color: "rgba(255,176,176,0.9)",
  };

  const actionWrapStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    flexWrap: "nowrap",
    flexShrink: 0,
  };

  const primaryButtonStyle: CSSProperties = {
    minHeight: 34,
    padding: "7px 11px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,0.22)",
    background: "#fff",
    color: "#000",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
    fontFamily: fontStack,
    whiteSpace: "nowrap",
  };

  const secondaryButtonStyle: CSSProperties = {
    minHeight: 34,
    padding: "7px 11px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
    fontFamily: fontStack,
    whiteSpace: "nowrap",
  };

  const disabledButtonStyle: CSSProperties = {
    minHeight: 34,
    padding: "7px 11px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.68)",
    fontWeight: 700,
    fontSize: 12,
    fontFamily: fontStack,
    cursor: "default",
    whiteSpace: "nowrap",
  };

  const exactGroups = communities.filter(
    (group) => (group.searchMatchType ?? "exact") === "exact"
  );

  const relatedGroups = communities.filter(
    (group) => group.searchMatchType === "related"
  );

  const suggestedGroups = communities.filter(
    (group) => group.searchMatchType === "suggested"
  );

  if (communities.length === 0) {
    return (
      <section style={shellStyle}>
        <div style={emptyStyle}>
          No se encontraron grupos con esa búsqueda.
        </div>
      </section>
    );
  }

  function renderGroupCard(group: Community) {
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
          <div style={mainInfoStyle}>
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
                      Enviada
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
  }

  return (
    <section style={shellStyle}>
      {exactGroups.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Coincidencias</h2>
          {exactGroups.map(renderGroupCard)}
        </div>
      )}

      {relatedGroups.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Grupos relacionados</h2>
          {relatedGroups.map(renderGroupCard)}
        </div>
      )}

      {relatedGroups.length === 0 && suggestedGroups.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Comunidades que te pueden interesar</h2>
          {suggestedGroups.map(renderGroupCard)}
        </div>
      )}
    </section>
  );
}