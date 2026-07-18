import Link from "next/link";
import type { ReactNode } from "react";
import type { CommentMention } from "@/lib/posts/types";

const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const LINK_COLOR = "#a855f7";

type MentionRange = {
  start: number;
  end: number;
  mention: CommentMention;
};

function mentionHref(mention: CommentMention): string {
  if (mention.type === "group") return `/groups/${mention.id}`;
  const handle = mention.handle?.trim();
  return handle ? `/u/${handle}` : `/u/${mention.id}`;
}

/** Ubica la primera aparición no solapada de cada token de mención en el texto. */
function locateMentions(text: string, mentions: CommentMention[]): MentionRange[] {
  const ranges: MentionRange[] = [];

  for (const mention of mentions) {
    if (!mention.token) continue;

    let from = 0;
    while (from <= text.length) {
      const idx = text.indexOf(mention.token, from);
      if (idx === -1) break;

      const end = idx + mention.token.length;
      const overlaps = ranges.some((r) => idx < r.end && end > r.start);
      if (!overlaps) {
        ranges.push({ start: idx, end, mention });
        break;
      }
      from = idx + 1;
    }
  }

  return ranges.sort((a, b) => a.start - b.start);
}

/** Divide texto plano detectando URLs y las convierte en enlaces. */
function renderPlainWithLinks(text: string, keyPrefix: string): ReactNode[] {
  if (!text) return [];
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (!part) return null;
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={`${keyPrefix}-url-${i}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: LINK_COLOR, textDecoration: "none" }}
        >
          {part}
        </a>
      );
    }
    return <span key={`${keyPrefix}-txt-${i}`}>{part}</span>;
  });
}

/**
 * Renderiza el texto de un comentario/respuesta resaltando menciones (@perfil /
 * @comunidad) como enlaces y detectando URLs en el resto. Tolerante a edición:
 * si un token de mención ya no aparece en el texto, degrada a texto plano.
 */
export function renderCommentText(
  text: string,
  mentions?: CommentMention[] | null
): ReactNode {
  if (!mentions || mentions.length === 0) {
    return renderPlainWithLinks(text, "root");
  }

  const ranges = locateMentions(text, mentions);
  if (ranges.length === 0) {
    return renderPlainWithLinks(text, "root");
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, i) => {
    if (range.start > cursor) {
      nodes.push(...renderPlainWithLinks(text.slice(cursor, range.start), `seg-${i}`));
    }

    nodes.push(
      <Link
        key={`mention-${i}`}
        href={mentionHref(range.mention)}
        onClick={(e) => e.stopPropagation()}
        style={{ color: LINK_COLOR, fontWeight: 500, textDecoration: "none" }}
      >
        {range.mention.token}
      </Link>
    );

    cursor = range.end;
  });

  if (cursor < text.length) {
    nodes.push(...renderPlainWithLinks(text.slice(cursor), "tail"));
  }

  return nodes;
}
