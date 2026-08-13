"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getSharedCommunitiesWithProfile,
  type SharedCommunity,
} from "@/lib/social/sharedCommunities";
import SharedCommunitiesOverlay from "./SharedCommunitiesOverlay";

// Module-level cache — survives navigation in the same tab
type CommunitiesCacheEntry = { communities: SharedCommunity[]; cachedAt: number };
const communitiesCache = new Map<string, CommunitiesCacheEntry>();
const COMMUNITIES_CACHE_TTL_MS = 3 * 60 * 1000;

function peekCommunities(key: string): SharedCommunity[] | null {
  const e = communitiesCache.get(key);
  if (!e || Date.now() - e.cachedAt > COMMUNITIES_CACHE_TTL_MS) return null;
  return e.communities;
}

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
  const tProfile = useTranslations("profile");

  const cacheKey = `${viewerUid}:${profileUid}`;
  const shouldFetch = Boolean(profileUid && viewerUid && profileUid !== viewerUid);

  const [communities, setCommunities] = useState<SharedCommunity[]>(() =>
    shouldFetch ? (peekCommunities(cacheKey) ?? []) : []
  );
  const [isLoading, setIsLoading] = useState<boolean>(() =>
    shouldFetch ? !peekCommunities(cacheKey) : false
  );
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isTouchPopping, setIsTouchPopping] = useState(false);

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
        communitiesCache.set(cacheKey, { communities: response.communities, cachedAt: Date.now() });
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
  }, [profileUid, shouldFetch, cacheKey]);

  const shouldShowPlus = communities.length > 3;

  const visibleCommunities = useMemo(() => {
    return communities.slice(0, 3);
  }, [communities]);

  if (!shouldFetch || communities.length === 0) {
    if (isLoading) {
      // Placeholder con el skeleton canónico de Vibra (vibra_style.md): onda
      // .vb-skel / vbSkelWave. Mantiene las dimensiones del badge (sin layout shift).
      return (
        <span
          className="flex items-center"
          style={{ minWidth: 32, minHeight: 32 }}
          aria-hidden="true"
        >
          <style jsx>{`
            .vb-skel {
              background: linear-gradient(
                100deg,
                rgba(255, 255, 255, 0.05) 30%,
                rgba(255, 255, 255, 0.11) 50%,
                rgba(255, 255, 255, 0.05) 70%
              );
              background-size: 300% 100%;
              animation: vbSkelWave 1.6s ease-in-out infinite;
            }
            @keyframes vbSkelWave {
              0% {
                background-position: 180% 0;
              }
              100% {
                background-position: -80% 0;
              }
            }
            @media (prefers-reduced-motion: reduce) {
              .vb-skel {
                animation: none;
                background: rgba(255, 255, 255, 0.07);
              }
            }
          `}</style>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="vb-skel relative flex h-8 w-8 shrink-0 rounded-full"
              style={{ marginInlineStart: i === 0 ? 0 : -15, zIndex: 20 + i }}
            />
          ))}
        </span>
      );
    }
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
  aria-label={tProfile("sharedCommunitiesBadgeAriaLabel")}
  title={tProfile("sharedCommunitiesTitle")}
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
                  marginInlineStart: index === 0 ? 0 : -15,
                  zIndex: 20 + index,
                }}
                aria-label={community.name}
              >
                {imageUrl ? (
                  <Image
                    src={imageUrl}
                    alt={community.name}
                    fill
                    style={{ objectFit: "cover" }}
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
                marginInlineStart: -15,
                zIndex: 40,
              }}
              aria-label={tProfile("sharesCommunities", { count: communities.length })}
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