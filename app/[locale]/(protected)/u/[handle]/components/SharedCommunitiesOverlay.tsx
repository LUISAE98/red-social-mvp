"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { SharedCommunity } from "@/lib/social/sharedCommunities";
import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";

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

function getVisibilityLabel(
  visibility: string | null,
  t: ReturnType<typeof useTranslations>
): string | null {
  const normalized = visibility?.trim().toLowerCase();

  if (!normalized) return null;
  if (normalized === "public" || normalized === "pública" || normalized === "publica") return t("publicLabel");
  if (normalized === "private" || normalized === "privada") return t("privateLabel");
  if (normalized === "hidden" || normalized === "oculta") return t("hiddenLabel");

  return t("title");
}

export default function SharedCommunitiesOverlay({
  isOpen,
  communities,
  onClose,
}: SharedCommunitiesOverlayProps) {
  const tProfile = useTranslations("profile");
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");

  return (
    <VibraResponsivePanel
      open={isOpen}
      onClose={onClose}
      title={tProfile("sharedCommunitiesTitle")}
      subtitle={
        communities.length === 1
          ? tProfile("sharesCommunity")
          : tProfile("sharesCommunities", { count: communities.length })
      }
      closeAriaLabel={tCommon("closeAriaLabel")}
      maxWidthDesktop={440}
      contentPadding="10px 12px calc(12px + env(safe-area-inset-bottom))"
    >
      <div style={{ display: "grid", gap: 2 }}>
        {communities.map((community) => {
          const imageUrl = getCommunityImage(community);
          const visibilityLabel = getVisibilityLabel(community.visibility, tGroups);

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
    </VibraResponsivePanel>
  );
}
