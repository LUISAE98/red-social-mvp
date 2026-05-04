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

export default function PostShareButton({
  postId,
  title = "Publicación",
  text = "Mira esta publicación.",
}: PostShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const buttonStyle: CSSProperties = {
    width: 28,
    height: 28,
    border: "none",
    background: "transparent",
    padding: 0,
    color: "rgba(255,255,255,0.72)",
    display: "inline-grid",
    placeItems: "center",
    fontSize: 18,
    fontFamily: fontStack,
    lineHeight: 1,
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.62 : 1,
    WebkitTapHighlightColor: "transparent",
    flexShrink: 0,
  };

  async function handleShare() {
    if (busy) return;

    const url = buildPublicPostUrl(postId);

    try {
      setBusy(true);

      if (navigator.share) {
        await navigator.share({
          title,
          text,
          url,
        });
        return;
      }

      await navigator.clipboard.writeText(url);
      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1400);
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);

        window.setTimeout(() => {
          setCopied(false);
        }, 1400);
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
      disabled={busy}
      aria-label={copied ? "Link copiado" : "Compartir publicación"}
      title={copied ? "Link copiado" : "Compartir publicación"}
      style={buttonStyle}
    >
      <span aria-hidden="true">{copied ? "✅" : "📤"}</span>
    </button>
  );
}