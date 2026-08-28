// GroupPostCard.utils.ts
// Funciones puras y tipos auxiliares extraídos de GroupPostCard.tsx.
// No dependen de estado del componente; se pueden testear y reutilizar de forma aislada.

export const fontStack = 'inherit';

export type InteractionBlockedReason = "login" | "join" | "restricted" | null;

export type ModerationAction =
  | "edit_post"
  | "mute"
  | "unmute"
  | "ban"
  | "unban"
  | "remove"
  | "pin_group_post"
  | "unpin_group_post"
  | "pin_profile_post"
  | "unpin_profile_post"
  | "block_user"
  | "unblock_user"
  | "block_in_group"
  | "unblock_in_group"
  | "hide_post"
  | "delete_post";

export function getDateFromTimestamp(value?: { toDate?: () => Date } | null) {
  if (!value?.toDate) return null;

  try {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

export function formatExactDate(value?: { toDate?: () => Date } | null, locale = "es") {
  const date = getDateFromTimestamp(value);
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return "";
  }
}

export function formatRelativeDate(value?: { toDate?: () => Date } | null, locale = "es") {
  const date = getDateFromTimestamp(value);
  if (!date) return "";

  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" });

  const capitalize = (text: string) =>
    text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;

  let relative: string;
  if (diffSeconds < 30)
    relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "second");
  else if (diffSeconds < 60) relative = rtf.format(-diffSeconds, "second");
  else if (diffMinutes < 60) relative = rtf.format(-diffMinutes, "minute");
  else if (diffHours < 24) relative = rtf.format(-diffHours, "hour");
  else if (diffDays < 7) relative = rtf.format(-diffDays, "day");
  else if (diffWeeks < 5) relative = rtf.format(-diffWeeks, "week");
  else if (diffMonths < 12) relative = rtf.format(-diffMonths, "month");
  else relative = rtf.format(-diffYears, "year");

  return capitalize(relative);
}

export function formatScheduledLiveDate(
  value?: { toDate?: () => Date } | null,
  options: {
    locale?: string;
    todayAt?: (time: string) => string;
    tomorrowAt?: (time: string) => string;
    tbd?: string;
    dateAt?: (date: string, time: string) => string;
  } = {}
): string {
  const { locale = "es", todayAt, tomorrowAt, tbd, dateAt } = options;
  const date = getDateFromTimestamp(value);
  if (!date) return tbd ?? "Fecha por confirmar";

  try {
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    const timePart = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);

    if (isToday) return todayAt ? todayAt(timePart) : `Hoy a las ${timePart}`;

    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow =
      date.getFullYear() === tomorrow.getFullYear() &&
      date.getMonth() === tomorrow.getMonth() &&
      date.getDate() === tomorrow.getDate();

    if (isTomorrow) return tomorrowAt ? tomorrowAt(timePart) : `Mañana a las ${timePart}`;

    const datePart = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(date);

    const capitalizedDate = `${datePart.charAt(0).toUpperCase()}${datePart.slice(1)}`;
    return dateAt ? dateAt(capitalizedDate, timePart) : `${capitalizedDate} a las ${timePart}`;
  } catch {
    return tbd ?? "Fecha por confirmar";
  }
}

export function formatMediaDuration(seconds?: number | null): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function getAuthorInfo(
  entity: { authorId?: string | null } & Record<string, unknown>
) {
  const authorId = typeof entity.authorId === "string" ? entity.authorId : "";

  const authorName =
    typeof entity.authorName === "string" && entity.authorName.trim().length > 0
      ? entity.authorName.trim()
      : typeof entity.displayName === "string" &&
          entity.displayName.trim().length > 0
        ? entity.displayName.trim()
        : typeof entity.name === "string" && entity.name.trim().length > 0
          ? entity.name.trim()
          : authorId || "Usuario";

  const avatarUrl =
    typeof entity.authorAvatarUrl === "string" &&
    entity.authorAvatarUrl.trim().length > 0
      ? entity.authorAvatarUrl.trim()
      : typeof entity.avatarUrl === "string" && entity.avatarUrl.trim().length > 0
        ? entity.avatarUrl.trim()
        : typeof entity.photoURL === "string" && entity.photoURL.trim().length > 0
          ? entity.photoURL.trim()
          : null;

  const username =
    typeof entity.authorUsername === "string" &&
    entity.authorUsername.trim().length > 0
      ? entity.authorUsername.trim()
      : typeof entity.username === "string" && entity.username.trim().length > 0
        ? entity.username.trim()
        : null;

  const profileHref = username ? `/u/${username}` : `/u/${authorId}`;

  return {
    authorId,
    authorName,
    avatarUrl,
    profileHref,
    initials: getInitials(authorName),
  };
}

