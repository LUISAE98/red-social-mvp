"use client";

// GroupRecommendationsRail parts (1/2): consts, helpers y sub-componentes base.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { isDisplayCurrency } from "@/lib/currency/catalog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Post } from "@/lib/posts/types";

const LiveViewerModal = dynamic(
  () => import("@/app/components/LiveViewerModal/LiveViewerModal"),
  { ssr: false }
);
import { joinGroup } from "@/lib/groups/membership";
import { requestToJoin } from "@/lib/groups/joinRequests";
import { followUser } from "@/lib/social/social-service";
import {
  GROUP_CATEGORY_LABELS,
  GROUP_CATEGORY_OPTIONS,
  normalizeGroupCategory,
  type CanonicalGroupCategory,
  type Group,
} from "@/types/group";
import {
  completeRecommendationsOnboarding,
  fetchRecommendedGroupsForUser,
  fetchRecommendedProfilesForUser,
  getCachedResult,
  invalidateRecommendationCache,
  onRecommendationCacheInvalidated,
  recommendationEngineConstants,
  seededShuffle,
  trackGroupRecommendationSignalFromGroup,
  getUserTasteVector,
} from "./recommendation-engine";
import { updateProfileInterests } from "@/lib/profile/updateProfileInterests";
import type {
  RailItem,
  RecommendationFetchResult,
  RecommendationGroupCard,
  RecommendationJoinState,
  RecommendationProfileCard,
  RecommendationRailContext,
} from "./types";
import { RailActionButton, type RailBtnTono } from "./RailActionButton";
import { CACHE_TTL } from "@/lib/cache/ttl";

// Module-level profile cache — survives navigation in the same tab
export type ProfileCacheEntry = { profiles: RecommendationProfileCard[]; cachedAt: number };
export const profileCache = new Map<string, ProfileCacheEntry>();
// Estaba en 90 segundos, contra los 10 minutos del motor que las calcula:
// las tarjetas caducaban seis veces antes que la recomendación que muestran.
export const PROFILE_CACHE_TTL_MS = CACHE_TTL.CATALOGO;

export function peekProfiles(uid: string): RecommendationProfileCard[] | null {
  const e = profileCache.get(uid);
  if (!e || Date.now() - e.cachedAt > PROFILE_CACHE_TTL_MS) return null;
  return e.profiles;
}

export type Props = {
  currentUserId: string;
  context: RecommendationRailContext;
  title?: string;
  subtitle?: string;
  emptySearchTerm?: string;
  onCreateGroup?: () => void;
  className?: string;
  /**
   * Solo renderiza el selector de intereses (onboarding) y nada más.
   * Se usa para mostrarlo UNA sola vez al inicio del feed. Si el onboarding ya
   * está completo, el componente no renderiza nada.
   */
  onboardingOnly?: boolean;
  /**
   * Nunca muestra el selector de onboarding (solo recomendaciones).
   * Se usa en los rails de recomendación inyectados en el feed para que el
   * selector no aparezca repetido.
   */
  suppressOnboarding?: boolean;
  /**
   * Orden de esta instancia dentro del feed (0, 1, 2…). Sirve para que cada
   * aparición del rail NO muestre lo mismo: se toma una ventana distinta de las
   * recomendaciones y, si no hay suficiente contenido, se cambia el orden.
   */
  railIndex?: number;
};

export const fontStack =
  'inherit';

// Separación entre tarjetas del selector de intereses.
export const INTEREST_GRID_GAP = 3;

/**
 * Retícula del selector de intereses: renglones y columnas FIJOS por aparato,
 * no derivados del ancho.
 *
 * En celular son 3 × 3 y en laptop 4 × 2. Las tarjetas se estiran o se encogen
 * para llenar el ancho que haya — un celular angosto y uno ancho enseñan la
 * misma cuadrícula, solo que con tarjetas de distinto tamaño. La última página
 * es la única que puede venir incompleta, cuando ya no quedan categorías.
 */
export const INTEREST_GRID = {
  mobile: { columns: 3, rows: 3 },
  desktop: { columns: 4, rows: 2 },
} as const;

