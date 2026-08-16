"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  VibraNavigationIcon,
  VibraNavigationIconsStyles,
} from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

type CopyLinkButtonProps = {
  href: string;
  label?: string;
  copiedLabel?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  iconOnly?: boolean;
};

function getAbsoluteUrl(href: string) {
  if (typeof window === "undefined") return href;

  try {
    return new URL(href, window.location.origin).toString();
  } catch {
    return window.location.origin;
  }
}

export default function CopyLinkButton({
  href,
  label,
  copiedLabel,
  title,
  disabled = false,
  className,
  style,
  iconOnly = true,
}: CopyLinkButtonProps) {
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("groups");
  const resolvedLabel = label ?? tCommon("copyLink");
  const resolvedCopiedLabel = copiedLabel ?? tCommon("linkCopiedToClipboard");
  const resolvedTitle = title ?? tCommon("copyLinkTitle");
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { toast: copyToast, showToast: showCopyToast } = useVibraToast(2400);

useEffect(() => {
  if (typeof window === "undefined") return;

  const mediaQuery = window.matchMedia("(max-width: 900px)");

  const sync = () => setIsMobile(mediaQuery.matches);
  sync();

  mediaQuery.addEventListener("change", sync);

  return () => mediaQuery.removeEventListener("change", sync);
}, []);

  const absoluteUrl = useMemo(() => getAbsoluteUrl(href), [href]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function handleCopy(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();

    if (disabled) return;

    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      showCopyToast(tCommon("linkCopiedToClipboard"), "success");
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = absoluteUrl;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";

        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);

        setCopied(true);
        showCopyToast(tCommon("linkCopiedToClipboard"), "success");
      } catch {
        showCopyToast(tGroups("copyManuallyError"), "error");
      }
    }
  }

const buttonStyle: CSSProperties = {
  width: iconOnly ? 24 : "auto",
  height: 24,
  minWidth: iconOnly ? 24 : "auto",
  minHeight: 24,
  borderRadius: 0,
  border: "none",
  background: "transparent",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: iconOnly ? 0 : "6px 8px",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : copied ? 1 : isMobile ? 0.85 : 0.65,
  boxShadow: "none",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
  userSelect: "none",
  position: "relative",
  overflow: "visible",
  transition: "opacity 160ms ease",
  ...style,
};
const copyIconStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  opacity: copied ? 0 : 1,
  transform: copied ? "scale(0.35)" : "scale(1)",
  transition:
    "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 140ms ease",
};

const copiedCircleStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: 24,
  height: 24,
  borderRadius: 999,
  background: "rgba(34,197,94,0.95)",
  boxShadow: "0 8px 18px rgba(34,197,94,0.24)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  opacity: copied ? 1 : 0,
  transform: copied
    ? "translate(-50%, -50%) scale(1)"
    : "translate(-50%, -50%) scale(0.35)",
  transition:
    "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 140ms ease",
  pointerEvents: "none",
};


  return (
    <>
      <VibraNavigationIconsStyles />

      <button
        type="button"
        className={className}
        onClick={handleCopy}
        disabled={disabled}
        title={resolvedTitle}
        aria-label={resolvedTitle}
        style={buttonStyle}
      >
<span aria-hidden="true" style={copyIconStyle}>
  <VibraNavigationIcon type="copyLink" size={21} />
</span>

<span aria-hidden="true" style={copiedCircleStyle}>
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      d="M5.5 12.5l4.1 4.1 8.9-9.2"
      fill="none"
      stroke="#fff"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
</span>

{!iconOnly ? <span>{copied ? resolvedCopiedLabel : resolvedLabel}</span> : null}
      </button>

      <VibraToast toast={copyToast} />
    </>
  );
}