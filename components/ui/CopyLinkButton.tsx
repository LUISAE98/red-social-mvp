"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";

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
    minWidth: iconOnly ? 34 : "auto",
    minHeight: 34,
    borderRadius: 999,
border: copied
  ? "1px solid rgba(34,197,94,0.55)"
  : "1px solid rgba(255,255,255,0.16)",
background: copied ? "rgba(34,197,94,0.95)" : "rgba(12,12,12,0.82)",
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: iconOnly ? "0 9px" : "8px 11px",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    boxShadow: "0 10px 28px rgba(0,0,0,0.32)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    userSelect: "none",
    transition:
      "transform 160ms ease, opacity 160ms ease, background 160ms ease",
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
      <button
        type="button"
        className={className}
        onClick={handleCopy}
        disabled={disabled}
        title={title}
        aria-label={title}
        style={buttonStyle}
      >
<span aria-hidden="true">{copied ? "✅" : "🔗"}</span>
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