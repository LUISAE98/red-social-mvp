"use client";

import { useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { buildPublicPostUrl } from "@/lib/posts/share-url";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraShareIcon from "@/app/components/VibraServiceIcons/VibraShareIcon";

type PostShareButtonProps = {
  postId: string;
  title?: string;
  text?: string;
};

const fontStack =
  'inherit';

export default function PostShareButton({ postId }: PostShareButtonProps) {
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("groups");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast: shareToast, showToast: showShareToast } = useVibraToast(2400);

  const canShare = typeof postId === "string" && postId.trim().length > 0;

  const buttonStyle: CSSProperties = {
    width: 20,
    height: 20,
    border: "none",
    background: "transparent",
    padding: 0,
    color: "rgba(255,255,255,0.72)",
    display: "inline-grid",
    placeItems: "center",
    fontSize: 14,
    fontFamily: fontStack,
    lineHeight: 1,
    cursor: canShare ? "pointer" : "default",
    opacity: canShare ? 1 : 0.45,
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    flexShrink: 0,
  };

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    showShareToast(tCommon("linkCopiedToClipboard"), "success");
    window.setTimeout(() => {
      setCopied(false);
    }, 1400);
  }

  async function handleShare() {
    if (!canShare || busy) return;

    const url = buildPublicPostUrl(postId.trim());

    try {
      setBusy(true);

      if (navigator.share) {
        await navigator.share({
          url,
        });
        return;
      }

      await copyUrl(url);
    } catch {
      try {
        await copyUrl(url);
      } catch {
        showShareToast(tGroups("copyManuallyError"), "error");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleShare}
        aria-label={copied ? tCommon("linkCopied") : tCommon("sharePost")}
        title={copied ? tCommon("linkCopied") : tCommon("sharePost")}
        // No pasa por `IconButton` porque lleva su propia caja de 20px, así
        // que la clase del pop se pone a mano.
        className="vibra-pop"
        style={buttonStyle}
      >
        <VibraShareIcon size={20} color="#a855f7" />
      </button>
      <VibraToast toast={shareToast} />
    </>
  );
}