export function interestsGridFor(isDesktop: boolean) {
  const { columns, rows } = isDesktop ? INTEREST_GRID.desktop : INTEREST_GRID.mobile;
  return { columns, rows, perPage: columns * rows };
}

// Carrusel de recomendaciones. RAIL_CARD_W es el ancho de referencia: en celular
// es el ancho fijo de cada card; en desktop es el mínimo para decidir cuántas
// caben (luego crecen para cubrir todo el ancho disponible).
export const RAIL_CARD_W = 200;
export const RAIL_GAP = 3;
// En laptop siempre caben 3 por renglón: las cards se encogen si hace falta,
// pero nunca crecen más de RAIL_CARD_W.
export const RAIL_PER_PAGE = 3;

// Controles del rail ("Regresar" / "Ver más"): solo texto morado con flecha.
export const railTextButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  color: "#a855f7",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "inherit",
};

// Card del rail unificada (live / comunidad / perfil), para poder paginar.
export type RailCard =
  | { kind: "live"; rec: LiveRec }
  | { kind: "group"; group: RecommendationGroupCard }
  | { kind: "profile"; profile: RecommendationProfileCard };

// Deslizamiento entre páginas del selector: dir = 1 (siguiente) desliza a la
// izquierda; dir = -1 (regresar) al revés.
export const INTEREST_SLIDE_VARIANTS: Variants = {
  enter: (dir: number) => ({ x: dir >= 0 ? "100%" : "-100%", opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir >= 0 ? "-100%" : "100%", opacity: 0 }),
};

// La card llena el ancho de su contenedor: en desktop el contenedor es flexible
// (las cards crecen para cubrir todo el espacio) y en celular es fijo (scroll).
export const cardStyles = {
  position: "relative" as const,
  width: "100%",
  color: "#fff",
};

export async function resolveJoinState(
  groupId: string,
  userId: string,
  visibility: Group["visibility"]
): Promise<RecommendationJoinState> {
  const memberSnap = await getDoc(doc(db, "groups", groupId, "members", userId));
  if (memberSnap.exists()) return "joined";

  if (visibility === "private") {
    const requestSnap = await getDoc(
      doc(db, "groups", groupId, "joinRequests", userId)
    );
    if (requestSnap.exists()) return "pending";
    return "request";
  }

  return "join";
}

export function getRecommendationMonetization(
  group: RecommendationGroupCard
): Record<string, unknown> | null {
  const candidate = (group as RecommendationGroupCard & {
    monetization?: unknown;
  }).monetization;

  if (!candidate || typeof candidate !== "object") return null;
  return candidate as Record<string, unknown>;
}

export function resolveSubscriptionEnabled(group: RecommendationGroupCard) {
  const monetization = getRecommendationMonetization(group);
  return (
    monetization?.subscriptionsEnabled === true ||
    monetization?.isPaid === true
  );
}

export function resolveSubscriptionPrice(group: RecommendationGroupCard) {
  const monetization = getRecommendationMonetization(group);

  const subscriptionPrice = monetization?.subscriptionPriceMonthly;
  if (typeof subscriptionPrice === "number" && Number.isFinite(subscriptionPrice)) {
    return subscriptionPrice;
  }

  const legacyPrice = monetization?.priceMonthly;
  return typeof legacyPrice === "number" && Number.isFinite(legacyPrice)
    ? legacyPrice
    : null;
}

export function resolveSubscriptionCurrency(group: RecommendationGroupCard) {
  const monetization = getRecommendationMonetization(group);

  const subscriptionCurrency = monetization?.subscriptionCurrency;
  if (typeof subscriptionCurrency === "string") {
    return subscriptionCurrency;
  }

  const legacyCurrency = monetization?.currency;
  return typeof legacyCurrency === "string" ? legacyCurrency : null;
}

