"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { CommentMention } from "@/lib/posts/types";
import {
  buildMentionToken,
  suggestionToMention,
  type MentionSuggestion,
} from "./types";
import { useMentionSuggestions } from "./useMentionSuggestions";

type MentionTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "style"
> & {
  value: string;
  onChange: (value: string) => void;
  mentions: CommentMention[];
  onMentionsChange: (mentions: CommentMention[]) => void;
  currentUserId?: string | null;
  /** Cuando true (post de comunidad oculta), escribir "@" NO abre el popover. */
  mentionsDisabled?: boolean;
  maxRows?: number;
  style?: CSSProperties;
  /**
   * Qué hacer con Enter. Si se pasa, Enter envía y Mayús+Enter salta de línea,
   * igual que en el DM y en el chat del live. Sin ella, Enter salta de línea y
   * ya, que es lo que necesita un campo de edición con sus propios botones.
   */
  onSubmit?: () => void;
};

type Trigger = { start: number; query: string };

const WHITESPACE = /\s/;
const MAX_QUERY_LENGTH = 40;
const FETCH_DEBOUNCE_MS = 140;

/** Busca hacia atrás desde el caret un "@" válido (inicio o precedido de espacio). */
function findTrigger(text: string, caret: number): Trigger | null {
  const chars: string[] = [];
  let i = caret - 1;

  while (i >= 0) {
    const ch = text[i];
    if (ch === "@") {
      const prev = i > 0 ? text[i - 1] : "";
      if (i === 0 || WHITESPACE.test(prev)) {
        return { start: i, query: chars.join("") };
      }
      return null;
    }
    if (WHITESPACE.test(ch)) return null;
    chars.unshift(ch);
    if (chars.length > MAX_QUERY_LENGTH) return null;
    i -= 1;
  }

  return null;
}

