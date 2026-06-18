"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  blockUser,
  followUser,
  getSocialRelationship,
  subscribeSocialRelationship,
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
  actionLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  follow: () => void;
  unfollow: () => void;
  block: () => Promise<void>;
  unblock: () => Promise<boolean>;
};

export function useSocialRelationship(
  currentUserId: string | null | undefined,
  targetUserId: string | null | undefined
): UseSocialRelationshipResult {
  const [relationship, setRelationship] =
    useState<SocialRelationshipStatus>(EMPTY_RELATIONSHIP);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const relationshipRef = useRef(relationship);
  const followServerStateRef = useRef(false);
  const followPendingRef = useRef<boolean | null>(null);
  const followDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { relationshipRef.current = relationship; }, [relationship]);
  useEffect(() => { followServerStateRef.current = relationship.isFollowing; }, [relationship.isFollowing]);

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
    setLoading(true);
    setError(null);
    setRelationship(EMPTY_RELATIONSHIP);

    const unsubscribe = subscribeSocialRelationship(
      {
        currentUserId,
        targetUserId,
      },
      (nextRelationship) => {
        setRelationship(nextRelationship);
        setLoading(false);
      },
      (err) => {
        console.error("Error listening social relationship:", err);
        setError("No se pudo escuchar la relación social.");
        setRelationship(EMPTY_RELATIONSHIP);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
      if (followDebounceRef.current !== null) {
        clearTimeout(followDebounceRef.current);
        followDebounceRef.current = null;
      }
      followPendingRef.current = null;
    };
  }, [currentUserId, targetUserId]);

  const scheduleFollowRequest = useCallback((desired: boolean) => {
    if (followDebounceRef.current !== null) clearTimeout(followDebounceRef.current);

    followDebounceRef.current = setTimeout(async () => {
      followDebounceRef.current = null;
      followPendingRef.current = null;

      if (desired === followServerStateRef.current) return;

      const serverState = followServerStateRef.current;
      try {
        if (desired) {
          await followUser({ currentUserId: currentUserId!, targetUserId: targetUserId! });
        } else {
          await unfollowUser({ currentUserId: currentUserId!, targetUserId: targetUserId! });
        }
      } catch (err) {
        console.error("Error follow/unfollow:", err);
        setRelationship((r) => ({ ...r, isFollowing: serverState }));
        setError("No se pudo actualizar el seguimiento.");
      }
    }, 400);
  }, [currentUserId, targetUserId]);

  const follow = useCallback(() => {
    if (!currentUserId || !targetUserId) return;
    setError(null);
    followPendingRef.current = true;
    setRelationship((r) => ({ ...r, isFollowing: true }));
    scheduleFollowRequest(true);
  }, [currentUserId, targetUserId, scheduleFollowRequest]);

  const unfollow = useCallback(() => {
    if (!currentUserId || !targetUserId) return;
    setError(null);
    followPendingRef.current = false;
    setRelationship((r) => ({ ...r, isFollowing: false }));
    scheduleFollowRequest(false);
  }, [currentUserId, targetUserId, scheduleFollowRequest]);

  const block = useCallback(async () => {
    if (!currentUserId || !targetUserId) return;

    setActionLoading(true);
    setError(null);

    try {
      await blockUser({ currentUserId, targetUserId });
    } catch (err) {
      console.error("Error blocking user:", err);
      setError("No se pudo bloquear este usuario.");
    } finally {
      setActionLoading(false);
    }
  }, [currentUserId, targetUserId]);

  const unblock = useCallback(async (): Promise<boolean> => {
    if (!currentUserId || !targetUserId) return false;

    setActionLoading(true);
    setError(null);

    try {
      await unblockUser({ currentUserId, targetUserId });
      return true;
    } catch (err) {
      console.error("Error unblocking user:", err);
      setError("No se pudo desbloquear este usuario.");
      return false;
    } finally {
      setActionLoading(false);
    }
  }, [currentUserId, targetUserId]);

  return {
    relationship,
    loading: loading || actionLoading,
    error,
    refresh,
    follow,
    unfollow,
    block,
    unblock,
    actionLoading,
  };
}