// Íconos propios (SVG) por categoría — trazo blanco (currentColor), mismo estilo
// en toda la app. Cada valor son los hijos del <svg> que dibuja CategoryIcon.
export const CATEGORY_ICON_INNER = {
  entretenimiento: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none" />
    </>
  ),
  musica: (
    <>
      <path d="M9 17V5l11-2v11" />
      <circle cx="6" cy="17" r="2.6" />
      <circle cx="17" cy="15" r="2.6" />
    </>
  ),
  creadores: (
    <path d="M12 3l2 5.5 5.5 2-5.5 2L12 18l-2-5.5L4.5 10.5 10 8.5z" />
  ),
  gaming: (
    <>
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <line x1="7" y1="12" x2="10" y2="12" />
      <line x1="8.5" y1="10.5" x2="8.5" y2="13.5" />
      <circle cx="15.5" cy="11" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="13" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  tecnologia: (
    <>
      <rect x="4" y="5" width="16" height="10" rx="1.5" />
      <line x1="2" y1="19" x2="22" y2="19" />
    </>
  ),
  deportes: (
    <>
      <path d="M7 4h10v3a5 5 0 0 1-10 0z" />
      <path d="M7 5H4.5a2.5 2.5 0 0 0 0 5H7" />
      <path d="M17 5h2.5a2.5 2.5 0 0 1 0 5H17" />
      <line x1="12" y1="12" x2="12" y2="20" />
      <line x1="10" y1="16" x2="14" y2="16" />
      <line x1="8.5" y1="20" x2="15.5" y2="20" />
    </>
  ),
  fitness_bienestar: (
    <>
      <line x1="6.5" y1="12" x2="17.5" y2="12" />
      <rect x="3" y="9" width="3" height="6" rx="1" />
      <rect x="18" y="9" width="3" height="6" rx="1" />
      <line x1="2" y1="10.5" x2="2" y2="13.5" />
      <line x1="22" y1="10.5" x2="22" y2="13.5" />
    </>
  ),
  educacion: (
    <>
      <path d="M2 8.5l10-4 10 4-10 4z" />
      <path d="M6 10.5V15c0 1.2 2.7 2.5 6 2.5s6-1.3 6-2.5v-4.5" />
      <line x1="22" y1="8.5" x2="22" y2="13.5" />
    </>
  ),
  negocios_finanzas: (
    <>
      <rect x="3" y="7.5" width="18" height="11.5" rx="2" />
      <path d="M8 7.5V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1.5" />
      <line x1="3" y1="13" x2="21" y2="13" />
    </>
  ),
  noticias_politica: (
    <>
      <path d="M4 5h13v14H5.5A1.5 1.5 0 0 1 4 17.5z" />
      <path d="M17 8.5h3v9a1.5 1.5 0 0 1-3 0" />
      <line x1="7" y1="9" x2="14" y2="9" />
      <line x1="7" y1="12" x2="14" y2="12" />
      <line x1="7" y1="15" x2="11" y2="15" />
    </>
  ),
  ciencia: (
    <>
      <path d="M9 3v6.5l-4.7 7.8A1.8 1.8 0 0 0 5.8 20h12.4a1.8 1.8 0 0 0 1.5-2.7L15 9.5V3" />
      <line x1="8" y1="3" x2="16" y2="3" />
      <line x1="7.5" y1="14" x2="16.5" y2="14" />
    </>
  ),
  moda_belleza: (
    <path d="M9 4l3 2.2L15 4l1.8 4.2-2.3 1.6L16 20H8l1.5-9.2-2.3-1.6z" />
  ),
  comida: (
    <>
      <path d="M6 3v6a2 2 0 0 0 4 0V3M8 11v10" />
      <path d="M16 3c-1.4 0-2 2.2-2 4.5s.6 4 2 4.3V21" />
    </>
  ),
  viajes: (
    <>
      <line x1="12" y1="3" x2="12" y2="16" />
      <path d="M12 4l6 9H12z" />
      <path d="M3 16h18l-2.2 4.2a1.5 1.5 0 0 1-1.3.8H6.5a1.5 1.5 0 0 1-1.3-.8z" />
    </>
  ),
  autos: (
    <>
      <path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11" />
      <path d="M3 11h18v5H3z" />
      <circle cx="7.5" cy="16.5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="16.5" cy="16.5" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  mascotas: (
    <g fill="currentColor" stroke="none">
      <circle cx="12" cy="15.5" r="3.4" />
      <circle cx="6.5" cy="11" r="1.7" />
      <circle cx="9.8" cy="7.8" r="1.7" />
      <circle cx="14.2" cy="7.8" r="1.7" />
      <circle cx="17.5" cy="11" r="1.7" />
    </g>
  ),
  hobbies: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  familia_comunidad: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19.5c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8" />
      <circle cx="17" cy="9" r="2.3" />
      <path d="M16.5 14.8c2.6.1 4 1.9 4 4.7" />
    </>
  ),
  instituciones: (
    <>
      <path d="M3 9.5l9-5 9 5" />
      <line x1="4" y1="9.5" x2="20" y2="9.5" />
      <line x1="6" y1="9.5" x2="6" y2="17" />
      <line x1="10" y1="9.5" x2="10" y2="17" />
      <line x1="14" y1="9.5" x2="14" y2="17" />
      <line x1="18" y1="9.5" x2="18" y2="17" />
      <line x1="3.5" y1="20" x2="20.5" y2="20" />
    </>
  ),
  cine: (
    <>
      <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
      <path d="m6.2 5.3 3.1 3.9" />
      <path d="m12.4 3.4 3.1 4" />
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </>
  ),
  arte: (
    <>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2C19.5 15.4 22 12.9 22 9.85 22 5.6 17.5 2 12 2Z" />
      <circle cx="7" cy="12.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="17" cy="10" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  salud: (
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  ),
  libros: (
    <>
      <path d="M12 6.2C10 4.8 7 4.3 4 4.8v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.4z" />
      <path d="M12 6.2v13" />
    </>
  ),
  historia: (
    <>
      <path d="M3 4v5h5" />
      <path d="M3.05 13a9 9 0 1 0 2.5-6.3L3 9" />
      <path d="M12 8v4.5l3 1.5" />
    </>
  ),
  otros: (
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </g>
  ),
};

