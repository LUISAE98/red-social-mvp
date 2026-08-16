"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import HomePostsFeed from "./HomePostsFeed";
import HomePostComposer from "./HomePostComposer";
import HomeStoriesRow, { invalidateFollowedIdsCache } from "@/app/components/Stories/HomeStoriesRow";
import { refreshReelFeed } from "@/lib/reels/reelFeedRefresh";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { invalidateRecommendationCache } from "@/app/components/GroupRecommendations/recommendation-engine";
import { useScreenReady } from "@/lib/useScreenReady";

const SESSION_UID_KEY = "vibra:uid";

export default function GroupsHome() {
  const { user, loading, startAuthTransition } = useAuth();
  const router = useRouter();

  // Read cached UID from sessionStorage so the feed renders immediately on
  // return visits, without waiting for Firebase's onAuthStateChanged (~100ms).
  const [cachedUid, setCachedUid] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(SESSION_UID_KEY);
  });

  // Avisa al splash de arranque cuando el feed ya tiene con qué renderizar
  // (usuario o uid en caché). Si es anónimo, redirige a login y ahí se avisa.
  useScreenReady(!!cachedUid || !!user);

  useEffect(() => {
    if (loading) return;

    if (user) {
      sessionStorage.setItem(SESSION_UID_KEY, user.uid);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCachedUid(user.uid);
    } else {
      sessionStorage.removeItem(SESSION_UID_KEY);
      setCachedUid(null);
      startAuthTransition("exiting");
      router.replace("/login?next=%2F");
    }
  }, [loading, user, router, startAuthTransition]);

  const fontStack =
    'inherit';

const pageWrap: CSSProperties = {
  // El clearance del bottom-nav lo aporta UNA sola vez `.mainCol` en el layout
  // protegido; aquí NO se vuelve a sumar (antes se duplicaba → ~218px de hueco
  // muerto al fondo para un nav de 70px).
  padding: "0 0 0",
  background: "transparent",
  minHeight: "100dvh",
  color: "#fff",
  fontFamily: fontStack,
  width: "100%",
  boxSizing: "border-box",
};

  const container: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    margin: 0,
    padding: 0,
    boxSizing: "border-box",
  };

  const feedWrap: CSSProperties = {
    marginTop: 0,
    width: "100%",
    maxWidth: 720,
    marginInlineStart: "auto",
    marginInlineEnd: "auto",
    boxSizing: "border-box",
  };

  const refreshRef = useRef<() => Promise<void>>(async () => {});

  // Use confirmed user UID first, fall back to cached UID from sessionStorage.
  // This means the feed renders immediately on return visits even while Firebase
  // confirms the session (which takes ~100ms).
  const effectiveUid = user?.uid ?? cachedUid;

  // Nothing to show: no cached session and still loading, or confirmed logged out
  if (!effectiveUid) return null;

  return (
    <main style={pageWrap}>
      <div style={container}>
        <div style={feedWrap}>
          <RefreshableArea onRefresh={() => {
            if (effectiveUid) {
              invalidateFollowedIdsCache(effectiveUid);
              refreshReelFeed();
              invalidateRecommendationCache(effectiveUid);
            }
            return refreshRef.current();
          }}>
            <HomeStoriesRow currentUserId={effectiveUid} />

            {/* Compositor: bajo las historias y sobre los posts. Publica en el
                perfil de quien mira, nunca en una comunidad. */}
            <HomePostComposer
              currentUserId={effectiveUid}
              onPublished={() => {
                void refreshRef.current();
              }}
            />

            <HomePostsFeed currentUserId={effectiveUid} refreshRef={refreshRef} />
          </RefreshableArea>
        </div>
      </div>
    </main>
  );
}
