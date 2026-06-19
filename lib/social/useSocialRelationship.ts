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
  // Prevents double-tap: true while a follow/unfollow write is in flight
  const followInFlightRef = useRef(false);

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
    followInFlightRef.current = false;

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
      followInFlightRef.current = false;
    };
  }, [currentUserId, targetUserId]);

  // Fires followUser immediately — Firestore applies the local write synchronously,
  // which triggers onSnapshot on getFollowingDocRef in the same tick, so the UI
  // (button + OwnerSidebar) updates before the server round-trip completes.
  const follow = useCallback(() => {
    if (!currentUserId || !targetUserId) return;
    if (followInFlightRef.current) return;
    followInFlightRef.current = true;
    setError(null);
    followUser({ currentUserId, targetUserId })
      .then(() => {
        followInFlightRef.current = false;
      })
      .catch((err) => {
        console.error("Error following user:", err);
        setError("No se pudo seguir a este usuario.");
        followInFlightRef.current = false;
      });
  }, [currentUserId, targetUserId]);

  const unfollow = useCallback(() => {
    if (!currentUserId || !targetUserId) return;
    if (followInFlightRef.current) return;
    followInFlightRef.current = true;
    setError(null);
    unfollowUser({ currentUserId, targetUserId })
      .then(() => {
        followInFlightRef.current = false;
      })
      .catch((err) => {
        console.error("Error unfollowing user:", err);
        setError("No se pudo dejar de seguir a este usuario.");
        followInFlightRef.current = false;
      });
  }, [currentUserId, targetUserId]);

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
