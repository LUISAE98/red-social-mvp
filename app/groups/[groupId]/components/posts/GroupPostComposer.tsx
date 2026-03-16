"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type TextareaHTMLAttributes,
} from "react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type GroupPostComposerProps = {
  onSubmit: (text: string) => Promise<void>;
};

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function AutoGrowTextarea({
  value,
  maxRows = 3,
  style,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "style"> & {
  maxRows?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    el.style.height = "0px";

    const computed = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(computed.lineHeight || "20") || 20;
    const borderTop = Number.parseFloat(computed.borderTopWidth || "0") || 0;
    const borderBottom = Number.parseFloat(computed.borderBottomWidth || "0") || 0;
    const paddingTop = Number.parseFloat(computed.paddingTop || "0") || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom || "0") || 0;

    const maxHeight =
      lineHeight * maxRows + paddingTop + paddingBottom + borderTop + borderBottom;

    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxRows]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  return (
    <textarea
      {...props}
      ref={ref}
      value={value}
      rows={1}
      onInput={(event) => {
        resize();
        props.onInput?.(event);
      }}
      style={style}
    />
  );
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
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)",
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
        border: "1px solid rgba(255,255,255,0.08)",
        color: "#fff",
        fontSize: Math.max(11, Math.floor(size * 0.32)),
        fontWeight: 500,
        letterSpacing: "-0.02em",
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}

export default function GroupPostComposer({
  onSubmit,
}: GroupPostComposerProps) {
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [currentUserHandle, setCurrentUserHandle] = useState<string | null>(null);

  const currentUser = auth.currentUser;
  const currentUserName = currentUser?.displayName?.trim() || "Tú";
  const currentUserAvatar = currentUser?.photoURL || null;

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentUserHandle() {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setCurrentUserHandle(null);
        return;
      }

      try {
        const userRef = doc(db, "users", uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          if (!cancelled) setCurrentUserHandle(null);
          return;
        }

        const data = snap.data();
        const handle =
          typeof data.handle === "string" && data.handle.trim().length > 0
            ? data.handle.trim()
            : null;

        if (!cancelled) {
          setCurrentUserHandle(handle);
        }
      } catch {
        if (!cancelled) {
          setCurrentUserHandle(null);
        }
      }
    }

    loadCurrentUserHandle();

    return () => {
      cancelled = true;
    };
  }, []);

  const currentUserHref = currentUserHandle ? `/u/${currentUserHandle}` : "#";

  async function handleSubmit() {
    if (creating || text.trim().length === 0) return;

    try {
      setCreating(true);
      await onSubmit(text.trim());
      setText("");
    } finally {
      setCreating(false);
    }
  }

  const cardStyle: CSSProperties = {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.022)",
    color: "#fff",
    padding: 12,
    boxSizing: "border-box",
    backdropFilter: "blur(10px)",
  };

  const labelStyle: CSSProperties = {
    fontSize: 10.5,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.2,
    letterSpacing: "-0.01em",
  };

  const nameStyle: CSSProperties = {
    fontSize: 12.5,
    fontWeight: 500,
    color: "#fff",
    lineHeight: 1.15,
    letterSpacing: "-0.02em",
    textDecoration: "none",
  };

  const textareaStyle: CSSProperties = {
    width: "100%",
    minHeight: 42,
    maxHeight: 96,
    padding: "10px 0 0 0",
    border: "none",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    background: "transparent",
    color: "#fff",
    outline: "none",
    resize: "none",
    overflowY: "hidden",
    fontSize: 13,
    fontWeight: 300,
    lineHeight: "21px",
    fontFamily: fontStack,
    boxSizing: "border-box",
    WebkitAppearance: "none",
  };

  const primaryButtonStyle: CSSProperties = {
    minHeight: 34,
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#fff",
    color: "#000",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const disabledButtonStyle: CSSProperties = {
    ...primaryButtonStyle,
    background: "rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.50)",
    cursor: "not-allowed",
  };

  return (
    <section style={cardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <Link
          href={currentUserHref}
          style={{
            display: "inline-flex",
            flexShrink: 0,
          }}
        >
          <Avatar
            name={currentUserName}
            avatarUrl={currentUserAvatar}
            size={36}
          />
        </Link>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "grid", gap: 2 }}>
            <Link href={currentUserHref} style={nameStyle}>
              {currentUserName}
            </Link>
            <div style={labelStyle}>Crear publicación</div>
          </div>

          <AutoGrowTextarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe algo..."
            maxRows={3}
            style={textareaStyle}
          />

          <div
            style={{
              marginTop: 10,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              onClick={handleSubmit}
              disabled={creating || text.trim().length === 0}
              style={
                creating || text.trim().length === 0
                  ? disabledButtonStyle
                  : primaryButtonStyle
              }
            >
              {creating ? "Publicando..." : "Publicar"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