// Imagen de fondo por categoría (se van agregando una por una). Si no hay
// imagen, la tarjeta usa el gris plano de placeholder.
export const CATEGORY_IMAGE: Partial<Record<CanonicalGroupCategory, string>> = {
  musica: "/musica.webp",
  entretenimiento: "/entretenimiento.webp",
  creadores: "/creadores.webp",
  gaming: "/gaming.webp",
  tecnologia: "/tecnologia.webp",
  deportes: "/deportes.webp",
  fitness_bienestar: "/fitness.webp",
  negocios_finanzas: "/negocios.webp",
  educacion: "/educacion.webp",
  noticias_politica: "/noticias.webp",
  ciencia: "/ciencia.webp",
  moda_belleza: "/moda.webp",
  comida: "/comida.webp",
  viajes: "/viajes.webp",
  autos: "/autos.webp",
  mascotas: "/mascotas.webp",
  hobbies: "/hobbies.webp",
  familia_comunidad: "/familia.webp",
  instituciones: "/instituciones.webp",
  cine: "/cine.webp",
  arte: "/arte.webp",
  salud: "/salud.webp",
  libros: "/libros.webp",
  historia: "/historia.webp",
};

export function CategoryIcon({
  category,
  size = 30,
}: {
  category: CanonicalGroupCategory;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {CATEGORY_ICON_INNER[category]}
    </svg>
  );
}

// ── Celebración del onboarding de intereses ──────────────────────────────────