function dedupeAndPrune(mentions: CommentMention[], text: string): CommentMention[] {
  const seen = new Set<string>();
  const result: CommentMention[] = [];
  for (const m of mentions) {
    const key = `${m.type}:${m.id}`;
    if (seen.has(key)) continue;
    if (!text.includes(m.token)) continue;
    seen.add(key);
    result.push(m);
  }
  return result;
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

export default function MentionTextarea({
  value,
  onChange,
  mentions,
  onMentionsChange,
  currentUserId,
  mentionsDisabled = false,
  maxRows = 3,
  style,
  disabled,
  onSubmit,
  ...props
}: MentionTextareaProps) {
  const tPosts = useTranslations("posts");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { getSuggestions } = useMentionSuggestions({
    currentUserId,
    enabled: !mentionsDisabled && !disabled,
  });

  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);

  const fetchTokenRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Último query buscado: evita re-fetch al mover el caret sin cambiar el query
  // (si no, el debounce resetearía activeIndex y rompería la navegación ↑/↓).
  const lastQueryRef = useRef<string | null>(null);

  // ── Autogrow ──────────────────────────────────────────────────────────────
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const computed = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(computed.lineHeight || "20") || 20;
    const paddingTop = Number.parseFloat(computed.paddingTop || "0") || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom || "0") || 0;
    const borderTop = Number.parseFloat(computed.borderTopWidth || "0") || 0;
    const borderBottom = Number.parseFloat(computed.borderBottomWidth || "0") || 0;
    const maxHeight =
      lineHeight * maxRows + paddingTop + paddingBottom + borderTop + borderBottom;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxRows]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const closePopover = useCallback(() => {
    setOpen(false);
    setTrigger(null);
    setSuggestions([]);
    setActiveIndex(0);
    lastQueryRef.current = null;
    fetchTokenRef.current += 1;
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const runFetch = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const token = ++fetchTokenRef.current;
      debounceRef.current = setTimeout(async () => {
        const results = await getSuggestions(query);
        if (token !== fetchTokenRef.current) return; // resultado obsoleto
        setSuggestions(results);
        setActiveIndex(0);
        setOpen(results.length > 0);
      }, FETCH_DEBOUNCE_MS);
    },
    [getSuggestions]
  );

  const syncTrigger = useCallback(
    (text: string) => {
      if (mentionsDisabled || disabled) {
        closePopover();
        return;
      }
      const el = textareaRef.current;
      const caret = el ? el.selectionStart ?? text.length : text.length;
      const next = findTrigger(text, caret);
      if (!next) {
        closePopover();
        return;
      }
      setTrigger(next);
      // Solo re-buscar cuando el query cambió; mover el caret dentro del mismo
      // token preserva las sugerencias y el índice activo (navegación ↑/↓).
      if (next.query === lastQueryRef.current) return;
      lastQueryRef.current = next.query;
      runFetch(next.query);
    },
    [mentionsDisabled, disabled, closePopover, runFetch]
  );

  const handleChange = useCallback(
    (nextValue: string) => {
      onChange(nextValue);
      const prunedMentions = dedupeAndPrune(mentions, nextValue);
      if (prunedMentions.length !== mentions.length) {
        onMentionsChange(prunedMentions);
      }
      syncTrigger(nextValue);
    },
    [onChange, mentions, onMentionsChange, syncTrigger]
  );

  const selectSuggestion = useCallback(
    (suggestion: MentionSuggestion) => {
      if (!trigger) return;
      const tokenText = buildMentionToken(suggestion);
      const end = trigger.start + 1 + trigger.query.length;
      const before = value.slice(0, trigger.start);
      const after = value.slice(end);
      const insert = `${tokenText} `;
      const nextValue = before + insert + after;

      onChange(nextValue);
      const nextMentions = dedupeAndPrune(
        [...mentions, suggestionToMention(suggestion)],
        nextValue
      );
      onMentionsChange(nextMentions);
      closePopover();

      const caret = before.length + insert.length;
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(caret, caret);
        resize();
      });
    },
    [trigger, value, onChange, mentions, onMentionsChange, closePopover, resize]
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      // Con la lista de menciones abierta, Enter elige la mención: eso manda, y
      // se resuelve más abajo. Sin lista abierta, Enter envía.
      if (!open || suggestions.length === 0) {
        if (
          onSubmit
          && e.key === "Enter"
          && !e.shiftKey
          // ⚠️ Mientras se compone con un IME —japonés, coreano, chino— Enter
          // CONFIRMA la palabra que se está escribiendo. Sin esta guarda, esos
          // idiomas no podrían ni terminar de escribir: el primer Enter enviaría
          // el comentario a medias.
          && !(e.nativeEvent as unknown as { isComposing?: boolean }).isComposing
        ) {
          e.preventDefault();
          onSubmit();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const chosen = suggestions[activeIndex];
        if (chosen) selectSuggestion(chosen);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePopover();
      }
    },
    [open, suggestions, activeIndex, selectSuggestion, closePopover, onSubmit]
  );

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {open && suggestions.length > 0 && (
        <div style={popoverStyle} role="listbox" aria-label={tPosts("mentionSuggestionsLabel")}>
          {suggestions.map((suggestion, i) => {
            const isActive = i === activeIndex;
            const secondary =
              suggestion.type === "profile" && suggestion.handle
                ? `@${suggestion.handle}`
                : tPosts("mentionCommunityBadge");
            return (
              <button
                key={`${suggestion.type}:${suggestion.id}`}
                type="button"
                role="option"
                aria-selected={isActive}
                // preventDefault mantiene el foco en el textarea al hacer click.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => selectSuggestion(suggestion)}
                style={{
                  ...rowStyle,
                  background: isActive ? "rgba(168,85,247,0.16)" : "transparent",
                }}
              >
                <span style={avatarWrapStyle}>
                  {suggestion.avatarUrl ? (
                    <Image
                      src={suggestion.avatarUrl}
                      alt=""
                      width={28}
                      height={28}
                      style={{ objectFit: "cover", borderRadius: suggestion.type === "group" ? 7 : "50%" }}
                    />
                  ) : (
                    <span style={avatarFallbackStyle}>{initials(suggestion.label)}</span>
                  )}
                </span>
                <span style={{ display: "grid", gap: 1, minWidth: 0, textAlign: "start" }}>
                  <span style={labelStyle}>{suggestion.label}</span>
                  <span style={secondaryStyle}>
                    {secondary}
                    {suggestion.following ? ` · ${tPosts("mentionFollowingBadge")}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <textarea
        {...props}
        ref={textareaRef}
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onKeyUp={() => syncTrigger(value)}
        onClick={() => syncTrigger(value)}
        onBlur={() => {
          // Cierra con un pequeño delay para permitir el click en una sugerencia.
          window.setTimeout(() => closePopover(), 120);
        }}
        rows={1}
        style={{
          resize: "none",
          width: "100%",
          boxSizing: "border-box",
          ...style,
        }}
      />
    </div>
  );
}

const popoverStyle: CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 6px)",
  insetInlineStart: 0,
  insetInlineEnd: 0,
  maxHeight: 236,
  overflowY: "auto",
  background: "rgba(20,20,26,0.98)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
  padding: 4,
  display: "grid",
  gap: 2,
  zIndex: 60,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  border: "none",
  borderRadius: 9,
  padding: "6px 8px",
  cursor: "pointer",
  color: "#fff",
  background: "transparent",
};

const avatarWrapStyle: CSSProperties = {
  flexShrink: 0,
  width: 28,
  height: 28,
  borderRadius: "50%",
  overflow: "hidden",
  display: "grid",
  placeItems: "center",
  background: "rgba(255,255,255,0.08)",
};

const avatarFallbackStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "rgba(255,255,255,0.72)",
};

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const secondaryStyle: CSSProperties = {
  fontSize: 11,
  color: "rgba(255,255,255,0.5)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
