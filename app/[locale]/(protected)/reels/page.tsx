"use client";

// Feed de saludos y consejos.
//
// En celular es una pestaña propia del nav; en escritorio se llega por URL y se
// abre como carrusel. De esa decisión se encarga `ReelsSurface`, no esta página.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import { useScreenReady } from "@/lib/useScreenReady";
import { useReelFeed } from "@/lib/reels/useReelFeed";
import ReelsSurface from "@/components/reels/ReelsSurface";

export default function ReelsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const { items, ready, loadMore, recordEngagement } = useReelFeed(user?.uid);

  useScreenReady(ready);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login?next=%2Freels");
  }, [loading, user, router]);

  if (!user) return null;

  return (
    <ReelsSurface
      uid={user.uid}
      isAnonymous={!!user.isAnonymous}
      items={items}
      ready={ready}
      loadMore={loadMore}
      recordEngagement={recordEngagement}
    />
  );
}
