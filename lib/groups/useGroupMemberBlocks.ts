import { useCallback, useEffect, useMemo, useState } from "react";
import type { GroupMemberBlockRelationship } from "@/lib/posts/types";
import {
  blockGroupMemberForCurrentUser,
  getGroupMemberBlockRelationship,
  unblockGroupMemberForCurrentUser,
} from "@/lib/groups/groupMemberBlocks";

const EMPTY_RELATIONSHIP: GroupMemberBlockRelationship = {
  hasBlocked: false,
  isBlockedBy: false,
};

export function useGroupMemberBlocks({
  groupId,
  currentUserId,
  targetUserId,
}: {
  groupId?: string | null;
  currentUserId?: string | null;
  targetUserId?: string | null;
}) {
  const safeGroupId = groupId?.trim() || null;
  const safeCurrentUserId = currentUserId?.trim() || null;
  const safeTargetUserId = targetUserId?.trim() || null;

  const canLoad =
    !!safeGroupId &&
    !!safeCurrentUserId &&
    !!safeTargetUserId &&
    safeCurrentUserId !== safeTargetUserId;

  const [relationship, setRelationship] =
    useState<GroupMemberBlockRelationship>(EMPTY_RELATIONSHIP);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canLoad || !safeGroupId || !safeCurrentUserId || !safeTargetUserId) {
      setRelationship(EMPTY_RELATIONSHIP);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const nextRelationship = await getGroupMemberBlockRelationship({
        groupId: safeGroupId,
        currentUserId: safeCurrentUserId,
        targetUserId: safeTargetUserId,
      });

      setRelationship(nextRelationship);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo cargar el bloqueo del grupo.");
      setRelationship(EMPTY_RELATIONSHIP);
    } finally {
      setLoading(false);
    }
  }, [canLoad, safeGroupId, safeCurrentUserId, safeTargetUserId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const block = useCallback(async () => {
    if (!canLoad || !safeGroupId || !safeTargetUserId) {
      throw new Error("Faltan datos para bloquear en este grupo.");
    }

    try {
      setMutating(true);
      setError(null);

      await blockGroupMemberForCurrentUser({
        groupId: safeGroupId,
        targetUserId: safeTargetUserId,
      });

      setRelationship({
        hasBlocked: true,
        isBlockedBy: relationship.isBlockedBy,
      });
    } catch (e: any) {
      const message = e?.message ?? "No se pudo bloquear en este grupo.";
      setError(message);
      throw new Error(message);
    } finally {
      setMutating(false);
    }
  }, [
    canLoad,
    safeGroupId,
    safeTargetUserId,
    relationship.isBlockedBy,
  ]);

  const unblock = useCallback(async () => {
    if (!canLoad || !safeGroupId || !safeTargetUserId) {
      throw new Error("Faltan datos para desbloquear en este grupo.");
    }

    try {
      setMutating(true);
      setError(null);

      await unblockGroupMemberForCurrentUser({
        groupId: safeGroupId,
        targetUserId: safeTargetUserId,
      });

      setRelationship({
        hasBlocked: false,
        isBlockedBy: relationship.isBlockedBy,
      });
    } catch (e: any) {
      const message = e?.message ?? "No se pudo desbloquear en este grupo.";
      setError(message);
      throw new Error(message);
    } finally {
      setMutating(false);
    }
  }, [
    canLoad,
    safeGroupId,
    safeTargetUserId,
    relationship.isBlockedBy,
  ]);

  return useMemo(
    () => ({
      relationship,
      loading: loading || mutating,
      error,
      refresh,
      block,
      unblock,
    }),
    [relationship, loading, mutating, error, refresh, block, unblock]
  );
}