"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getSharedCommunitiesWithProfile,
  type SharedCommunity,
} from "@/lib/social/sharedCommunities";
import SharedCommunitiesOverlay from "./SharedCommunitiesOverlay";

type SharedCommunitiesBadgeProps = {
  profileUid: string;
  viewerUid: string | null;
};

function getCommunityImage(community: SharedCommunity): string | null {
  return community.avatarUrl || community.imageUrl || null;
}

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "C";
}

export default function SharedCommunitiesBadge({
  profileUid,
  viewerUid,
}: SharedCommunitiesBadgeProps) {
  const [communities, setCommunities] = useState<SharedCommunity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isTouchPopping, setIsTouchPopping] = useState(false);

  const shouldFetch = Boolean(profileUid && viewerUid && profileUid !== viewerUid);

  useEffect(() => {
    let isMounted = true;

    async function loadSharedCommunities() {
      if (!shouldFetch) {
        setCommunities([]);
        return;
      }

      setIsLoading(true);

      try {
        const response = await getSharedCommunitiesWithProfile(profileUid);
        if (!isMounted) return;
        setCommunities(response.communities);
      } catch (error) {
        console.error("Error loading shared communities:", error);
        if (!isMounted) return;
        setCommunities([]);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadSharedCommunities();

    return () => {
      isMounted = false;
    };
  }, [profileUid, shouldFetch]);

  const shouldShowPlus = communities.length > 3;

  const visibleCommunities = useMemo(() => {
    return communities.slice(0, 3);
  }, [communities]);

  if (!shouldFetch || isLoading || communities.length === 0) {
    return null;
  }

  function handleTouchStart() {
    setIsTouchPopping(true);

    window.setTimeout(() => {
      setIsTouchPopping(false);
    }, 180);
  }

  return (
    <>
<button
  type="button"
  className="group flex max-w-[160px] items-center justify-end bg-transparent px-0 py-0 transition-opacity duration-200" 
  aria-label="Ver comunidades que comparten"
  title="Comunidades que comparten"
  onTouchStart={handleTouchStart}
  onClick={() => setIsOverlayOpen(true)}
>
        <span className="flex items-center">
          {visibleCommunities.map((community, index) => {
            const imageUrl = getCommunityImage(community);

            return (
              <span
                key={community.id}
className={[
  "relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-900 text-[11px] font-bold text-white/75 shadow-[0_8px_18px_rgba(0,0,0,0.32)]",
  "brightness-[0.74] saturate-[0.9] transition-all duration-300 ease-out",
  "group-hover:brightness-100 group-hover:saturate-100 group-hover:-translate-y-0.5 group-hover:scale-105",
  isTouchPopping ? "scale-105 brightness-100 saturate-100" : "",
].join(" ")}
                style={{
                  marginLeft: index === 0 ? 0 : -15,
                  zIndex: 20 + index,
                }}
                aria-label={community.name}
              >
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={community.name}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  getInitial(community.name)
                )}
              </span>
            );
          })}

          {shouldShowPlus ? (
            <span
className={[
  "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-700/85 text-base font-black text-white shadow-[0_8px_18px_rgba(0,0,0,0.32)]",
  "transition-all duration-300 ease-out",
  "group-hover:-translate-y-0.5 group-hover:scale-105 group-hover:bg-purple-600/95",
  isTouchPopping ? "scale-105 bg-purple-600/95" : "",
].join(" ")}
              style={{
                marginLeft: -15,
                zIndex: 40,
              }}
              aria-label={`Comparten ${communities.length} comunidades`}
            >
              +
            </span>
          ) : null}
        </span>
      </button>

      <SharedCommunitiesOverlay
        isOpen={isOverlayOpen}
        communities={communities}
        onClose={() => setIsOverlayOpen(false)}
      />
    </>
  );
}