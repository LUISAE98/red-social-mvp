"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Post } from "@/lib/posts/types";

type ImageMedia = {
  url: string;
  altText?: string | null;
};

type PostImageViewerProps = {
  open: boolean;
  isMobile: boolean;
  image: ImageMedia | null;
  post: Post;
  author: {
    authorName: string;
    avatarUrl?: string | null;
    profileHref: string;
  };
  group?: {
    name: string;
    avatarUrl?: string | null;
    href?: string | null;
  } | null;
  authorStatusBadge?: {
    text: string;
    border: string;
    background: string;
    color: string;
  } | null;
  relativeDate: string;
  exactDate: string;
  likesCount: number;
  commentsCount: number;
  viewerHasFlamed?: boolean;
  flameBusy?: boolean;
  commentsContent?: ReactNode;
  onClose: () => void;
  onToggleFlame: () => void;
  onOpenComments: () => void;
  onOpenFlames?: () => void;
};

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function Avatar({
  name,
  avatarUrl,
  size = 36,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          display: "block",
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.10)",
        color: "#fff",
        fontSize: Math.max(11, Math.floor(size * 0.32)),
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}

export default function PostImageViewer({
  open,
  isMobile,
  image,
  post,
  author,
  group = null,
  authorStatusBadge = null,
  relativeDate,
  exactDate,
  likesCount,
  commentsCount,
  viewerHasFlamed = false,
  flameBusy = false,
  commentsContent = null,
  onClose,
  onToggleFlame,
  onOpenComments,
  onOpenFlames,
}: PostImageViewerProps) {
const [mobileCommentsOpen, setMobileCommentsOpen] = useState(false);
const [mounted, setMounted] = useState(false);
const [showExactDate, setShowExactDate] = useState(false);
const [mobileScale, setMobileScale] = useState(1);
const [mobileTranslateY, setMobileTranslateY] = useState(0);

const mobileGestureRef = useRef({
  startY: 0,
  startDistance: 0,
  startScale: 1,
  isPinching: false,
});

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
if (!open) {
  setMobileCommentsOpen(false);
  setMobileScale(1);
  setMobileTranslateY(0);
  return;
}

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!mounted || !open || !image) return null;

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2147483647,
    background: isMobile ? "#000" : "rgba(0,0,0,0.82)",
    color: "#fff",
    fontFamily: fontStack,
    display: isMobile ? "block" : "grid",
    placeItems: isMobile ? undefined : "center",
    padding: isMobile ? 0 : "22px 0 22px 22px",
    boxSizing: "border-box",
  };

const closeButtonStyle: CSSProperties = {
  position: "absolute",
  top: isMobile ? "calc(10px + env(safe-area-inset-top))" : 14,
  left: isMobile ? "calc(10px + env(safe-area-inset-left))" : 14,
  zIndex: 5,
  width: 38,
  height: 38,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(0,0,0,0.58)",
  color: "#fff",
  fontSize: 22,
  lineHeight: 1,
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  WebkitTapHighlightColor: "transparent",
};

  const imageStyle: CSSProperties = {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    background: "#000",
  };

  const actionButtonStyle: CSSProperties = {
    border: "none",
    background: "transparent",
    padding: 0,
    color: "rgba(255,255,255,0.88)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 700,
    fontFamily: fontStack,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  };

  const actionRowStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 14,
};

const actionGroupStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
};

  const mobileContent = (
    <div style={overlayStyle}>
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar imagen"
        style={closeButtonStyle}
      >
        ×
      </button>

      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          touchAction: "none",
          WebkitOverflowScrolling: "touch",
        }}
        onTouchStart={(event) => {
          if (event.touches.length === 1) {
            mobileGestureRef.current.startY = event.touches[0].clientY;
            mobileGestureRef.current.isPinching = false;
          }

          if (event.touches.length === 2) {
            const firstTouch = event.touches[0];
            const secondTouch = event.touches[1];

            const distance = Math.hypot(
              firstTouch.clientX - secondTouch.clientX,
              firstTouch.clientY - secondTouch.clientY
            );

            mobileGestureRef.current.startDistance = distance;
            mobileGestureRef.current.startScale = mobileScale;
            mobileGestureRef.current.isPinching = true;
          }
        }}
        onTouchMove={(event) => {
          if (event.touches.length === 2) {
            event.preventDefault();

            const firstTouch = event.touches[0];
            const secondTouch = event.touches[1];

            const distance = Math.hypot(
              firstTouch.clientX - secondTouch.clientX,
              firstTouch.clientY - secondTouch.clientY
            );

            const nextScale =
              mobileGestureRef.current.startScale *
              (distance / Math.max(mobileGestureRef.current.startDistance, 1));

            setMobileScale(Math.min(4, Math.max(1, nextScale)));
            return;
          }

          if (
            event.touches.length === 1 &&
            !mobileGestureRef.current.isPinching &&
            mobileScale === 1
          ) {
            const nextTranslateY =
              event.touches[0].clientY - mobileGestureRef.current.startY;

            if (nextTranslateY > 0) {
              setMobileTranslateY(nextTranslateY);
            }
          }
        }}
        onTouchEnd={() => {
          if (mobileTranslateY > 120 && mobileScale === 1) {
            onClose();
            return;
          }

          setMobileTranslateY(0);
        }}
      >
        <img
          src={image.url}
          alt={image.altText || "Imagen de la publicación"}
          draggable={false}
          style={{
            ...imageStyle,
            minHeight: "100dvh",
            transform: `translateY(${mobileTranslateY}px) scale(${mobileScale})`,
            transition: mobileTranslateY === 0 ? "transform 160ms ease" : "none",
          }}
        />
      </div>

<div
  style={{
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2147483646,
    padding: "14px 16px calc(14px + env(safe-area-inset-bottom))",
    background:
      "linear-gradient(to top, rgba(0,0,0,0.86), rgba(0,0,0,0.42), transparent)",
    display: "grid",
    gap: 7,
    justifyItems: "start",
  }}