// Tiempos (segundos) de la celebración. Cada avatar lleva su propio retraso y
// su propia duración, ambos al azar: nada de stagger por índice, que es lo que
// produce la cascada y el patrón de metrónomo.
export const CELEB = {
  inDurMin: 0.28, // duración del pop de entrada (varía por avatar)
  inDurMax: 0.52,
  outDurMin: 0.22, // duración del pop de salida (varía por avatar)
  outDurMax: 0.44,
  hold: 0.45, // pausa con todos visibles
  sizeMin: 38, // rango amplio de tamaño
  sizeMax: 84,
  // Cuánto se permite que un avatar invada la celda vecina (0 = nunca se
  // encima, 1 = se encima de lleno). Bajo a propósito: se rozan, no se tapan.
  overlap: 0.35,
};

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Ventana dentro de la cual entran (o salen) todos los avatares. Crece con la
// cantidad pero con tope: con 24 seleccionados sigue durando ~1s.
export const celebWindow = (n: number) => clamp(0.13 * n, 0.35, 1.05);

/**
 * Los límites son deterministas aunque los tiempos de cada avatar sean al azar:
 * como todo retraso cae dentro de la ventana y toda duración por debajo del
 * máximo, para `outStart` ya terminaron de aparecer todos. Eso deja que el texto
 * y los botones sepan cuándo irse, y que `handleFinish` sepa cuándo guardar, sin
 * depender del sorteo.
 */
export function celebTimings(n: number) {
  const window = celebWindow(n);
  const outStart = window + CELEB.inDurMax + CELEB.hold;
  const total = outStart + window + CELEB.outDurMax;
  return { window, outStart, total };
}

// Reparte n valores dentro de [0, span) de forma irregular pero sin huecos ni
// amontonamientos: un slot por valor, slots barajados y azar dentro del slot.
export function scatterTimes(n: number, span: number): number[] {
  const slots = shuffled(Array.from({ length: n }, (_, i) => i));
  return slots.map((slot) => ((slot + Math.random()) / n) * span);
}

export type BurstItem = {
  option: { value: CanonicalGroupCategory; label: string };
  size: number;
  x: number;
  y: number;
  tIn: number;
  inDur: number;
  tOut: number;
  outDur: number;
};

/**
 * Reparte los avatares al azar pero sin amontonarlos: el área se divide en una
 * rejilla invisible de celdas, se barajan y cada avatar toma una. Así ningún
 * lado queda más cargado que el otro — dentro de su celda cada avatar sí se
 * coloca al azar, y puede rozar a su vecino sin llegar a taparlo.
 */
export function buildBurst(
  categories: ReadonlyArray<{ value: CanonicalGroupCategory; label: string }>,
  width: number,
  height: number
): BurstItem[] {
  const n = categories.length;
  if (n === 0 || width <= 0 || height <= 0) return [];

  // Rejilla proporcional al área, para que las celdas queden lo más cuadradas
  // posible y el reparto no se estire hacia un eje.
  const cols = clamp(Math.round(Math.sqrt((n * width) / height)), 1, n);
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = width / cols;
  const cellH = height / rows;

  const cells = shuffled(Array.from({ length: cols * rows }, (_, i) => i)).slice(0, n);

  // Entrada y salida se sortean por separado, así que el que aparece primero no
  // es el que desaparece primero.
  const { window, outStart } = celebTimings(n);
  const inTimes = scatterTimes(n, window);
  const outTimes = scatterTimes(n, window);

  return categories.map((option, i) => {
    const cell = cells[i];
    const size = CELEB.sizeMin + Math.random() * (CELEB.sizeMax - CELEB.sizeMin);
    const cx = ((cell % cols) + 0.5) * cellW;
    const cy = (Math.floor(cell / cols) + 0.5) * cellH;
    // Margen de azar dentro de la celda; el overlap le permite asomarse un poco
    // a la vecina.
    const spanX = Math.max(0, cellW - size * (1 - CELEB.overlap));
    const spanY = Math.max(0, cellH - size * (1 - CELEB.overlap));
    const x = clamp(cx + (Math.random() - 0.5) * spanX, size / 2, width - size / 2);
    const y = clamp(cy + (Math.random() - 0.5) * spanY, size / 2, height - size / 2);
    return {
      option,
      size,
      x,
      y,
      tIn: inTimes[i],
      inDur: CELEB.inDurMin + Math.random() * (CELEB.inDurMax - CELEB.inDurMin),
      tOut: outStart + outTimes[i],
      outDur: CELEB.outDurMin + Math.random() * (CELEB.outDurMax - CELEB.outDurMin),
    };
  });
}