export function getGroupInfo(entity: Record<string, unknown>) {
  const forcedGroupId =
    typeof entity.forcedGroupId === "string" && entity.forcedGroupId.trim().length > 0
      ? entity.forcedGroupId.trim()
      : null;

  const rawGroupId =
    typeof entity.groupId === "string" && entity.groupId.trim().length > 0
      ? entity.groupId.trim()
      : null;

  const groupId = forcedGroupId || rawGroupId;

  const groupName =
    typeof entity.groupName === "string" && entity.groupName.trim().length > 0
      ? entity.groupName.trim()
      : null;

  const groupAvatarUrl =
    typeof entity.groupAvatarUrl === "string" &&
    entity.groupAvatarUrl.trim().length > 0
      ? entity.groupAvatarUrl.trim()
      : null;

  const rawVisibility =
    typeof entity.groupVisibility === "string"
      ? entity.groupVisibility.trim().toLowerCase()
      : "";

  const visibility =
    rawVisibility === "public" || rawVisibility === "private" || rawVisibility === "hidden"
      ? rawVisibility
      : null;

  const href = groupId ? `/groups/${groupId}` : null;

  return {
    groupId,
    groupName,
    groupAvatarUrl,
    visibility,
    href,
    initials: getInitials(groupName || "Comunidad"),
  };
}

export function getCommunityVisibilityLabel(
  visibility: string | null,
): "publicLabel" | "privateLabel" | "hiddenLabel" | "title" {
  switch (visibility) {
    case "public":
      return "publicLabel";
    case "private":
      return "privateLabel";
    case "hidden":
      return "hiddenLabel";
    default:
      return "title";
  }
}

export function resolveEffectiveMemberStatus(rawStatus: unknown, mutedUntil: unknown) {
  const status =
    typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : "";

  if (status === "banned") return "banned";
  if (status === "removed" || status === "kicked" || status === "expelled") {
    return "removed";
  }

  if (status === "muted") {
    if (mutedUntil !== null && mutedUntil !== undefined && typeof (mutedUntil as { toDate?: unknown }).toDate === "function") {
      const until = (mutedUntil as { toDate: () => unknown }).toDate();
      if (until instanceof Date && until.getTime() <= Date.now()) {
        return "active";
      }
    }
    return "muted";
  }

  return "active";
}

export function buildCommentBlockedMessage(
  reason: InteractionBlockedReason,
  isProfile = false
): string {
  const place = isProfile ? "este perfil" : "esta comunidad";

  if (reason === "login") {
    return "Inicia sesión para comentar";
  }

  if (reason === "join") {
    return isProfile ? "Sigue este perfil para comentar" : "Únete para comentar";
  }

  // restricted / default → leyenda corta (sin explicaciones largas).
  return `No puedes comentar en ${place}`;
}

export function truncatePostText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;

  const sliced = text.slice(0, maxLength).trim();
  const lastSpace = sliced.lastIndexOf(" ");

  return `${sliced.slice(0, lastSpace > 40 ? lastSpace : sliced.length).trim()}...`;
}

/**
 * Etiqueta de una acción de moderación sobre una publicación.
 *
 * El traductor entra por parámetro: esto es una utilidad, no un componente.
 * `t` apunta al grupo `groups`; cinco de las claves ya existían y solo seis
 * hubo que crear.
 */
export function buildActionLabel(
  action: ModerationAction,
  t: (key: string) => string,
  tPosts: (key: string) => string
) {
  const CLAVES: Partial<Record<ModerationAction, string>> = {
    mute: "mute",
    unmute: "unmute",
    ban: "ban",
    unban: "unban",
    remove: "actionRemoveFull",
    pin_group_post: "actionPinInGroup",
    unpin_group_post: "actionUnpinFromGroup",
    pin_profile_post: "actionPinOnProfile",
    unpin_profile_post: "actionUnpinFromProfile",
    block_user: "blockProfile",
    unblock_user: "unblockProfile",
    block_in_group: "blockInGroup",
    unblock_in_group: "unblockInGroup",
    hide_post: "actionHidePost",
  };

  if (action === "edit_post") return tPosts("editPostTitle");
  return t(CLAVES[action] ?? "actionDeletePost");
}

export function getMenuActionTexts(action: ModerationAction): { loading: string; done: string } | null {
  if (action === "delete_post") return { loading: "Eliminando publicación", done: "Publicación eliminada" };
  if (action === "pin_group_post") return { loading: "Fijando en grupo", done: "Fijado en grupo" };
  if (action === "unpin_group_post") return { loading: "Desfijando del grupo", done: "Desfijado del grupo" };
  if (action === "pin_profile_post") return { loading: "Fijando en perfil", done: "Fijado en perfil" };
  if (action === "unpin_profile_post") return { loading: "Desfijando del perfil", done: "Desfijado del perfil" };
  if (action === "ban") return { loading: "Baneando integrante", done: "Integrante baneado" };
  if (action === "unban") return { loading: "Quitando ban", done: "Ban quitado" };
  if (action === "remove") return { loading: "Expulsando integrante", done: "Integrante expulsado" };
  if (action === "unmute") return { loading: "Quitando mute", done: "Mute quitado" };
  return null;
}

export function buildPremiumPreviewClips(duration: number): Array<{ start: number; end: number }> {
  const CLIP_DURATION = 20;
  const numClips = Math.max(1, Math.min(Math.floor(duration / 60), 10));
  const clips: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < numClips; i++) {
    const start = (duration / numClips) * i;
    const end = Math.min(start + CLIP_DURATION, duration - 0.1);
    if (start < duration - 1) clips.push({ start, end });
  }
  return clips;
}
