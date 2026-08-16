"use client";

// Feed de saludos y consejos. En celular es una pestaña propia del nav; en
// escritorio el mismo contenido se ve como rail en el home y se abre en el
// carrusel de siempre, así que esta página está pensada para el móvil.

import { useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import { useScreenReady } from "@/lib/useScreenReady";
import { recordStoryView } from "@/lib/stories/storyService";
import { useReelFeed } from "@/lib/reels/useReelFeed";
import ReelFeed from "@/components/reels/ReelFeed";

/** Alto del nav inferior, para que el feed acabe justo encima. */
const NAV_CLEARANCE = "calc(70px + var(--vb-safe-bottom, 0px))";

const fullScreenCenter: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  bottom: NAV_CLEARANCE,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: 32,
  background: "#000",
};

export default function ReelsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const tCommon = useTranslations("common");

  const { stories, ready, loadMore } = useReelFeed(user?.uid);

  useScreenReady(ready);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login?next=%2Freels");
  }, [loading, user, router]);

  const handleStoryViewed = useCallback(
    (storyId: string) => {
      const uid = user?.uid;
      // Las reglas de `userStoryViews` exigen cuenta real. Un invitado no suma a
      // `viewsCount`, que es la señal que ordena el feed. Se resuelve en Express.
      if (!uid || user?.isAnonymous) return;
      void recordStoryView(uid, storyId).catch(() => {});
    },
    [user?.uid, user?.isAnonymous],
  );

  if (!user) return null;

  // Mientras llega la primera tanda había pantalla negra a secas: el feed se
  // montaba con la lista vacía y el mensaje de "no hay historias" solo aparecía
  // al terminar de cargar. Negro sin señal se lee como app rota.
  if (!ready || stories.length === 0) {
    return (
      <div style={fullScreenCenter}>
        {ready ? (
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, textAlign: "center" }}>
            {tCommon("noStoriesYet")}
          </span>
        ) : (
          <>
            <style>{`@keyframes reelSpinner { to { transform: rotate(360deg); } }`}</style>
            <div
              aria-label={tCommon("loading")}
              role="status"
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                border: "3px solid rgba(255,255,255,0.12)",
                borderTopColor: "#a855f7",
                animation: "reelSpinner 0.8s linear infinite",
              }}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <ReelFeed
      stories={stories}
      onLoadMore={loadMore}
      onStoryViewed={handleStoryViewed}
      safeBottom={NAV_CLEARANCE}
    />
  );
}
