import type { Timestamp } from "firebase/firestore";

export type LiveChatMessageType = "message";

export type LiveChatMessage = {
  id: string;
  liveId: string;
  userId: string;
  username: string;
  avatarUrl?: string | null;
  text: string;
  createdAt?: Timestamp | null;
  type: LiveChatMessageType;
  isDeleted: boolean;
  deletedAt?: Timestamp | null;
  deletedBy?: string | null;
  futureFlags?: {
    isSuperComment?: boolean;
  };
};

// ── Supercomentarios ───────────────────────────────────────────────────────

export type SuperCommentTier = {
  id: string;
  name: string;
  maxChars: number;
  price: number;
  color: string;
  displaySeconds: number;
  /**
   * Degradado del nivel, solo en el más alto. Donde se pinta un FONDO se usa este; donde
   * hace falta un color sólido —texto, borde, aro del avatar— se sigue usando `color`,
   * que por eso no desaparece.
   */
  gradient?: string;
};

/**
 * Moneda de un súper comentario. `USD` es la de liquidación desde el corte a Vibra On,
 * LLC (2026-08-18); `MXN` sigue en el tipo porque los registros ANTERIORES la llevan y
 * hay que poder leerlos. Estrecharlo a solo USD rompería la lectura del histórico.
 */
export type SuperCommentCurrency = "USD" | "MXN";

export type SuperCommentConfig = {
  enabled: boolean;
  currency: SuperCommentCurrency;
  tiers: SuperCommentTier[];
};

export type SuperCommentStatus = "paid" | "failed";

export type SuperComment = {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  text: string;
  tierId: string;
  tierName: string;
  color: string;
  displaySeconds: number;
  /** Base del creador, en la moneda de liquidación. NO es lo que pagó el fan. */
  amount: number;
  currency: SuperCommentCurrency;
  /**
   * Lo que el fan pagó DE VERDAD y en qué moneda (base + cargo fijo + conversión +
   * impuesto, ya redondeado). Es lo único válido para dirigirse a él o para leerlo en voz
   * alta. Opcional: los documentos anteriores a que se guardara no lo tienen.
   */
  presentmentAmount?: number;
  presentmentCurrency?: string;
  status: SuperCommentStatus;
  hidden: boolean;
  isDeleted: boolean;
  played: boolean;
  playedAt?: Timestamp | null;
  scheduledAt?: Timestamp | null;
  createdAt: Timestamp | null;
};

// 💵 Precios en USD desde el corte a Vibra On, LLC. ⚠️ DUPLICADO en el backend
// (payments/stripe/superCommentStripeIntent.ts, DEFAULT_TIERS): el precio del cobro lo
// resuelve SIEMPRE el servidor, así que si los dos se separan el fan ve un precio y se
// le cobra otro.
/**
 * Degradado del nivel más alto. Es el mismo del botón `gradient` de la guía de estilo, no
 * uno inventado: ese es EL degradado de la marca, y el nivel tope tiene que leerse como lo
 * más especial que se puede mandar.
 */
const GRADIENTE_SUPERNOVA = "linear-gradient(135deg, var(--pink) 0%, var(--brand-strong) 52%, #3b82f6 100%)";

export const DEFAULT_SUPER_COMMENT_TIERS: SuperCommentTier[] = [
  { id: "t1", name: "Chispa",    maxChars: 60,  price: 2,  color: "#a855f7", displaySeconds: 10 },
  { id: "t2", name: "Llama",     maxChars: 140, price: 6,  color: "#f72fbe", displaySeconds: 15 },
  { id: "t3", name: "Fuego",     maxChars: 220, price: 11,    color: "#3b82f6", displaySeconds: 20 },
  { id: "t4", name: "Explosión", maxChars: 300, price: 16, color: "#facc15", displaySeconds: 25 },
  { id: "t5", name: "Volcán",    maxChars: 380, price: 22,   color: "#4ade80", displaySeconds: 30 },
  { id: "t6", name: "Supernova", maxChars: 500, price: 33,   color: "#f72fbe", displaySeconds: 35, gradient: GRADIENTE_SUPERNOVA },
];

export const DEFAULT_SUPER_COMMENT_CONFIG: SuperCommentConfig = {
  enabled: true,
  currency: "USD",
  tiers: DEFAULT_SUPER_COMMENT_TIERS,
};

/**
 * Estilos para que un aro de 16 px tenga el BORDE en degradado y siga hueco por dentro.
 *
 * Un degradado no se puede poner en `border`, así que se pinta de fondo hasta el borde y
 * se recorta el interior restando dos máscaras: una hasta el relleno y otra hasta el
 * borde. Lo que queda visible es solo el anillo.
 *
 * Vive en el catálogo de niveles porque lo usan los DOS sitios que pintan aros —el panel
 * del creador y el selector del fan— y tienen que verse idénticos.
 */
export function aroDegradado(gradiente: string) {
  return {
    background: `${gradiente} border-box`,
    WebkitMask: "linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)",
    mask: "linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)",
    WebkitMaskComposite: "xor" as const,
    maskComposite: "exclude" as const,
  };
}
