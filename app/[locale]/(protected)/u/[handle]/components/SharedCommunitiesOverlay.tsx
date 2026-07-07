"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { SharedCommunity } from "@/lib/social/sharedCommunities";

type SharedCommunitiesOverlayProps = {
  isOpen: boolean;
  communities: SharedCommunity[];
  onClose: () => void;
};

function getCommunityImage(community: SharedCommunity): string | null {
  return community.avatarUrl || community.imageUrl || null;
}

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "C";
}

function getVisibilityLabel(visibility: string | null): string | null {
  const normalized = visibility?.trim().toLowerCase();

  if (!normalized) return null;
  if (normalized === "public") return "Comunidad pública";
  if (normalized === "private") return "Comunidad privada";
  if (normalized === "hidden") return "Comunidad oculta";
  if (normalized === "pública" || normalized === "publica") return "Comunidad pública";
  if (normalized === "privada") return "Comunidad privada";
  if (normalized === "oculta") return "Comunidad oculta";

  return "Comunidad";
}

export default function SharedCommunitiesOverlay({
  isOpen,
  communities,
  onClose,
}: SharedCommunitiesOverlayProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2147483647] flex items-end justify-center bg-black/80 px-4 py-4 backdrop-blur-md sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Cerrar panel de comunidades compartidas"
        onClick={onClose}
      />

      <section className="relative z-[2147483647] w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#07030d]/95 text-white shadow-[0_24px_80px_rgba(0,0,0,0.72)] backdrop-blur-xl">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-white">
              Comunidades que comparten
            </h2>
            <p className="mt-1 text-sm text-white/45">
              {communities.length === 1
                ? "Comparten 1 comunidad."
                : `Comparten ${communities.length} comunidades.`}
            </p>
          </div>

          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg font-bold text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="Cerrar"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-3 py-3">
          {communities.map((community) => {
            const imageUrl = getCommunityImage(community);
            const visibilityLabel = getVisibilityLabel(community.visibility);

            return (
              <Link
                key={community.id}
                href={`/groups/${community.id}`}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-white/5"
                onClick={onClose}
              >
                <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/8 text-sm font-bold text-white/75 ring-1 ring-white/10">
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

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">
                    {community.name}
                  </span>

                  {visibilityLabel ? (
                    <span className="mt-0.5 block text-xs text-white/45">
                      {visibilityLabel}
                    </span>
                  ) : null}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>,
    document.body
  );
}