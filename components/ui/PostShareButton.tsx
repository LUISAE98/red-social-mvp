"use client";

import { useState, type CSSProperties } from "react";
import { buildPublicPostUrl } from "@/lib/posts/share-url";

type PostShareButtonProps = {
  postId: string;
  title?: string;
  text?: string;
};

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

export default function PostShareButton({ postId }: PostShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

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
        window.alert("No se pudo copiar el link.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label={copied ? "Link copiado" : "Compartir publicación"}
      title={copied ? "Link copiado" : "Compartir publicación"}
      style={buttonStyle}
    >
      <span aria-hidden="true">{copied ? "✅" : "🔗"}</span>
    </button>
  );
}