"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import {
  normalizeMemberStatus,
  normalizeMemberRole,
  normalizeMembershipAccessType,
  isJoinedStatus,
  type GroupDoc,
  type JoinRequestStatus,
  type MemberStatus,
  type MemberRole,
  type MembershipAccessType,
} from "@/lib/groups/groupAdapters";

type UseGroupRealtimeParams = {
  groupId: string;
  userId?: string | null;
};

type UseGroupRealtimeResult = {
  group: GroupDoc | null;
  loading: boolean;
  error: string | null;
  isMember: boolean;
  memberStatus: MemberStatus;
  memberRole: MemberRole;
  membershipAccessType: MembershipAccessType;
  membershipRequiresSubscription: boolean;
  membershipSubscriptionActive: boolean;
  membershipLegacyComplimentary: boolean;
  membershipTransitionPendingAction: boolean;
  membershipTransitionReason: string | null;
  joinReqStatus: JoinRequestStatus | null;
};

export function useGroupRealtime({
  groupId,
  userId,
}: UseGroupRealtimeParams): UseGroupRealtimeResult {
  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [memberStatus, setMemberStatus] = useState<MemberStatus>(null);
  const [memberRole, setMemberRole] = useState<MemberRole>(null);
  const [membershipAccessType, setMembershipAccessType] =
    useState<MembershipAccessType>("unknown");
  const [membershipRequiresSubscription, setMembershipRequiresSubscription] =
    useState(false);
  const [membershipSubscriptionActive, setMembershipSubscriptionActive] =
    useState(false);
  const [membershipLegacyComplimentary, setMembershipLegacyComplimentary] =
    useState(false);
  const [membershipTransitionPendingAction, setMembershipTransitionPendingAction] =
    useState(false);
  const [membershipTransitionReason, setMembershipTransitionReason] =
    useState<string | null>(null);
  const [joinReqStatus, setJoinReqStatus] =
    useState<JoinRequestStatus | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const gref = doc(db, "groups", groupId);

    const unsubGroup = onSnapshot(
      gref,
      (gsnap) => {
        if (!gsnap.exists()) {
          setGroup(null);
          setError("Comunidad no encontrada.");
          setLoading(false);
          return;
        }

        setGroup({
          id: gsnap.id,
          ...(gsnap.data() as Omit<GroupDoc, "id">),
        });

        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );

    let unsubMember = () => {};
    if (userId) {
      const mref = doc(db, "groups", groupId, "members", userId);

      unsubMember = onSnapshot(
        mref,
        (msnap) => {
          if (!msnap.exists()) {
            setIsMember(false);
            setMemberStatus(null);
            setMemberRole(null);
            setMembershipAccessType("unknown");
            setMembershipRequiresSubscription(false);
            setMembershipSubscriptionActive(false);
            setMembershipLegacyComplimentary(false);
            setMembershipTransitionPendingAction(false);
            setMembershipTransitionReason(null);
            return;
          }

          const data = msnap.data() as Record<string, unknown>;
          const status = normalizeMemberStatus(data?.status ?? "active");
          const role = normalizeMemberRole(
            data?.roleInGroup ?? data?.role ?? "member"
          );
          const accessType = normalizeMembershipAccessType(data?.accessType);
          const requiresSubscription = data?.requiresSubscription === true;
          const subscriptionActive = data?.subscriptionActive === true;
          const legacyComplimentary =
            data?.legacyComplimentary === true ||
            accessType === "legacy_free";
          const transitionPendingAction = data?.transitionPendingAction === true;
          const transitionReason =
            typeof data?.removedReason === "string"
              ? data.removedReason
              : data?.removedDueToSubscriptionTransition === true
              ? "subscription_transition"
              : null;

          setMemberStatus(status);
          setMemberRole(role);
          setMembershipAccessType(accessType);
          setMembershipRequiresSubscription(requiresSubscription);
          setMembershipSubscriptionActive(subscriptionActive);
          setMembershipLegacyComplimentary(legacyComplimentary);
          setMembershipTransitionPendingAction(transitionPendingAction);
          setMembershipTransitionReason(transitionReason);

          setIsMember(isJoinedStatus(status));
        },
        () => {
          setIsMember(false);
          setMemberStatus(null);
          setMemberRole(null);
          setMembershipAccessType("unknown");
          setMembershipRequiresSubscription(false);
          setMembershipSubscriptionActive(false);
          setMembershipLegacyComplimentary(false);
          setMembershipTransitionPendingAction(false);
          setMembershipTransitionReason(null);
        }
      );
    } else {
      setIsMember(false);
      setMemberStatus(null);
      setMemberRole(null);
      setMembershipAccessType("unknown");
      setMembershipRequiresSubscription(false);
      setMembershipSubscriptionActive(false);
      setMembershipLegacyComplimentary(false);
      setMembershipTransitionPendingAction(false);
      setMembershipTransitionReason(null);
    }

    let unsubJoinReq = () => {};
    if (userId) {
      const jref = doc(db, "groups", groupId, "joinRequests", userId);
      unsubJoinReq = onSnapshot(
        jref,
        (jsnap) => {
          if (!jsnap.exists()) {
            setJoinReqStatus(null);
          } else {
            const jd = jsnap.data() as Record<string, unknown>;
            setJoinReqStatus((jd.status as JoinRequestStatus) ?? "pending");
          }
        },
        () => setJoinReqStatus(null)
      );
    } else {
      setJoinReqStatus(null);
    }

    return () => {
      unsubGroup();
      unsubMember();
      unsubJoinReq();
    };
  }, [groupId, userId]);

  return {
    group,
    loading,
    error,
    isMember,
    memberStatus,
    memberRole,
    membershipAccessType,
    membershipRequiresSubscription,
    membershipSubscriptionActive,
    membershipLegacyComplimentary,
    membershipTransitionPendingAction,
    membershipTransitionReason,
    joinReqStatus,
  };
}