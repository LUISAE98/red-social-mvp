"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import {
  VibraNavigationIcon,
  VibraNavigationIconsStyles,
} from "@/app/components/VibraServiceIcons/VibraNavigationIcons";

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
  label = "Copiar link",
  copiedLabel = "Link copiado correctamente",
  title = "Copiar enlace",
  disabled = false,
  className,
  style,
  iconOnly = true,
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const absoluteUrl = useMemo(() => getAbsoluteUrl(href), [href]);

  useEffect(() => {
    if (!copied && !error) return;

    const timeout = window.setTimeout(() => {
      setCopied(false);
      setError(null);
    }, 2400);

    return () => window.clearTimeout(timeout);
  }, [copied, error]);

  async function handleCopy(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();

    if (disabled) return;

    setError(null);

    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
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
      } catch {
        setError("No se pudo copiar el link.");
      }
    }
  }

const buttonStyle: CSSProperties = {
  width: copied ? 30 : iconOnly ? 24 : "auto",
  height: copied ? 30 : 24,
  minWidth: copied ? 30 : iconOnly ? 24 : "auto",
  minHeight: copied ? 30 : 24,
  borderRadius: copied ? 999 : 0,
  border: "none",
  background: copied ? "rgba(34,197,94,0.95)" : "transparent",
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
  opacity: disabled ? 0.55 : 1,
  boxShadow: copied ? "0 10px 24px rgba(34,197,94,0.28)" : "none",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
  userSelect: "none",
  transform: copied ? "scale(1)" : "scale(1)",
  transition:
    "width 220ms cubic-bezier(0.22, 1, 0.36, 1), height 220ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 220ms cubic-bezier(0.22, 1, 0.36, 1), background 180ms ease, box-shadow 180ms ease, transform 180ms ease, opacity 160ms ease",
  ...style,
};

  const toastStyle: CSSProperties = {
    position: "fixed",
    left: "50%",
    bottom: "calc(24px + env(safe-area-inset-bottom))",
    transform: "translateX(-50%)",
    zIndex: 11000,
    maxWidth: "min(520px, calc(100vw - 28px))",
    padding: "10px 12px",
    borderRadius: 999,
    border: error
      ? "1px solid rgba(255,90,90,0.30)"
      : "1px solid rgba(255,255,255,0.16)",
    background: error ? "rgba(80,12,12,0.94)" : "rgba(12,12,12,0.94)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.25,
    textAlign: "center",
    boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
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
        title={title}
        aria-label={title}
        style={buttonStyle}
      >
<span
  aria-hidden="true"
  style={{
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transform: copied ? "scale(1)" : "scale(1)",
    transition:
      "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease",
  }}
>
  {copied ? (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        d="M5.5 12.5l4.1 4.1 8.9-9.2"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <VibraNavigationIcon type="copyLink" size={21} />
  )}
</span>

{!iconOnly ? <span>{copied ? "Copiado" : label}</span> : null}
      </button>

      {error && (
        <div role="status" aria-live="polite" style={toastStyle}>
          {error}
        </div>
      )}
    </>
  );
}