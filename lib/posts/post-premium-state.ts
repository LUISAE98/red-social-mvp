import type { Post } from "./types";
import type { PostAccess } from "./post-access-types";

/**
 * Estados posibles de acceso premium de un post para un viewer específico.
 *
 * free               — post sin configuración premium (normal)
 * locked             — premium activo, viewer sin acceso válido
 * unlocked_author    — viewer es el autor del post
 * unlocked_membership  — acceso por membresía activa (freeFor: members_and_subscribers)
 * unlocked_subscription — acceso por suscripción (freeFor: members_and_subscribers)
 * unlocked_purchase  — acceso por compra única confirmada (PostAccess.status === "active")
 */
export type PostPremiumState =
  | "free"
  | "locked"
  | "unlocked_author"
  | "unlocked_membership"
  | "unlocked_subscription"
  | "unlocked_purchase";

/**
 * Contexto del viewer para resolver el estado premium de un post.
 *
 * viewerIsMember      — true si el viewer es miembro activo del grupo/contexto
 * viewerIsSubscriber  — true si el viewer tiene suscripción activa (fase futura)
 * viewerAccess        — registro PostAccess del viewer para este post, si existe
 */
export type PostPremiumViewerContext = {
  post: Post;
  currentUserId?: string | null;
  viewerIsMember?: boolean;
  viewerIsSubscriber?: boolean;
  viewerAccess?: PostAccess | null;
};

export type PostPremiumStateResult = {
  isPremium: boolean;
  state: PostPremiumState;
  isBlocked: boolean;
  hasAccessByMembership: boolean;
  hasAccessBySubscription: boolean;
  hasAccessByPurchase: boolean;
  /** Texto descriptivo para el panel premium. Null si no es premium o está desbloqueado. */
  panelMessage: string | null;
  /** Texto del botón de acción principal. Null si no es premium o está desbloqueado. */
  ctaText: string | null;
};

/** Devuelve true si el post tiene configuración premium activa. */
export function isPostPremium(post: Post): boolean {
  return post.premium?.enabled === true;
}

/**
 * Resuelve el estado premium completo de un post para un viewer específico.
 *
 * Combinaciones válidas de (accessMode, freeFor) según el modelo de negocio:
 *   members_only + none               → solo miembros pueden comprar
 *   public       + none               → cualquiera puede comprar
 *   public       + members_and_subscribers → miembros ven gratis, otros compran
 */
export function resolvePostPremiumState(
  ctx: PostPremiumViewerContext
): PostPremiumStateResult {
  const {
    post,
    currentUserId = null,
    viewerIsMember = false,
    viewerIsSubscriber = false,
    viewerAccess = null,
  } = ctx;

  if (!isPostPremium(post)) {
    return buildFreeResult();
  }

  // El autor siempre tiene acceso a su propio contenido
  if (currentUserId && post.authorId === currentUserId) {
    return buildUnlockedResult("unlocked_author");
  }

  // Compra única confirmada
  if (viewerAccess?.status === "active") {
    return buildUnlockedResult("unlocked_purchase");
  }

  const premium = post.premium!;

  // Acceso gratuito por membresía o suscripción
  if (premium.freeFor === "members_and_subscribers") {
    if (viewerIsMember) {
      return buildUnlockedResult("unlocked_membership");
    }
    if (viewerIsSubscriber) {
      return buildUnlockedResult("unlocked_subscription");
    }
  }

  // Sin acceso válido → bloqueado
  return {
    isPremium: true,
    state: "locked",
    isBlocked: true,
    hasAccessByMembership: false,
    hasAccessBySubscription: false,
    hasAccessByPurchase: false,
    panelMessage: buildPanelMessage(post),
    ctaText: buildCtaText(post),
  };
}

// ─── Helpers públicos individuales ────────────────────────────────────────────

/** Devuelve true si el viewer tiene acceso al contenido premium (cualquier vía). */
export function viewerHasPremiumAccess(ctx: PostPremiumViewerContext): boolean {
  return !resolvePostPremiumState(ctx).isBlocked;
}

/** Construye solo el mensaje del panel premium a partir del post. */
export function getPremiumPanelMessage(post: Post): string | null {
  if (!isPostPremium(post)) return null;
  return buildPanelMessage(post);
}

/** Construye solo el texto del CTA a partir del post. */
export function getPremiumCtaText(post: Post): string | null {
  if (!isPostPremium(post)) return null;
  return buildCtaText(post);
}

// ─── Builders internos ────────────────────────────────────────────────────────

function buildFreeResult(): PostPremiumStateResult {
  return {
    isPremium: false,
    state: "free",
    isBlocked: false,
    hasAccessByMembership: false,
    hasAccessBySubscription: false,
    hasAccessByPurchase: false,
    panelMessage: null,
    ctaText: null,
  };
}

function buildUnlockedResult(
  state: Exclude<PostPremiumState, "free" | "locked">
): PostPremiumStateResult {
  return {
    isPremium: true,
    state,
    isBlocked: false,
    hasAccessByMembership: state === "unlocked_membership",
    hasAccessBySubscription: state === "unlocked_subscription",
    hasAccessByPurchase: state === "unlocked_purchase",
    panelMessage: null,
    ctaText: null,
  };
}

function buildPanelMessage(post: Post): string {
  const premium = post.premium;
  if (!premium) return "Contenido exclusivo";

  const { accessMode, freeFor, price, currency } = premium;

  // members_only + none: solo miembros pueden comprar
  if (accessMode === "members_only") {
    return "Este video es exclusivo para miembros de pago de esta comunidad";
  }

  // public + members_and_subscribers: miembros gratis, otros pagan
  if (freeFor === "members_and_subscribers") {
    const priceLabel = formatPrice(price, currency ?? "MXN");
    if (priceLabel) {
      return `Los miembros lo ven gratis. Accede por ${priceLabel}`;
    }
    return "Los miembros lo ven gratis. Compra el acceso para verlo";
  }

  // public + none: cualquiera debe pagar
  const priceLabel = formatPrice(price, currency ?? "MXN");
  if (priceLabel) {
    return `Desbloquea esta publicación por ${priceLabel}`;
  }

  return "Contenido premium";
}

function buildCtaText(post: Post): string {
  const premium = post.premium;
  if (!premium) return "Desbloquear";

  const { accessMode, price, currency } = premium;

  if (accessMode === "members_only") {
    return "Unirme a la comunidad";
  }

  const priceLabel = formatPrice(price, currency ?? "MXN");
  if (priceLabel) {
    return `Comprar por ${priceLabel}`;
  }

  return "Desbloquear";
}

function formatPrice(
  price: number | null | undefined,
  currency: string
): string | null {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return null;
  }

  try {
    const formatted = new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
    return `${formatted} MXN`;
  } catch {
    return `$${price.toFixed(2)} ${currency}`;
  }
}