>
  <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        maxWidth: "calc(100vw - 32px)",
        overflow: "hidden",
      }}
    >
      <Link
        href={author.profileHref}
        style={{
          color: "#fff",
          textDecoration: "none",
          fontSize: 12.5,
          fontWeight: 700,
          lineHeight: 1.1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {author.authorName}
      </Link>

      {group && (
        <>
          <span
            aria-hidden="true"
            style={{
              color: "rgba(255,255,255,0.34)",
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            •
          </span>

          {group.href ? (
            <Link
              href={group.href}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                minWidth: 0,
                color: "rgba(255,255,255,0.68)",
                textDecoration: "none",
                fontSize: 11,
                fontWeight: 600,
                overflow: "hidden",
              }}
            >
              <Avatar name={group.name} avatarUrl={group.avatarUrl} size={15} />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {group.name}
              </span>
            </Link>
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                minWidth: 0,
                color: "rgba(255,255,255,0.68)",
                fontSize: 11,
                fontWeight: 600,
                overflow: "hidden",
              }}
            >
              <Avatar name={group.name} avatarUrl={group.avatarUrl} size={15} />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {group.name}
              </span>
            </span>
          )}
        </>
      )}
    </div>

    <button
      type="button"
      onClick={() => setShowExactDate((prev) => !prev)}
      title={exactDate}
      aria-label={
        showExactDate
          ? "Mostrar fecha relativa de la publicación"
          : "Mostrar fecha exacta de la publicación"
      }
      style={{
        width: "fit-content",
        color: "rgba(255,255,255,0.58)",
        fontSize: 10.5,
        lineHeight: 1.1,
        border: "none",
        background: "transparent",
        padding: 0,
        fontFamily: fontStack,
        cursor: "pointer",
        textAlign: "left",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {showExactDate ? exactDate : relativeDate}
    </button>
  </div>

  <div
    style={{
      display: "inline-flex",
      justifyContent: "flex-start",
      alignItems: "center",
      gap: 14,
    }}
  >
<div style={actionGroupStyle}>
  <button
    type="button"
    onClick={onToggleFlame}
    disabled={flameBusy}
    aria-pressed={viewerHasFlamed}
    aria-label={
      viewerHasFlamed
        ? "Quitar flamita de la publicación"
        : "Dar flamita a la publicación"
    }
    style={{
      ...actionButtonStyle,
      opacity: flameBusy ? 0.62 : 1,
      cursor: flameBusy ? "not-allowed" : "pointer",
    }}
  >
    <span
      aria-hidden="true"
      style={{
        fontSize: 21,
        lineHeight: 1,
        filter: viewerHasFlamed ? "none" : "grayscale(1)",
        opacity: viewerHasFlamed ? 1 : 0.6,
      }}
    >
      🔥
    </span>
  </button>

  <button
    type="button"
    onClick={onOpenFlames}
    disabled={!onOpenFlames || likesCount === 0}
    aria-label="Ver usuarios que dieron flamita"
    style={{
      ...actionButtonStyle,
      opacity: !onOpenFlames || likesCount === 0 ? 0.55 : 1,
      cursor: !onOpenFlames || likesCount === 0 ? "default" : "pointer",
    }}
  >
    {likesCount}
  </button>
</div>

        <button
          type="button"
          onClick={() => {
            onOpenComments();
            setMobileCommentsOpen(true);
          }}
          aria-label="Abrir comentarios"
          style={actionButtonStyle}
        >
          <span aria-hidden="true" style={{ fontSize: 21, lineHeight: 1 }}>
            💬
          </span>
          <span>{commentsCount}</span>
        </button>
      </div>

    </div>

      {mobileCommentsOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2147483647,
            background: "rgba(0,0,0,0.54)",
            display: "flex",
            alignItems: "flex-end",
          }}
          onClick={() => setMobileCommentsOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxHeight: "72dvh",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              background: "rgba(12,12,12,0.98)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderBottom: "none",
              padding: "10px 12px calc(12px + env(safe-area-inset-bottom))",
              overflowY: "auto",
              boxSizing: "border-box",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {commentsContent}
          </div>
        </div>
      )}
    </div>
  );

  const desktopContent = (
    <div style={overlayStyle} onClick={onClose}>

      <div
        style={{
          width: "min(960px, calc(100vw - 96px))",
          height: "min(620px, calc(100dvh - 96px))",
          display: "grid",
          gridTemplateColumns: "minmax(0, 620px) 340px",
          borderRadius: 16,
          overflow: "hidden",
          background: "#000",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.58)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
<div
  style={{
    position: "relative",
    minWidth: 0,
    minHeight: 0,
    width: "100%",
    height: "100%",
    background: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  }}
>
  <button
    type="button"
    onClick={onClose}
    aria-label="Cerrar imagen"
    style={closeButtonStyle}
  >
    ×
  </button>
  <img
    src={image.url}
    alt={image.altText || "Imagen de la publicación"}
    style={{
      display: "block",
      maxWidth: "100%",
      maxHeight: "100%",
      width: "auto",
      height: "auto",
      objectFit: "contain",
      background: "#000",
    }}
  />
</div>

        <aside
          style={{
            minHeight: 0,
            borderLeft: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(22,22,22,0.98)",
            display: "grid",
            gridTemplateRows: "auto auto 1fr",
            minWidth: 0,
          }}
        >
          <div
            style={{
              padding: "16px 16px 13px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              minWidth: 0,
            }}
          >
            <Link href={author.profileHref} style={{ flexShrink: 0 }}>
              <Avatar
                name={author.authorName}
                avatarUrl={author.avatarUrl}
                size={38}
              />
            </Link>

<div style={{ minWidth: 0, flex: 1 }}>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      minWidth: 0,
      overflow: "hidden",
    }}
  >
    <Link
      href={author.profileHref}
      style={{
        color: "#fff",
        textDecoration: "none",
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1.2,
        display: "block",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {author.authorName}
    </Link>

    {group && (
      <>
        <span
          aria-hidden="true"
          style={{
            color: "rgba(255,255,255,0.32)",
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          •
        </span>

        {group.href ? (
          <Link
            href={group.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              minWidth: 0,
              color: "rgba(255,255,255,0.62)",
              textDecoration: "none",
              fontSize: 11,
              fontWeight: 600,
              overflow: "hidden",
            }}
          >
            <Avatar
              name={group.name}
              avatarUrl={group.avatarUrl}
              size={16}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {group.name}
            </span>
          </Link>
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              minWidth: 0,
              color: "rgba(255,255,255,0.62)",
              fontSize: 11,
              fontWeight: 600,
              overflow: "hidden",
            }}
          >
            <Avatar
              name={group.name}
              avatarUrl={group.avatarUrl}
              size={16}
            />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {group.name}
            </span>
          </span>
        )}
      </>
    )}
  </div>

  <button
  type="button"
  onClick={() => setShowExactDate((prev) => !prev)}
  title={exactDate}
  aria-label={
    showExactDate
      ? "Mostrar fecha relativa de la publicación"
      : "Mostrar fecha exacta de la publicación"
  }
  style={{
    display: "block",
    width: "fit-content",
    marginTop: 0,
    color: "rgba(255,255,255,0.52)",
    fontSize: 11,
    lineHeight: "11px",
    border: "none",
    background: "transparent",
    padding: 0,
    fontFamily: fontStack,
    cursor: "pointer",
    textAlign: "left",
    WebkitTapHighlightColor: "transparent",
  }}
>
  {showExactDate ? exactDate : relativeDate}
</button>
</div>
          </div>

<div
  style={{
    padding: 16,
    borderBottom: "none",
    display: "grid",
    gap: 14,
  }}
>
{(authorStatusBadge || post.text) && (
  <div
    style={{
      color: "rgba(255,255,255,0.9)",
      fontSize: 13,
      fontWeight: 300,
      lineHeight: 1.6,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    }}
  >
    {authorStatusBadge && (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 18,
          padding: "2px 7px",
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 650,
          lineHeight: 1,
          letterSpacing: "-0.01em",
          whiteSpace: "nowrap",
          border: authorStatusBadge.border,
          background: authorStatusBadge.background,
          color: authorStatusBadge.color,
          marginRight: post.text ? 8 : 0,
          verticalAlign: "middle",
        }}
      >
        {authorStatusBadge.text}
      </span>
    )}

    {post.text}
  </div>
)}

  <div style={actionRowStyle}>
    <div style={actionGroupStyle}>
      <button
        type="button"
        onClick={onToggleFlame}
        disabled={flameBusy}
        aria-pressed={viewerHasFlamed}
        aria-label={
          viewerHasFlamed
            ? "Quitar flamita de la publicación"
            : "Dar flamita a la publicación"
        }
        style={{
          ...actionButtonStyle,
          opacity: flameBusy ? 0.62 : 1,
          cursor: flameBusy ? "not-allowed" : "pointer",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            fontSize: 19,
            lineHeight: 1,
            filter: viewerHasFlamed ? "none" : "grayscale(1)",
            opacity: viewerHasFlamed ? 1 : 0.6,
          }}
        >
          🔥
        </span>
      </button>

      <button
        type="button"
        onClick={onOpenFlames}
        disabled={!onOpenFlames || likesCount === 0}
        aria-label="Ver usuarios que dieron flamita"
        style={{
          ...actionButtonStyle,
          opacity: !onOpenFlames || likesCount === 0 ? 0.55 : 1,
          cursor: !onOpenFlames || likesCount === 0 ? "default" : "pointer",
        }}
      >
        {likesCount}
      </button>
    </div>

    <button
      type="button"
      onClick={onOpenComments}
      aria-label="Abrir comentarios"
      style={actionButtonStyle}
    >
      <span aria-hidden="true" style={{ fontSize: 19, lineHeight: 1 }}>
        💬
      </span>
      <span>{commentsCount}</span>
    </button>
  </div>
</div>

          <div
            style={{
              minHeight: 0,
              overflowY: "auto",
              padding: 16,
            }}
          >
            {commentsContent}
          </div>
        </aside>
      </div>
    </div>
  );

  return createPortal(isMobile ? mobileContent : desktopContent, document.body);
}