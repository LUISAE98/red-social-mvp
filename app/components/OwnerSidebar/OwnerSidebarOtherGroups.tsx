"use client";

import Image from "next/image";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { useEffect, useMemo, useRef, useState } from "react";
import { leaveGroup } from "@/lib/groups/membership";
import { useTranslations } from "next-intl";
import { usePriceFormat, type PriceFormatter } from "@/lib/currency/usePriceFormat";
import { FIXED_SERVICE_FEE_USD } from "@/lib/currency/catalog";
import type { DisplayCurrency } from "@/lib/currency/catalog";
import type { Timestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";

import type {
  GroupDocLite,
  JoinRequestRow,
  OutgoingJoinRequestRow,
  UserMini,
} from "./OwnerSidebar";
import { dismissHiddenGroupTransition } from "@/lib/groups/sidebarGroups";
import { Chevron, CountBadge } from "./OwnerSidebar";
import {
  LeaveGroupActionCard,
  buildAccessNotice, buildJoinedSubtitle, isActuallyJoinedStatus,
  isJoinedLikeState, noticeToneToToastType, normalizeMemberRole, normalizeMemberStatus,
  readDismissedLegacyBanners, resolveAccessState, shouldShowGroup,
  writeDismissedLegacyBanners,
  type Props,
} from "./OwnerSidebarOtherGroups.parts";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

export default function OwnerSidebarOtherGroups({
  currentUserId,
  loadingCommunities,
  pendingJoinRequestsSent,
  joinedGrouped,
  groupMetaMap,
  styles,
  fmtDate,
  renderCommunityCard,
  joinRequestsByGroup,
  joinSectionOpen,
  setJoinSectionOpen,
  handleApproveJoin,
  handleRejectJoin,
  joinBusyKey,
  userMiniMap,
  getInitials,
  renderUserLink,
  onCreateCommunity,
  newPostsCounts = {},
}: Props) {
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("groups");
  const tNav = useTranslations("nav");
  const pf = usePriceFormat();
  const formatMoney = pf.format;
  // Label del botón: "Suscribirme · $total" con el precio TODO-INCLUIDO (base + cargo fijo + impuesto del país).
  const buildSubscribeLabel = (group: GroupDocLite): string => {
    const m = group.monetization;
    const base =
      typeof m?.subscriptionPriceMonthly === "number"
        ? m.subscriptionPriceMonthly
        : typeof m?.priceMonthly === "number"
        ? m.priceMonthly
        : null;
    return base != null && base > 0
      ? tGroups("subscribeForPrice", {
          price: pf.formatWithTax(base + FIXED_SERVICE_FEE_USD, { baseCurrency: SETTLEMENT_CURRENCY }).total,
        })
      : tGroups("subscribeCta");
  };
  const router = useRouter();
  const [dismissedGroupIds, setDismissedGroupIds] = useState<Set<string>>(
    () => new Set()
  );
  const [dismissingGroupIds, setDismissingGroupIds] = useState<Set<string>>(
    () => new Set()
  );

  // Banners "Acceso conservado" cerrados (por grupo), hidratados desde
  // localStorage tras el montaje para no romper el render del servidor.
  const [legacyBannerDismissedIds, setLegacyBannerDismissedIds] = useState<
    Set<string>
  >(() => new Set());

  useEffect(() => {
    setLegacyBannerDismissedIds(readDismissedLegacyBanners());
  }, []);

  function dismissLegacyBanner(groupId: string) {
    if (!groupId.trim()) return;
    setLegacyBannerDismissedIds((prev) => {
      if (prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.add(groupId);
      writeDismissedLegacyBanners(next);
      return next;
    });
  }

  const { toast: otherGroupsToast, showToast: showOtherGroupsToast } =
    useVibraToast();

  const [leaveTargetGroup, setLeaveTargetGroup] = useState<GroupDocLite | null>(
  null
);
const [leavingGroupId, setLeavingGroupId] = useState<string | null>(null);

  const isMobile =
    typeof window !== "undefined" ? window.innerWidth <= 640 : false;

  function persistDismissed(next: Set<string>) {
    setDismissedGroupIds(next);
  }

  function handleSubscribe(groupId: string) {
    router.push(`/groups/${groupId}?service=suscripcion`);
  }

function openLeaveConfirm(group: GroupDocLite) {
  setLeaveTargetGroup(group);
}

function closeLeaveConfirm() {
  if (leavingGroupId) return;
  setLeaveTargetGroup(null);
}

async function handleConfirmLeaveGroup() {
  if (!leaveTargetGroup) return;
  if (!currentUserId) return;
  if (leavingGroupId) return;

  setLeavingGroupId(leaveTargetGroup.id);

  try {
    await leaveGroup(leaveTargetGroup.id, currentUserId);
    setLeaveTargetGroup(null);
  } catch (error) {
    console.error("leaveGroup error", error);
  } finally {
    setLeavingGroupId(null);
  }
}

  async function handleDismiss(groupId: string) {
    if (!groupId.trim()) return;
    if (dismissingGroupIds.has(groupId)) return;

    setDismissingGroupIds((prev) => {
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });

    try {
      await dismissHiddenGroupTransition(groupId);

      const next = new Set(dismissedGroupIds);
      next.add(groupId);
      persistDismissed(next);
    } catch (error) {
      console.error("dismissHiddenGroupTransition error", error);
    } finally {
      setDismissingGroupIds((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
    }
  }

  const visibleJoinedGrouped = useMemo(() => {
    return joinedGrouped
      .map((section) => ({
        ...section,
        items: section.items.filter((g) =>
          shouldShowGroup(g, dismissedGroupIds)
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [joinedGrouped, dismissedGroupIds]);

  // Los avisos de acceso (suscripción requerida, acceso conservado, acceso
  // restringido) salen por el toast, no por una caja de color bajo la tarjeta.
  // El ref evita repetirlos: uno por comunidad y por montaje.
  const noticedGroupIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const groups = visibleJoinedGrouped.flatMap((section) => section.items);

    for (const g of groups) {
      if (noticedGroupIdsRef.current.has(g.id)) continue;

      const notice = buildAccessNotice(g, tGroups, formatMoney);
      if (!notice) continue;
      if (notice.closable && legacyBannerDismissedIds.has(g.id)) continue;

      noticedGroupIdsRef.current.add(g.id);
      showOtherGroupsToast(
        notice.title ? `${notice.title} · ${notice.text}` : notice.text,
        noticeToneToToastType(notice.tone)
      );

      // El aviso informativo (acceso conservado) se da por visto en cuanto sale
      // una vez: ya no tiene una ⨯ con la que cerrarlo.
      if (notice.closable) dismissLegacyBanner(g.id);
      break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleJoinedGrouped, legacyBannerDismissedIds]);

 const visiblePendingJoinRequestsSent: OutgoingJoinRequestRow[] =
  pendingJoinRequestsSent.filter((row: OutgoingJoinRequestRow) => {
    const community = groupMetaMap[row.groupId] ?? null;
    if (!community) {
      return true;
    }

    if (community.canDismiss === true) {
      return false;
    }

    const state = resolveAccessState(community);
    return !isJoinedLikeState(state);
  });

  const hasAnyJoined = visibleJoinedGrouped.some(
    (section) => section.items.length > 0
  );

  const hasAnyPending = visiblePendingJoinRequestsSent.length > 0;

  return (
    <>
      {visibleJoinedGrouped.map((section, sectionIndex) => (
        <div key={`joined-${section.key}`} style={{ display: "grid", gap: 8 }}>
          <div style={styles.sectionHeaderRow}>
            <div style={styles.sectionTitle}>{section.title}</div>

            {sectionIndex === 0 ? (
              <button
                type="button"
                onClick={onCreateCommunity}
                style={styles.createInlineButton}
                aria-label={tGroups("createCommunity")}
                title={tGroups("createCommunity")}
              >
                <span aria-hidden="true">+</span>
                <span>Crear</span>
              </button>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {section.items.map((g) => {
              const role = normalizeMemberRole(g);
              const isMod = role === "mod";
              const joinRequests = joinRequestsByGroup[g.id] ?? [];
              const joinListOpen = joinSectionOpen[g.id] === true;
              const accessNotice = buildAccessNotice(g, tGroups, formatMoney);
              const accessState = resolveAccessState(g);
              const memberStatus = normalizeMemberStatus(g);

              const showJoinSection =
                isMod &&
                g.visibility !== "public" &&
                joinRequests.length > 0 &&
                (accessState === "joined" ||
                  accessState === "legacy_free" ||
                  accessState === "subscribed") &&
                isActuallyJoinedStatus(memberStatus);

              if (!showJoinSection) {
                const notice = buildAccessNotice(g, tGroups, formatMoney);
return (
  <div key={g.id} style={{ display: "grid", gap: 6 }}>
<LeaveGroupActionCard
  group={g}
  isMobile={isMobile}
  renderCommunityCard={renderCommunityCard}
  subtitle={buildJoinedSubtitle(g, isMobile, newPostsCounts[g.id], tGroups, tCommon)}
  onLeave={openLeaveConfirm}
  leaveLabel={tCommon("leave")}
/>

    {/* El texto del aviso sale por el toast; aquí solo queda la acción. */}
    {notice?.showSubscribeCta && (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
        <button
          type="button"
          onClick={() => handleSubscribe(g.id)}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "#fff",
            color: "#000",
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.1,
            cursor: "pointer",
          }}
        >
          {buildSubscribeLabel(g)}
        </button>
      </div>
    )}
  </div>
);
              }

              return (
                <div
                  key={g.id}
                  style={{
                    display: "grid",
                    gap: 9,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <LeaveGroupActionCard
                      group={g}
                      isMobile={isMobile}
                      renderCommunityCard={renderCommunityCard}
                      subtitle={buildJoinedSubtitle(g, isMobile, newPostsCounts[g.id], tGroups, tCommon)}
                      onLeave={openLeaveConfirm}
                      leaveLabel={tCommon("leave")}
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setJoinSectionOpen((prev) => ({
                          ...prev,
                          [g.id]: !prev[g.id],
                        }))
                      }
                      aria-label={
                        joinListOpen
                          ? tGroups("closeJoinRequests")
                          : tGroups("openJoinRequests")
                      }
                      style={{
                        minWidth: 52,
                        height: 28,
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.02)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        cursor: "pointer",
                        flexShrink: 0,
                        padding: "0 8px",
                      }}
                    >
                      <CountBadge count={joinRequests.length} tone="blue" />
                      <Chevron open={joinListOpen} />
                    </button>
                  </div>

                  {/* El texto del aviso sale por el toast; aquí solo quedan las acciones. */}
                  {accessNotice &&
                    (accessNotice.showSubscribeCta ||
                        accessNotice.showDismissCta) && (
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            marginTop: 2,
                          }}
                        >
                          {accessNotice.showSubscribeCta && (
                            <button
                              type="button"
                              onClick={() => handleSubscribe(g.id)}
                              style={{
                                padding: "8px 12px",
                                borderRadius: 10,
                                border: "1px solid rgba(255,255,255,0.16)",
                                background: "#fff",
                                color: "#000",
                                fontSize: 12,
                                fontWeight: 700,
                                lineHeight: 1.1,
                                cursor: "pointer",
                              }}
                            >
                              {buildSubscribeLabel(g)}
                            </button>
                          )}

                          {accessNotice.showDismissCta && (
                            <button
                              type="button"
                              disabled={dismissingGroupIds.has(g.id)}
                              onClick={() => {
                                void handleDismiss(g.id);
                              }}
                              style={{
                                padding: "8px 12px",
                                borderRadius: 10,
                                border: "1px solid rgba(255,255,255,0.10)",
                                background: "rgba(255,255,255,0.05)",
                                color: "#fff",
                                fontSize: 12,
                                fontWeight: 600,
                                lineHeight: 1.1,
                                cursor: dismissingGroupIds.has(g.id)
                                  ? "not-allowed"
                                  : "pointer",
                                opacity: dismissingGroupIds.has(g.id) ? 0.7 : 1,
                              }}
                            >
                              {dismissingGroupIds.has(g.id)
                                ? tCommon("forgetting")
                                : tCommon("forget")}
                            </button>
                          )}
                        </div>
                      )}

                  <div
                    style={{
                      maxHeight: joinListOpen ? "800px" : "0",
                      overflow: "hidden",
                      opacity: joinListOpen ? 1 : 0,
                      transition: "max-height 360ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
                    }}
                  >
                    <div style={styles.sectionPanel}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            color: "#fff",
                            fontWeight: 700,
                          }}
                        >
                          {tGroups("joinRequestSectionTitle")}
                        </span>
                        <CountBadge count={joinRequests.length} tone="blue" />
                      </div>

                      <div className="mini-vertical-scroll">
                        <div style={{ display: "grid", gap: 7 }}>
                          {joinRequests.map((r) => {
                            const approveKey = `${g.id}:${r.userId}:approve`;
                            const rejectKey = `${g.id}:${r.userId}:reject`;
                            const busy =
                              joinBusyKey === approveKey ||
                              joinBusyKey === rejectKey;
                            const requester = userMiniMap[r.userId] ?? null;
                            const letter = getInitials(requester?.displayName);

                            return (
                              <div key={r.id} style={styles.miniItem}>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    minWidth: 0,
                                  }}
                                >
                                  {requester?.photoURL ? (
                                    <Image
                                      src={requester.photoURL}
                                      alt={requester.displayName}
                                      width={28} height={28}
                                      style={{
                                        borderRadius: 10,
                                        objectFit: "cover",
                                        border: "1px solid rgba(255,255,255,0.12)",
                                        flexShrink: 0,
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: 10,
                                        background: "rgba(255,255,255,0.05)",
                                        border:
                                          "1px solid rgba(255,255,255,0.12)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontWeight: 700,
                                        fontSize: 11,
                                        color: "#fff",
                                        flexShrink: 0,
                                      }}
                                    >
                                      {letter}
                                    </div>
                                  )}

                                  <div style={{ minWidth: 0 }}>
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        minWidth: 0,
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      {renderUserLink(r.userId)}
                                    </div>
                                    <div style={styles.subtle}>
                                      {tGroups("joinRequestPending")}
                                    </div>
                                  </div>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    gap: 8,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleApproveJoin(g.id, r.userId)
                                    }
                                    disabled={busy}
                                    style={{
                                      ...styles.buttonPrimary,
                                      opacity: busy ? 0.8 : 1,
                                      cursor: busy ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    {busy ? tCommon("processing") : tGroups("approveButton")}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRejectJoin(g.id, r.userId)
                                    }
                                    disabled={busy}
                                    style={{
                                      ...styles.buttonSecondary,
                                      opacity: busy ? 0.7 : 1,
                                      cursor: busy ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    {busy ? tCommon("processing") : tCommon("reject")}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {hasAnyPending && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={styles.sectionHeaderRow}>
            <div style={styles.sectionTitle}>{tGroups("joinRequestSectionTitle")}</div>

            {!hasAnyJoined ? (
              <button
                type="button"
                onClick={onCreateCommunity}
                style={styles.createInlineButton}
                aria-label={tGroups("createCommunity")}
                title={tGroups("createCommunity")}
              >
                <span aria-hidden="true">+</span>
                <span>Crear</span>
              </button>
            ) : null}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {visiblePendingJoinRequestsSent.map((row: OutgoingJoinRequestRow) => {
              const community = groupMetaMap[row.groupId] ?? null;
              if (!community) return null;

              return renderCommunityCard(community, {
                subtitle: row.createdAt
                  ? `${tGroups("joinRequestPending")} · ${fmtDate(row.createdAt)}`
                  : tGroups("joinRequestPending"),
              });
            })}
          </div>
        </div>
      )}

      {!loadingCommunities &&
        !hasAnyJoined &&
        !hasAnyPending && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={styles.sectionHeaderRow}>
              <div style={styles.sectionTitle}>{tNav("otherCommunities")}</div>

              <button
                type="button"
                onClick={onCreateCommunity}
                style={styles.createInlineButton}
                aria-label={tGroups("createCommunity")}
                title={tGroups("createCommunity")}
              >
                <span aria-hidden="true">+</span>
                <span>Crear</span>
              </button>
            </div>

            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.58)",
                padding: "2px 2px 0",
              }}
            >
              {tGroups("noOwnerCommunities")}
            </div>
          </div>
        )}
        {leaveTargetGroup && (
  <div
    role="dialog"
    aria-modal="true"
    aria-label={tGroups("leaveGroupAriaLabel")}
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      background: "rgba(0,0,0,0.72)",
      backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
      display: "grid",
      placeItems: "center",
      padding: 18,
    }}
  >
    <div
      style={{
        width: "min(420px, 100%)",
        borderRadius: 24,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(18,18,20,0.98)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.46)",
        padding: 20,
        display: "grid",
        gap: 14,
        color: "#fff",
      }}
    >
      <div style={{ display: "grid", gap: 6 }}>
<div
  style={{
    fontSize: 17,
    fontWeight: 650,
    letterSpacing: -0.2,
  }}
>
  {tGroups("leaveConfirm")}
</div>

        <div
          style={{
            fontSize: 13,
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.68)",
          }}
        >
          Vas a salir de{" "}
          <strong style={{ color: "#fff" }}>
            {leaveTargetGroup.name ?? "esta comunidad"}
          </strong>
          . Si después quieres volver, tendrás que unirte otra vez o solicitar
          acceso según la configuración del grupo.
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
<button
  type="button"
  onClick={closeLeaveConfirm}
  disabled={!!leavingGroupId}
  style={{
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.045)",
    color: "#fff",
    borderRadius: 14,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 550,
    cursor: leavingGroupId ? "not-allowed" : "pointer",
    opacity: leavingGroupId ? 0.7 : 1,
  }}
>
  {tCommon("cancel")}
</button>

<button
  type="button"
  onClick={handleConfirmLeaveGroup}
  disabled={!!leavingGroupId}
  style={{
    border: "1px solid rgba(248,113,113,0.26)",
    background: "rgba(239,68,68,0.88)",
    color: "#fff",
    borderRadius: 14,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: leavingGroupId ? "not-allowed" : "pointer",
    opacity: leavingGroupId ? 0.75 : 1,
  }}
>
  {leavingGroupId ? tCommon("loading") : tCommon("leave")}
</button>
      </div>
    </div>
  </div>
)}
      <VibraToast toast={otherGroupsToast} />
    </>
  );
}
