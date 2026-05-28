"use client";

import { useCallback, useEffect, useState } from "react";

import {
  blockUser,
  followUser,
  getSocialRelationship,
  unblockUser,
  unfollowUser,
} from "@/lib/social/social-service";

import type { SocialRelationshipStatus } from "@/types/social";

const EMPTY_RELATIONSHIP: SocialRelationshipStatus = {
  isFollowing: false,
  isFollowedBy: false,
  hasBlocked: false,
  isBlockedBy: false,
  canInteract: false,
  canFollow: false,
};

type UseSocialRelationshipResult = {
  relationship: SocialRelationshipStatus;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  follow: () => Promise<void>;
  unfollow: () => Promise<void>;
  block: () => Promise<void>;
  unblock: () => Promise<void>;
};

export function useSocialRelationship(
  currentUserId: string | null | undefined,
  targetUserId: string | null | undefined
): UseSocialRelationshipResult {
  const [relationship, setRelationship] =
    useState<SocialRelationshipStatus>(EMPTY_RELATIONSHIP);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextRelationship = await getSocialRelationship({
        currentUserId,
        targetUserId,
      });

      setRelationship(nextRelationship);
    } catch (err) {
      console.error("Error loading social relationship:", err);
      setError("No se pudo cargar la relación social.");
      setRelationship(EMPTY_RELATIONSHIP);
    } finally {
      setLoading(false);
    }
  }, [currentUserId, targetUserId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const follow = useCallback(async () => {
    if (!currentUserId || !targetUserId) return;

    setLoading(true);
    setError(null);

    try {
      await followUser({ currentUserId, targetUserId });
      await refresh();
    } catch (err) {
      console.error("Error following user:", err);
      setError("No se pudo seguir este perfil.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, targetUserId, refresh]);

  const unfollow = useCallback(async () => {
    if (!currentUserId || !targetUserId) return;

    setLoading(true);
    setError(null);

    try {
      await unfollowUser({ currentUserId, targetUserId });
      await refresh();
    } catch (err) {
      console.error("Error unfollowing user:", err);
      setError("No se pudo dejar de seguir este perfil.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, targetUserId, refresh]);

  const block = useCallback(async () => {
    if (!currentUserId || !targetUserId) return;

    setLoading(true);
    setError(null);

    try {
      await blockUser({ currentUserId, targetUserId });
      await refresh();
    } catch (err) {
      console.error("Error blocking user:", err);
      setError("No se pudo bloquear este usuario.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, targetUserId, refresh]);

  const unblock = useCallback(async () => {
    if (!currentUserId || !targetUserId) return;

    setLoading(true);
    setError(null);

    try {
      await unblockUser({ currentUserId, targetUserId });
      await refresh();
    } catch (err) {
      console.error("Error unblocking user:", err);
      setError("No se pudo desbloquear este usuario.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, targetUserId, refresh]);

  return {
    relationship,
    loading,
    error,
    refresh,
    follow,
    unfollow,
    block,
    unblock,
  };
}