export function CelebrationBurst({
  categories,
  width,
  height,
}: {
  categories: ReadonlyArray<{ value: CanonicalGroupCategory; label: string }>;
  width: number;
  height: number;
}) {
  const [items, setItems] = useState<BurstItem[]>([]);

  // Se calcula una sola vez al montar: recalcularlo (p. ej. al cambiar el ancho)
  // rebarajaría las posiciones a media animación.
  useEffect(() => {
    setItems(buildBurst(categories, width, height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { total } = celebTimings(categories.length);

  return (
    <div style={{ position: "relative", width: "100%", height, overflow: "hidden" }}>
      {items.map(({ option, size, x, y, tIn, inDur, tOut, outDur }) => {
        const times = [
          0,
          Math.max(tIn / total, 0.0001),
          (tIn + inDur * 0.6) / total,
          (tIn + inDur) / total,
          tOut / total,
          (tOut + outDur) / total,
        ];
        const bg = CATEGORY_IMAGE[option.value];
        return (
          <motion.span
            key={option.value}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 0, 1.18, 1, 1, 0], opacity: [0, 0, 1, 1, 1, 0] }}
            transition={{ duration: total, times, ease: "easeOut" }}
            style={{
              position: "absolute",
              insetInlineStart: x - size / 2,
              top: y - size / 2,
              width: size,
              height: size,
              borderRadius: "50%",
              overflow: "hidden",
              background: bg
                ? `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), center / cover no-repeat url("${bg}")`
                : "rgba(0,0,0,0.72)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <CategoryIcon category={option.value} size={Math.round(size * 0.46)} />
          </motion.span>
        );
      })}
    </div>
  );
}

/**
 * Medidas internas de la tarjeta a partir del ancho de su columna.
 *
 * La retícula tiene columnas fijas (3 en celular, 8 en laptop), así que el
 * ancho de cada tarjeta cambia con el del aparato. Si el círculo, el texto y el
 * acolchado se quedaran en píxeles fijos, en las columnas angostas el contenido
 * se saldría de la tarjeta. Todo se calcula proporcional y con topes: nunca más
 * grande que el diseño original ni más chico de lo legible.
 */
export function categoryPillMetrics(columnWidth: number) {
  // Sin medida todavía (primer render): las de siempre.
  const w = columnWidth > 0 ? columnWidth : 130;
  return {
    padding: clamp(Math.round(w * 0.09), 6, 12),
    gap: clamp(Math.round(w * 0.085), 4, 12),
    circle: clamp(Math.round(w * 0.44), 26, 60),
    icon: clamp(Math.round(w * 0.22), 13, 30),
    font: clamp(Math.round(w * 0.1 * 10) / 10, 9, 13),
    check: clamp(Math.round(w * 0.17), 14, 22),
    checkInset: clamp(Math.round(w * 0.05), 3, 6),
  };
}

export function GroupCategoryPill({
  label,
  category,
  selected,
  onToggle,
  columnWidth = 0,
}: {
  label: string;
  category: CanonicalGroupCategory;
  selected: boolean;
  onToggle: () => void;
  /** Ancho medido de la columna; de ahí salen las medidas internas. */
  columnWidth?: number;
}) {
  const bgImage = CATEGORY_IMAGE[category];
  const m = categoryPillMetrics(columnWidth);
  return (
    <button
      type="button"
      onClick={onToggle}
      className="vibCatCard vibra-pop"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: m.gap,
        width: "100%",
        minWidth: 0,
        aspectRatio: "1 / 1",
        border: selected
          ? "2px solid #a855f7"
          : "1px solid rgba(255,255,255,0.08)",
        // Imagen de fondo si existe; si no, gris plano de placeholder.
        background: bgImage
          ? `linear-gradient(rgba(0,0,0,0.32), rgba(0,0,0,0.46)), center / cover no-repeat url("${bgImage}")`
          : "#3a3a3f",
        color: "#fff",
        borderRadius: 0,
        overflow: "hidden",
        padding: m.padding,
        cursor: "pointer",
        fontFamily: fontStack,
        boxSizing: "border-box",
      }}
    >
      <AnimatePresence>
        {selected && (
          <motion.span
            key="check"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 18 }}
            style={{
              position: "absolute",
              top: m.checkInset,
              insetInlineEnd: m.checkInset,
              width: m.check,
              height: m.check,
              borderRadius: "50%",
              background: "#a855f7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
            }}
          >
            <svg width={Math.round(m.check * 0.55)} height={Math.round(m.check * 0.55)} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 6" />
            </svg>
          </motion.span>
        )}
      </AnimatePresence>
      <span
        className="vibCatIcon"
        style={{
          width: m.circle,
          height: m.circle,
          flexShrink: 0,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.72)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          transition: "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <CategoryIcon category={category} size={m.icon} />
      </span>
      {/* A dos renglones como tope: en las columnas angostas de laptop, un
          nombre largo a tres renglones empujaría el círculo fuera de la
          tarjeta. */}
      <span
        style={{
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
          maxWidth: "100%",
          fontSize: m.font,
          fontWeight: 600,
          color: "#fff",
          textAlign: "center",
          lineHeight: 1.15,
          overflowWrap: "anywhere",
        }}
      >
        {label}
      </span>
    </button>
  );
}

export function JoinButton({
  state,
  onClick,
  loading,
  isPaidSubscriptionPrivate,
  subscribePriceLabel,
}: {
  state: RecommendationJoinState;
  onClick: () => void;
  loading: boolean;
  isPaidSubscriptionPrivate: boolean;
  /** Precio mensual TODO-INCLUIDO (base + cargo fijo + impuesto del país) ya formateado; null si no se conoce. */
  subscribePriceLabel?: string | null;
}) {
  const tGroups = useTranslations("groups");

  const label =
    state === "joined"
      ? tGroups("joined")
      : state === "pending"
        ? tGroups("requestSent")
        : state === "request"
          ? isPaidSubscriptionPrivate
            ? subscribePriceLabel
              ? tGroups("subscribeForPrice", { price: subscribePriceLabel })
              : tGroups("subscribeCta")
            : tGroups("requestAccess")
          : tGroups("join");

  // Solo la solicitud a la espera va en gris: es lo único que depende de que
  // otro conteste. Ser miembro es un logro, así que conserva el color.
  const tono: RailBtnTono =
    state === "pending" ? "espera"
      : state === "request" && isPaidSubscriptionPrivate ? "pago"
        : "marca";

  return (
    <RailActionButton
      label={label}
      tono={tono}
      loading={loading}
      onClick={onClick}
      fontStack={fontStack}
    />
  );
}

export function FollowButton({
  isFollowing,
  onClick,
  loading,
}: {
  isFollowing: boolean;
  onClick: () => void;
  loading: boolean;
}) {
  const tCommon = useTranslations("common");

  return (
    <RailActionButton
      // Seguir y Siguiendo van los dos con color: seguir a alguien no es una
      // espera, se resuelve al instante. Lo que cambia es la palabra.
      label={isFollowing ? tCommon("following") : tCommon("follow")}
      tono="marca"
      loading={loading}
      onClick={onClick}
      fontStack={fontStack}
    />
  );
}


// Tipos compartidos con las tarjetas (usados por parts y cards).
export type LiveRec = {
  postId: string;
  authorId: string;
  groupId: string | null;
  liveCoverUrl: string | null;
  liveTitle: string | null;
  displayName: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  handle?: string | null;
  groupVisibility?: string | null;
  subscriptionEnabled?: boolean;
  /** Precio mensual BASE de la suscripción de la comunidad (para el botón "Suscribirme · $"). */
  subscriptionPriceMonthly?: number | null;
  // Recomendación de lives: categorías (afinidad), inicio (recencia), espectadores.
  categories?: CanonicalGroupCategory[];
  startedAtMs?: number;
  viewers?: number;
};

export type LiveActionState = "none" | "following" | "joined" | "pending";
