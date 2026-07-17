"use client";

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

// Module-level profile cache — survives navigation in the same tab
type ProfileCacheEntry = { profiles: RecommendationProfileCard[]; cachedAt: number };
const profileCache = new Map<string, ProfileCacheEntry>();
const PROFILE_CACHE_TTL_MS = 90_000;

function peekProfiles(uid: string): RecommendationProfileCard[] | null {
  const e = profileCache.get(uid);
  if (!e || Date.now() - e.cachedAt > PROFILE_CACHE_TTL_MS) return null;
  return e.profiles;
}

type Props = {
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

const fontStack =
  'inherit';

// Grid del selector de intereses: ancho mínimo de columna y separación.
// Se usan tanto en el estilo del grid como para calcular columnas por página.
export const INTEREST_GRID_MIN_COL = 130;
export const INTEREST_GRID_GAP = 3;

// Carrusel de recomendaciones. RAIL_CARD_W es el ancho de referencia: en celular
// es el ancho fijo de cada card; en desktop es el mínimo para decidir cuántas
// caben (luego crecen para cubrir todo el ancho disponible).
const RAIL_CARD_W = 200;
const RAIL_GAP = 3;
// En laptop siempre caben 3 por renglón: las cards se encogen si hace falta,
// pero nunca crecen más de RAIL_CARD_W.
const RAIL_PER_PAGE = 3;

// Controles del rail ("Regresar" / "Ver más"): solo texto morado con flecha.
const railTextButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  color: "#a855ff",
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
type RailCard =
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
const cardStyles = {
  position: "relative" as const,
  width: "100%",
  color: "#fff",
};

async function resolveJoinState(
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

function getRecommendationMonetization(
  group: RecommendationGroupCard
): Record<string, unknown> | null {
  const candidate = (group as RecommendationGroupCard & {
    monetization?: unknown;
  }).monetization;

  if (!candidate || typeof candidate !== "object") return null;
  return candidate as Record<string, unknown>;
}

function resolveSubscriptionEnabled(group: RecommendationGroupCard) {
  const monetization = getRecommendationMonetization(group);
  return (
    monetization?.subscriptionsEnabled === true ||
    monetization?.isPaid === true
  );
}

function resolveSubscriptionPrice(group: RecommendationGroupCard) {
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

function resolveSubscriptionCurrency(group: RecommendationGroupCard) {
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
const CATEGORY_ICON_INNER = {
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
const CATEGORY_IMAGE: Partial<Record<CanonicalGroupCategory, string>> = {
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

function CategoryIcon({
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
const CELEB = {
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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Ventana dentro de la cual entran (o salen) todos los avatares. Crece con la
// cantidad pero con tope: con 24 seleccionados sigue durando ~1s.
const celebWindow = (n: number) => clamp(0.13 * n, 0.35, 1.05);

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
function scatterTimes(n: number, span: number): number[] {
  const slots = shuffled(Array.from({ length: n }, (_, i) => i));
  return slots.map((slot) => ((slot + Math.random()) / n) * span);
}

type BurstItem = {
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
function buildBurst(
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
              left: x - size / 2,
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

export function GroupCategoryPill({
  label,
  category,
  selected,
  onToggle,
}: {
  label: string;
  category: CanonicalGroupCategory;
  selected: boolean;
  onToggle: () => void;
}) {
  const bgImage = CATEGORY_IMAGE[category];
  return (
    <button
      type="button"
      onClick={onToggle}
      className="vibCatCard"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        width: "100%",
        aspectRatio: "1 / 1",
        border: selected
          ? "2px solid #a855ff"
          : "1px solid rgba(255,255,255,0.08)",
        // Imagen de fondo si existe; si no, gris plano de placeholder.
        background: bgImage
          ? `linear-gradient(rgba(0,0,0,0.32), rgba(0,0,0,0.46)), center / cover no-repeat url("${bgImage}")`
          : "#3a3a3f",
        color: "#fff",
        borderRadius: 0,
        overflow: "hidden",
        padding: 12,
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
              top: 6,
              right: 6,
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "#a855ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 6" />
            </svg>
          </motion.span>
        )}
      </AnimatePresence>
      <span
        className="vibCatIcon"
        style={{
          width: 60,
          height: 60,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.72)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          transition: "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <CategoryIcon category={category} size={30} />
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#fff",
          textAlign: "center",
          lineHeight: 1.15,
        }}
      >
        {label}
      </span>
    </button>
  );
}

function JoinButton({
  state,
  onClick,
  loading,
  isPaidSubscriptionPrivate,
}: {
  state: RecommendationJoinState;
  onClick: () => void;
  loading: boolean;
  isPaidSubscriptionPrivate: boolean;
}) {
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("groups");

  const label =
    state === "joined"
      ? tGroups("joined")
      : state === "pending"
        ? tGroups("requestSent")
        : state === "request"
          ? isPaidSubscriptionPrivate
            ? tGroups("subscribe")
            : tGroups("requestAccess")
          : tGroups("join");

  const isInactive = loading || state === "joined" || state === "pending";
  const isPaid = !isInactive && state === "request" && isPaidSubscriptionPrivate;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isInactive}
      style={{
        width: "100%",
        borderRadius: 10,
        padding: "7px 12px",
        border: isInactive ? "1px solid rgba(255,255,255,0.18)" : "none",
        fontWeight: 600,
        fontSize: 13,
        letterSpacing: "-0.01em",
        cursor: isInactive ? "default" : "pointer",
        background: isInactive
          ? "rgba(255,255,255,0.14)"
          : isPaid
            ? "#70aefb"
            : "linear-gradient(135deg, #ec4899, #9333ea)",
        color: isInactive ? "rgba(255,255,255,0.70)" : "#fff",
        fontFamily: fontStack,
        backdropFilter: isInactive ? "blur(12px)" : "none",
        WebkitBackdropFilter: isInactive ? "blur(12px)" : "none",
        transition: "opacity 150ms ease",
      }}
    >
      {loading ? tCommon("processing") : label}
    </button>
  );
}

function FollowButton({
  isFollowing,
  onClick,
  loading,
}: {
  isFollowing: boolean;
  onClick: () => void;
  loading: boolean;
}) {
  const tCommon = useTranslations("common");
  const isInactive = loading || isFollowing;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isInactive}
      style={{
        width: "100%",
        borderRadius: 10,
        padding: "7px 12px",
        border: isInactive ? "1px solid rgba(255,255,255,0.18)" : "none",
        fontWeight: 600,
        fontSize: 13,
        letterSpacing: "-0.01em",
        cursor: isInactive ? "default" : "pointer",
        background: isInactive
          ? "rgba(255,255,255,0.14)"
          : "linear-gradient(135deg, #ec4899, #9333ea)",
        color: isInactive ? "rgba(255,255,255,0.70)" : "#fff",
        fontFamily: fontStack,
        backdropFilter: isInactive ? "blur(12px)" : "none",
        WebkitBackdropFilter: isInactive ? "blur(12px)" : "none",
        transition: "opacity 150ms ease",
      }}
    >
      {loading ? tCommon("processing") : isFollowing ? tCommon("unfollow") : tCommon("follow")}
    </button>
  );
}

function ProfileCard({
  profile,
  isFollowing,
  loading,
  onFollow,
  currentUserId,
}: {
  profile: RecommendationProfileCard;
  isFollowing: boolean;
  loading: boolean;
  onFollow: () => void;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const tGroups = useTranslations("groups");
  const followersLabel =
    profile.followersCount > 0
      ? `${profile.followersCount.toLocaleString()} ${
          profile.followersCount === 1 ? tGroups("follower") : tGroups("followers")
        }`
      : "";

  return (
    <div style={cardStyles}>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "9 / 10",
          borderRadius: 0,
          overflow: "hidden",
          background: "#0d0d0f",
          boxShadow: "none",
          transform: "translateZ(0)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: profile.coverUrl
              ? `url(${profile.coverUrl}) center / cover no-repeat`
              : "linear-gradient(135deg, #1a1a20 0%, #26262e 55%, #111116 100%)",
            transform: "scale(1.01)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.18) 28%, rgba(0,0,0,0.62) 58%, rgba(0,0,0,0.70) 80%, rgba(0,0,0,0.80) 100%)",
          }}
        />
        {/* Avatar con aro de historias — fuera del Link para evitar button dentro de <a> */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2,
            filter: "drop-shadow(0 8px 22px rgba(0,0,0,0.50))",
          }}
        >
          <LiveRingAvatar
            entityId={profile.uid}
            entityType="profile"
            currentUserId={currentUserId}
            photoURL={profile.avatarUrl}
            displayName={profile.displayName}
            size={68}
            onClick={() => router.push(`/u/${profile.handle}`)}
          />
        </div>

        <Link
          href={`/u/${profile.handle}`}
          style={{
            position: "absolute",
            inset: 0,
            bottom: 52,
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "14px 12px 0",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          {/* Spacer que ocupa el lugar del avatar para mantener el layout del texto */}
          <div style={{ width: 68, height: 68, flexShrink: 0 }} />
          <div
            style={{
              marginTop: 10,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingBottom: 6,
            }}
          >
            <strong
              style={{
                fontSize: 14,
                lineHeight: 1.18,
                color: "#fff",
                maxWidth: "100%",
                wordBreak: "break-word",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textAlign: "center",
                fontFamily: fontStack,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                flexShrink: 0,
              }}
            >
              {profile.displayName}
            </strong>
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.72)",
                fontFamily: fontStack,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {`@${profile.handle}`}
            </div>
            <div
              style={{
                marginTop: 3,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.52)",
                fontFamily: fontStack,
                fontWeight: 400,
                flexShrink: 0,
              }}
            >
              {followersLabel}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.88)",
                fontFamily: fontStack,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {profile.hasActiveServices ? tGroups("offersServices") : ""}
            </div>
          </div>
        </Link>
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            right: 10,
            zIndex: 2,
          }}
        >
          <FollowButton
            isFollowing={isFollowing}
            onClick={onFollow}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}

function GroupCard({
  group,
  joinState,
  loading,
  onJoin,
  currentUserId,
}: {
  group: RecommendationGroupCard;
  joinState: RecommendationJoinState;
  loading: boolean;
  onJoin: () => void;
  currentUserId: string | null;
}) {
  const tGroups = useTranslations("groups");
  const { format: formatMoney } = usePriceFormat();
  const router = useRouter();
  const categoryLabel = group.category
    ? GROUP_CATEGORY_LABELS[group.category]
    : tGroups("noCategory");

  const visibilityLabel =
    group.visibility === "public"
      ? tGroups("publicLabel")
      : group.visibility === "private"
        ? tGroups("privateLabel")
        : tGroups("hiddenLabel");

  const isPaidSubscriptionPrivate =
    group.visibility === "private" && resolveSubscriptionEnabled(group);

  const subscriptionPrice = isPaidSubscriptionPrivate
    ? resolveSubscriptionPrice(group)
    : null;
  const subscriptionCurrency = resolveSubscriptionCurrency(group);
  const subscriptionPriceLabel =
    subscriptionPrice != null
      ? formatMoney(subscriptionPrice, {
          baseCurrency: isDisplayCurrency(subscriptionCurrency)
            ? subscriptionCurrency
            : "MXN",
          code: true,
        })
      : null;

  return (
    <div style={cardStyles}>
      {/* Cover card — the card IS the image, no gray wrapper */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "9 / 10",
          borderRadius: 0,
          overflow: "hidden",
          background: "#0d0d0f",
          boxShadow: "none",
          transform: "translateZ(0)",
        }}
      >
        {/* Cover image / gradient background */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: group.coverUrl
              ? `url(${group.coverUrl}) center / cover no-repeat`
              : "linear-gradient(135deg, #1a1a20 0%, #26262e 55%, #111116 100%)",
            transform: "scale(1.01)",
          }}
        />

        {/* Gradient overlay — stronger at the bottom for text + button legibility */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.18) 28%, rgba(0,0,0,0.62) 58%, rgba(0,0,0,0.70) 80%, rgba(0,0,0,0.80) 100%)",
          }}
        />

        {/* Avatar con aro de historias — fuera del Link para evitar button dentro de <a> */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2,
            filter: "drop-shadow(0 8px 22px rgba(0,0,0,0.50))",
          }}
        >
          <LiveRingAvatar
            entityId={group.id}
            entityType="group"
            currentUserId={currentUserId}
            photoURL={group.avatarUrl}
            displayName={group.name}
            size={68}
            onClick={() => router.push(`/groups/${group.id}`)}
          />
        </div>

        {/* Navigable area — full card minus button zone */}
        <Link
          href={`/groups/${group.id}`}
          style={{
            position: "absolute",
            inset: 0,
            bottom: 52,
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "14px 12px 0",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          {/* Spacer que ocupa el lugar del avatar para mantener el layout del texto */}
          <div style={{ width: 68, height: 68, flexShrink: 0 }} />

          {/* Name + meta — tight gap below avatar */}
          <div
            style={{
              marginTop: 10,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingBottom: 6,
            }}
          >
            {/* Name — max 2 lines, natural height */}
            <strong
              style={{
                fontSize: 14,
                lineHeight: 1.18,
                color: "#fff",
                maxWidth: "100%",
                wordBreak: "break-word",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textAlign: "center",
                fontFamily: fontStack,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                flexShrink: 0,
              }}
            >
              {group.name}
            </strong>

            {/* Visibility — always 1 line tall */}
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.72)",
                fontFamily: fontStack,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {visibilityLabel}
            </div>

            {/* Category — always 1 line tall */}
            <div
              style={{
                marginTop: 3,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.52)",
                fontFamily: fontStack,
                fontWeight: 400,
                flexShrink: 0,
              }}
            >
              {categoryLabel}
            </div>

            {/* Price — always 1 line tall, empty when free */}
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.88)",
                fontFamily: fontStack,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {subscriptionPriceLabel ? `${subscriptionPriceLabel} ${tGroups("perMonth")}` : ""}
            </div>
          </div>
        </Link>

        {/* Join button — floats at the bottom of the card, above the Link */}
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            right: 10,
            zIndex: 2,
          }}
        >
          <JoinButton
            state={joinState}
            onClick={onJoin}
            loading={loading}
            isPaidSubscriptionPrivate={isPaidSubscriptionPrivate}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Live Recommendations ────────────────────────────────────────────────────

type LiveRec = {
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
  // Recomendación de lives: categorías (afinidad), inicio (recencia), espectadores.
  categories?: CanonicalGroupCategory[];
  startedAtMs?: number;
  viewers?: number;
};

type LiveActionState = "none" | "following" | "joined" | "pending";

function LiveCTAButton({
  rec,
  state,
  loading,
  onClick,
}: {
  rec: LiveRec;
  state: LiveActionState;
  loading: boolean;
  onClick: () => void;
}) {
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("groups");

  let label: string;
  if (rec.groupId) {
    if (state === "joined") label = tGroups("joined");
    else if (state === "pending") label = tGroups("requestSent");
    else if (rec.groupVisibility === "private" && rec.subscriptionEnabled) label = tGroups("subscribe");
    else if (rec.groupVisibility === "private") label = tGroups("requestAccess");
    else label = tGroups("join");
  } else {
    label = state === "following" ? tCommon("unfollow") : tCommon("follow");
  }

  const inactive = loading || state === "joined" || state === "pending" || state === "following";
  const isPaidSub = !inactive && rec.groupId && rec.groupVisibility === "private" && rec.subscriptionEnabled;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={inactive}
      style={{
        width: "100%",
        borderRadius: 10,
        padding: "7px 12px",
        border: inactive ? "1px solid rgba(255,255,255,0.18)" : "none",
        fontWeight: 600,
        fontSize: 13,
        letterSpacing: "-0.01em",
        cursor: inactive ? "default" : "pointer",
        background: inactive
          ? "rgba(255,255,255,0.14)"
          : isPaidSub
            ? "#70aefb"
            : "linear-gradient(135deg, #ec4899, #9333ea)",
        color: inactive ? "rgba(255,255,255,0.70)" : "#fff",
        fontFamily: fontStack,
        backdropFilter: inactive ? "blur(12px)" : "none",
        WebkitBackdropFilter: inactive ? "blur(12px)" : "none",
        transition: "opacity 150ms ease",
      }}
    >
      {loading ? tCommon("processing") : label}
    </button>
  );
}

function LiveRecommendationCard({
  rec,
  currentUserId,
  actionState,
  actionLoading,
  onOpenViewer,
  onAction,
}: {
  rec: LiveRec;
  currentUserId: string;
  actionState: LiveActionState;
  actionLoading: boolean;
  onOpenViewer: () => void;
  onAction: () => void;
}) {
  const tGroups = useTranslations("groups");
  const coverImage = rec.liveCoverUrl ?? rec.coverUrl;
  return (
    <div style={cardStyles}>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "9 / 10",
          borderRadius: 0,
          overflow: "hidden",
          background: "#0d0d0f",
          boxShadow: "none",
          transform: "translateZ(0)",
        }}
      >
        {/* Cover — live cover preferido, fallback perfil/comunidad */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: coverImage
              ? `url(${coverImage}) center / cover no-repeat`
              : "linear-gradient(135deg, #3b1010 0%, #1a0808 55%, #0d0505 100%)",
            transform: "scale(1.01)",
          }}
        />
        {/* Gradient */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(239,68,68,0.10) 0%, rgba(0,0,0,0.20) 30%, rgba(0,0,0,0.65) 58%, rgba(0,0,0,0.70) 82%, rgba(0,0,0,0.80) 100%)",
          }}
        />

        {/* Avatar con aro de live */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2,
            filter: "drop-shadow(0 8px 22px rgba(0,0,0,0.50))",
          }}
        >
          <LiveRingAvatar
            entityId={rec.groupId ?? rec.authorId}
            entityType={rec.groupId ? "group" : "profile"}
            currentUserId={currentUserId}
            photoURL={rec.avatarUrl}
            displayName={rec.displayName}
            size={68}
            onClick={onOpenViewer}
          />
        </div>

        {/* Clickable body — opens viewer */}
        <button
          type="button"
          onClick={onOpenViewer}
          style={{
            position: "absolute",
            inset: 0,
            bottom: 52,
            zIndex: 1,
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "14px 12px 0",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <div style={{ width: 68, height: 68, flexShrink: 0 }} />
          <div
            style={{
              marginTop: 10,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingBottom: 6,
            }}
          >
            <strong
              style={{
                fontSize: 14,
                lineHeight: 1.18,
                color: "#fff",
                maxWidth: "100%",
                wordBreak: "break-word",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textAlign: "center",
                fontFamily: fontStack,
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              {rec.displayName}
            </strong>
            {rec.liveTitle && (
              <div
                style={{
                  marginTop: 5,
                  fontSize: 11,
                  lineHeight: "14px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                  color: "rgba(255,255,255,0.65)",
                  fontFamily: fontStack,
                  fontWeight: 400,
                }}
              >
                {rec.liveTitle}
              </div>
            )}
            <div
              style={{
                marginTop: 7,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "#ef4444",
                padding: "4px 8px 4px 6px",
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                color: "#fff",
                letterSpacing: "0.06em",
                fontFamily: fontStack,
              }}
            >
              <svg
                width="10" height="10" viewBox="0 0 22 22" fill="none"
                style={{ animation: "lrRecPulse 1.4s ease-in-out infinite" }}
              >
                <circle cx="11" cy="11" r="10" stroke="#fff" strokeWidth="1.4" fill="none" />
                <circle cx="11" cy="11" r="6" fill="#fff" />
              </svg>
              {tGroups("liveLabel")}
              <style>{`@keyframes lrRecPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.7;transform:scale(.88)}}`}</style>
            </div>
          </div>
        </button>

        {/* CTA */}
        <div style={{ position: "absolute", bottom: 10, left: 10, right: 10, zIndex: 2 }}>
          <LiveCTAButton
            rec={rec}
            state={actionState}
            loading={actionLoading}
            onClick={onAction}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRail() {
  return (
    <>
      <style>{`
        @keyframes vibraRecsSkeleton {
          0%,100% { opacity: 0.38; }
          50%      { opacity: 0.65; }
        }
      `}</style>
      <div
        style={{
          display: "flex",
          gap: 12,
          overflowX: "hidden",
          paddingBottom: 6,
          paddingLeft: 12,
          paddingRight: 12,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ minWidth: 200, maxWidth: 200, flexShrink: 0 }}>
            <div
              style={{
                width: "100%",
                aspectRatio: "9 / 10",
                borderRadius: 0,
                background: "rgba(255,255,255,0.07)",
                animation: `vibraRecsSkeleton 1.6s ease-in-out ${i * 0.18}s infinite`,
              }}
            />
          </div>
        ))}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function GroupRecommendationsRail({
  currentUserId,
  onCreateGroup,
  className,
  onboardingOnly = false,
  suppressOnboarding = false,
  railIndex = 0,
}: Props) {
  const router = useRouter();
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");
  const [selectedCategories, setSelectedCategories] = useState<
    CanonicalGroupCategory[]
  >([]);
  const [result, setResult] = useState<RecommendationFetchResult | null>(() => getCachedResult(currentUserId));
  const [loading, setLoading] = useState<boolean>(() => !getCachedResult(currentUserId));
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Paginación del selector: dos renglones completos por página (columnas × 2),
  // según cuántas columnas quepan realmente en el grid.
  const [interestsPage, setInterestsPage] = useState(0);
  const [interestsDirection, setInterestsDirection] = useState(1);
  const [interestsGridEl, setInterestsGridEl] = useState<HTMLDivElement | null>(null);
  const [interestsColumns, setInterestsColumns] = useState(4);
  const [interestsContainerWidth, setInterestsContainerWidth] = useState(0);
  // Animación final: al confirmar, los contenedores elegidos hacen pop y todo
  // el panel (incluido el título) se "consume".
  const [celebrating, setCelebrating] = useState(false);
  // Carrusel de recomendaciones. En desktop se pagina (sin scroll) mostrando
  // solo las cards completas que quepan; en celular se mantiene el scroll.
  const [railPage, setRailPage] = useState(0);
  const [railDirection, setRailDirection] = useState(1);
  const [isDesktopRail, setIsDesktopRail] = useState(false);
  const [joinStates, setJoinStates] = useState<
    Record<string, RecommendationJoinState>
  >({});
  const [joinLoadingByGroup, setJoinLoadingByGroup] = useState<
    Record<string, boolean>
  >({});
  const [profileCards, setProfileCards] = useState<RecommendationProfileCard[]>(() => peekProfiles(currentUserId) ?? []);
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({});
  const [followLoadingByProfile, setFollowLoadingByProfile] = useState<
    Record<string, boolean>
  >({});

  // Live recommendations
  const [liveRecs, setLiveRecs] = useState<LiveRec[]>([]);
  const [viewingPost, setViewingPost] = useState<Post | null>(null);
  const [liveActionStates, setLiveActionStates] = useState<Record<string, LiveActionState>>({});
  const [liveActionLoading, setLiveActionLoading] = useState<Record<string, boolean>>({});
  const followingIdsRef = useRef<Set<string>>(new Set());
  const memberGroupIdsRef = useRef<Set<string>>(new Set());

  const minCategories = recommendationEngineConstants.MIN_ONBOARDING_CATEGORIES;

  const loadRecommendations = useCallback(async () => {
    if (!currentUserId) {
      setResult(null);
      setJoinStates({});
      setSelectedCategories([]);
      setProfileCards([]);
      setFollowStates({});
      setLoading(false);
      setError(null);
      return;
    }

    if (!getCachedResult(currentUserId)) setLoading(true);
    setError(null);

    try {
      const [next, profiles] = await Promise.all([
        fetchRecommendedGroupsForUser(currentUserId),
        fetchRecommendedProfilesForUser(currentUserId).catch(() => [] as RecommendationProfileCard[]),
      ]);
      setResult(next);
      setSelectedCategories(next.selectedCategories);
      profileCache.set(currentUserId, { profiles, cachedAt: Date.now() });
      setProfileCards(profiles);
      setFollowStates(Object.fromEntries(profiles.map((p) => [p.uid, false])));

      if (next.groups.length > 0) {
        const entries = await Promise.all(
          next.groups.map(async (group) => {
            const state = await resolveJoinState(
              group.id,
              currentUserId,
              group.visibility
            );
            return [group.id, state] as const;
          })
        );

        setJoinStates(Object.fromEntries(entries));
      } else {
        setJoinStates({});
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tGroups("recsLoadError")
      );
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    void loadRecommendations();
  }, [loadRecommendations]);

  // Ref that always points to the latest loadRecommendations — used in the
  // cache-invalidation subscription so we don't need to re-register on every render
  const loadRecommendationsRef = useRef(loadRecommendations);
  loadRecommendationsRef.current = loadRecommendations;

  // When any Rail instance invalidates the shared cache, all instances re-fetch
  useEffect(() => {
    return onRecommendationCacheInvalidated(() => {
      void loadRecommendationsRef.current();
    });
  }, []);

  // Suscripción en tiempo real a lives públicos activos no seguidos/miembros
  useEffect(() => {
    if (!currentUserId) return;
    let unsubLives: (() => void) | null = null;
    let cancelled = false;
    let snapGen = 0;

    async function init() {
      try {
        const [followSnap, memberSnap] = await Promise.all([
          getDocs(query(collection(db, "users", currentUserId, "following"), limit(100))),
          getDocs(collection(db, "users", currentUserId, "groupMemberships")),
        ]);
        if (cancelled) return;

        followingIdsRef.current = new Set(
          followSnap.docs.map((d) => (d.data().targetUserId as string) ?? d.id),
        );
        memberGroupIdsRef.current = new Set(
          memberSnap.docs
            .filter((d) => ["active", "subscribed"].includes(d.data().status as string))
            .map((d) => d.id),
        );
      } catch {
        // non-fatal
      }
      if (cancelled) return;

      // Vector de gustos (una vez por montaje) para rankear lives por afinidad.
      let taste: Map<CanonicalGroupCategory, number> = new Map();
      try {
        taste = await getUserTasteVector(currentUserId);
      } catch {
        // sin señales → ranking por populares
      }
      if (cancelled) return;

      const startedMs = (ld: Record<string, unknown>): number => {
        const s = ld.startedAt as
          | { toMillis?: () => number; seconds?: number }
          | null;
        if (s && typeof s.toMillis === "function") return s.toMillis();
        if (s && typeof s.seconds === "number") return s.seconds * 1000;
        return 0;
      };

      const q = query(
        collection(db, "posts"),
        where("liveData.status", "==", "live"),
        limit(40),
      );

      unsubLives = onSnapshot(q, async (snap) => {
        if (cancelled) return;
        const myGen = ++snapGen;

        const filtered = snap.docs
          .map((d): Record<string, unknown> => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
          .filter((post) => {
            const ld = post.liveData as Record<string, unknown> | null;
            if (!ld || ld.visibilityMode !== "everyone") return false;
            // Solo EN CURSO: debe haber iniciado (startedAt) y no haber terminado
            // (endedAt). Excluye programados/"upcoming" y terminados aunque el
            // status haya quedado en "live".
            if (!ld.startedAt || ld.endedAt) return false;
            // Transmisiones directas (browser): exige heartbeat reciente para no
            // mostrar lives huérfanos que el cleanup aún no haya cerrado.
            if (ld.broadcastMode === "direct") {
              const hb = ld.heartbeatAt as
                | { toMillis?: () => number; seconds?: number }
                | null;
              const hbMs =
                hb && typeof hb.toMillis === "function"
                  ? hb.toMillis()
                  : hb && typeof hb.seconds === "number"
                    ? hb.seconds * 1000
                    : 0;
              if (!hbMs || Date.now() - hbMs > 120000) return false;
            }
            if (post.authorId === currentUserId) return false;
            const gid = post.groupId as string | undefined;
            if (!gid && followingIdsRef.current.has(post.authorId as string)) return false;
            if (gid && memberGroupIdsRef.current.has(gid)) return false;
            return true;
          });

        if (filtered.length === 0) { setLiveRecs([]); return; }

        const authorIds = [...new Set(
          filtered.filter((p) => !p.groupId).map((p) => p.authorId as string),
        )];
        const gids = [...new Set(
          filtered.filter((p) => !!p.groupId).map((p) => p.groupId as string),
        )];

        const [authorDocs, groupDocs] = await Promise.all([
          authorIds.length > 0
            ? getDocs(query(collection(db, "users"), where(documentId(), "in", authorIds.slice(0, 30))))
            : Promise.resolve({ docs: [] as typeof snap.docs }),
          gids.length > 0
            ? getDocs(query(collection(db, "groups"), where(documentId(), "in", gids.slice(0, 30))))
            : Promise.resolve({ docs: [] as typeof snap.docs }),
        ]);
        if (cancelled || myGen !== snapGen) return;

        const userMap = new Map(authorDocs.docs.map((d) => [d.id, d.data()]));
        const groupMap = new Map(groupDocs.docs.map((d) => [d.id, d.data()]));

        const recs: LiveRec[] = filtered.map((post) => {
          const ld = post.liveData as Record<string, unknown>;
          const gid = post.groupId as string | undefined;
          if (gid) {
            const g = (groupMap.get(gid) ?? {}) as Record<string, unknown>;
            const mon = (g.monetization ?? {}) as Record<string, unknown>;
            // Categoría del live = categoría de la comunidad.
            const gcat = normalizeGroupCategory(g.category);
            return {
              postId: post.id as string,
              authorId: post.authorId as string,
              groupId: gid,
              liveCoverUrl: (ld.coverUrl as string | null) ?? null,
              liveTitle: (ld.title as string | null) ?? null,
              displayName: (g.name as string) ?? tCommon("communityLabel"),
              avatarUrl: (g.avatarUrl as string | null) ?? null,
              coverUrl: (g.coverUrl as string | null) ?? null,
              groupVisibility: (g.visibility as string | null) ?? null,
              subscriptionEnabled: mon.subscriptionsEnabled === true || mon.isPaid === true,
              categories: gcat ? [gcat] : [],
              startedAtMs: startedMs(ld),
            };
          } else {
            const u = (userMap.get(post.authorId as string) ?? {}) as Record<string, unknown>;
            // Categoría del live = intereses del creador.
            const ucats = Array.isArray(u.interests)
              ? (u.interests
                  .map((v) => normalizeGroupCategory(v))
                  .filter((c): c is CanonicalGroupCategory => !!c))
              : [];
            return {
              postId: post.id as string,
              authorId: post.authorId as string,
              groupId: null,
              liveCoverUrl: (ld.coverUrl as string | null) ?? null,
              liveTitle: (ld.title as string | null) ?? null,
              displayName: (u.displayName as string) ?? (u.username as string) ?? tCommon("user"),
              avatarUrl: (u.photoURL as string | null) ?? null,
              coverUrl: (u.coverPhotoURL as string | null) ?? null,
              handle: (u.handle as string | null) ?? null,
              categories: ucats,
              startedAtMs: startedMs(ld),
            };
          }
        });

        // Espectadores actuales de cada live (para rankear los "calientes").
        const withViewers = await Promise.all(
          recs.map(async (r) => {
            let viewers = 0;
            try {
              const c = await getCountFromServer(
                collection(db, "posts", r.postId, "liveViewers"),
              );
              viewers = c.data().count;
            } catch {
              // sin conteo → 0
            }
            return { ...r, viewers };
          }),
        );
        if (cancelled || myGen !== snapGen) return;

        // Ranking: afinidad de categoría + espectadores + recencia.
        // Frío total (sin señales) → por más espectadores (populares).
        const hasTaste = taste.size > 0;
        const nowMs = Date.now();
        const ranked = withViewers
          .map((r) => {
            let affinity = 0;
            for (const cat of r.categories ?? []) {
              affinity = Math.max(affinity, taste.get(cat) ?? 0);
            }
            const ageMin = r.startedAtMs ? (nowMs - r.startedAtMs) / 60000 : 999;
            const recency = Math.max(0, 1 - ageMin / 180); // decae en ~3h
            const popularity = Math.log1p(r.viewers ?? 0);
            const score = hasTaste
              ? affinity * 3 + popularity * 1.5 + recency * 1
              : popularity * 3 + recency * 1;
            return { r, score };
          })
          .sort((a, b) => b.score - a.score)
          .map((e) => e.r);

        setLiveRecs(ranked);
        setLiveActionStates((prev) => {
          const next = { ...prev };
          for (const r of ranked) if (!next[r.postId]) next[r.postId] = "none";
          return next;
        });
      });
    }

    void init();
    return () => {
      cancelled = true;
      if (unsubLives) unsubLives();
    };
  }, [currentUserId]);

  const toggleCategory = (category: CanonicalGroupCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((item) => item !== category)
        : [...prev, category]
    );
  };

  const handleSaveOnboarding = async () => {
    if (!currentUserId) return;

    setSavingOnboarding(true);
    setError(null);

    try {
      completeRecommendationsOnboarding(currentUserId, selectedCategories);
      // Unificación: las mismas categorías se guardan como intereses del perfil
      // (uso interno: alimentan búsqueda por categoría y recomendaciones de perfiles).
      // Fire-and-forget: no debe bloquear el flujo de recomendaciones.
      void updateProfileInterests(selectedCategories).catch(() => {
        /* silencioso: las preferencias locales ya se guardaron */
      });
      // Invalidate shared cache so all Rail instances on this page pick up the new state
      invalidateRecommendationCache(currentUserId);
      // loadRecommendations will be triggered automatically by the invalidation listener
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tGroups("saveSelectionError")
      );
    } finally {
      setSavingOnboarding(false);
    }
  };

  // Confirmar: dispara la animación de "consumir" y, al terminar, guarda.
  const handleFinish = () => {
    if (
      savingOnboarding ||
      celebrating ||
      selectedCategories.length < minCategories
    ) {
      return;
    }
    setCelebrating(true);
    // Guarda al terminar la celebración: la duración depende de cuántas
    // categorías se eligieron, así que sale de celebTimings y no de un número fijo.
    window.setTimeout(
      () => {
        handleSaveOnboarding();
      },
      celebTimings(selectedCategories.length).total * 1000
    );
  };


  const handleJoin = async (group: RecommendationGroupCard) => {
    if (!currentUserId) return;

    setJoinLoadingByGroup((prev) => ({ ...prev, [group.id]: true }));
    setError(null);

    try {
      const isPaidSubscriptionPrivate =
        group.visibility === "private" && resolveSubscriptionEnabled(group);

      if (group.visibility === "public") {
        await joinGroup(group.id, currentUserId);
        setJoinStates((prev) => ({ ...prev, [group.id]: "joined" }));
      } else if (isPaidSubscriptionPrivate) {
        router.push(`/groups/${group.id}?service=suscripcion`);
        return;
      } else if (group.visibility === "private") {
        await requestToJoin(group.id, currentUserId);
        setJoinStates((prev) => ({ ...prev, [group.id]: "pending" }));
      }

      trackGroupRecommendationSignalFromGroup({
        uid: currentUserId,
        category: group.category,
        tags: group.tags,
      });

      // Invalidate cache so all Rail instances exclude this group on next fetch
      invalidateRecommendationCache(currentUserId);

      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : tGroups("actionError");

      if (message === "GROUP_REQUIRES_SUBSCRIPTION") {
        router.push(`/groups/${group.id}?service=suscripcion`);
        return;
      }

      setError(message);
    } finally {
      setJoinLoadingByGroup((prev) => ({ ...prev, [group.id]: false }));
    }
  };

  const handleOpenLiveViewer = async (postId: string) => {
    try {
      const snap = await getDoc(doc(db, "posts", postId));
      if (snap.exists()) setViewingPost({ id: snap.id, ...snap.data() } as Post);
    } catch { /* silencioso */ }
  };

  const handleLiveAction = async (rec: LiveRec) => {
    if (!currentUserId) return;
    setLiveActionLoading((prev) => ({ ...prev, [rec.postId]: true }));
    try {
      if (rec.groupId) {
        const isPaidPrivate = rec.groupVisibility === "private" && rec.subscriptionEnabled;
        if (isPaidPrivate) {
          router.push(`/groups/${rec.groupId}?service=suscripcion`);
          return;
        } else if (rec.groupVisibility === "public") {
          await joinGroup(rec.groupId, currentUserId);
          setLiveActionStates((prev) => ({ ...prev, [rec.postId]: "joined" }));
        } else {
          await requestToJoin(rec.groupId, currentUserId);
          setLiveActionStates((prev) => ({ ...prev, [rec.postId]: "pending" }));
        }
      } else {
        await followUser({ currentUserId, targetUserId: rec.authorId });
        setLiveActionStates((prev) => ({ ...prev, [rec.postId]: "following" }));
        followingIdsRef.current.add(rec.authorId);
      }
    } catch { /* silencioso */ } finally {
      setLiveActionLoading((prev) => ({ ...prev, [rec.postId]: false }));
    }
  };

  const handleFollow = async (profile: RecommendationProfileCard) => {
    if (!currentUserId) return;
    setFollowLoadingByProfile((prev) => ({ ...prev, [profile.uid]: true }));
    setError(null);
    try {
      await followUser({ currentUserId, targetUserId: profile.uid });
      setFollowStates((prev) => ({ ...prev, [profile.uid]: true }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tGroups("followError")
      );
    } finally {
      setFollowLoadingByProfile((prev) => ({ ...prev, [profile.uid]: false }));
    }
  };

  const mergedRailItems = useMemo((): RailItem[] => {
    if (!result?.onboardingCompleted || result.groups.length === 0) return [];
    const items: RailItem[] = [];
    let profileIdx = 0;
    result.groups.forEach((group, i) => {
      items.push({ type: "group", data: group });
      if ((i + 1) % 3 === 0 && profileIdx < profileCards.length) {
        items.push({ type: "profile", data: profileCards[profileIdx++] });
      }
    });
    while (profileIdx < profileCards.length) {
      items.push({ type: "profile", data: profileCards[profileIdx++] });
    }
    return items;
  }, [result, profileCards]);

  // Todas las cards del rail en un solo orden (lives primero), para paginar.
  const allRailCards = useMemo<RailCard[]>(() => {
    const cards: RailCard[] = liveRecs.map((rec) => ({ kind: "live", rec }));
    if (!loading && result?.onboardingCompleted) {
      for (const item of mergedRailItems) {
        if (item.type === "group") cards.push({ kind: "group", group: item.data });
        else cards.push({ kind: "profile", profile: item.data });
      }
    }
    return cards;
  }, [liveRecs, loading, result, mergedRailItems]);

  // Cada aparición del rail en el feed muestra algo distinto: se rota la lista
  // para que empiece en otro punto; si aún no hay suficiente contenido para una
  // ventana distinta, se cambia el orden de las cards.
  const variantRailCards = useMemo(() => {
    if (railIndex <= 0 || allRailCards.length === 0) return allRailCards;
    if (allRailCards.length <= RAIL_PER_PAGE) {
      return seededShuffle(allRailCards, `rail-${railIndex}`);
    }
    const offset = (railIndex * RAIL_PER_PAGE) % allRailCards.length;
    return [...allRailCards.slice(offset), ...allRailCards.slice(0, offset)];
  }, [allRailCards, railIndex]);

  // Mide cuántas columnas caben en el grid para paginar en renglones completos.
  useEffect(() => {
    if (!interestsGridEl || typeof ResizeObserver === "undefined") return;
    const compute = () => {
      const w = interestsGridEl.clientWidth;
      if (w <= 0) return;
      const cols = Math.max(
        1,
        Math.floor(
          (w + INTEREST_GRID_GAP) / (INTEREST_GRID_MIN_COL + INTEREST_GRID_GAP)
        )
      );
      setInterestsColumns(cols);
      setInterestsContainerWidth(w);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(interestsGridEl);
    return () => ro.disconnect();
  }, [interestsGridEl]);

  // El rail se pagina solo en laptop/desktop; en celular queda con scroll.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 901px)");
    const apply = () => setIsDesktopRail(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const showOnboarding = useMemo(() => {
    return !suppressOnboarding && !loading && result && !result.onboardingCompleted;
  }, [suppressOnboarding, loading, result]);

  // Paginación derivada del selector de categorías (dos renglones por página).
  const interestsPerPage = Math.max(1, interestsColumns * 2);
  const interestPageCount = Math.ceil(
    GROUP_CATEGORY_OPTIONS.length / interestsPerPage
  );
  const interestPage = Math.min(
    interestsPage,
    Math.max(0, interestPageCount - 1)
  );
  const interestPageOptions = GROUP_CATEGORY_OPTIONS.slice(
    interestPage * interestsPerPage,
    (interestPage + 1) * interestsPerPage
  );
  const isLastInterestPage = interestPage >= interestPageCount - 1;

  // Altura exacta del grid de la página actual (renglones × alto de tarjeta),
  // para animarla suave cuando la última página tiene menos renglones y así los
  // botones suben fluido en vez de saltar.
  const interestRows = Math.max(
    1,
    Math.ceil(interestPageOptions.length / interestsColumns)
  );
  const interestColWidth =
    interestsContainerWidth > 0
      ? (interestsContainerWidth - (interestsColumns - 1) * INTEREST_GRID_GAP) /
        interestsColumns
      : 0;
  const interestsGridHeight =
    interestColWidth > 0
      ? interestRows * interestColWidth + (interestRows - 1) * INTEREST_GRID_GAP
      : undefined;

  const selectedOptions = useMemo(
    () => GROUP_CATEGORY_OPTIONS.filter((o) => selectedCategories.includes(o.value)),
    [selectedCategories]
  );

  // El texto y los botones se van justo cuando empiezan a salir los avatares.
  const chromeFade = celebrating
    ? {
        delay: celebTimings(selectedOptions.length).outStart,
        duration: 0.55,
        ease: "easeOut" as const,
      }
    : { duration: 0.2 };

  // Paginación del rail en desktop: 3 por renglón.
  const railPerPage = RAIL_PER_PAGE;
  const railPageCount = Math.max(
    1,
    Math.ceil(variantRailCards.length / railPerPage)
  );
  const railPageClamped = Math.min(railPage, railPageCount - 1);
  const railPageCards = variantRailCards.slice(
    railPageClamped * railPerPage,
    (railPageClamped + 1) * railPerPage
  );

  // Precarga las imágenes de la página SIGUIENTE del rail, para que al avanzar
  // se vean de inmediato (portada + avatar de cada card).
  useEffect(() => {
    if (!isDesktopRail || typeof window === "undefined") return;
    const start = (railPageClamped + 1) * railPerPage;
    const next = variantRailCards.slice(start, start + railPerPage);
    for (const card of next) {
      const urls =
        card.kind === "live"
          ? [card.rec.liveCoverUrl, card.rec.coverUrl, card.rec.avatarUrl]
          : card.kind === "group"
            ? [card.group.coverUrl, card.group.avatarUrl]
            : [card.profile.coverUrl, card.profile.avatarUrl];
      for (const url of urls) {
        if (url) {
          const img = new window.Image();
          img.src = url;
        }
      }
    }
  }, [isDesktopRail, railPageClamped, railPerPage, variantRailCards]);

  // "Ver más": desliza a la izquierda y entran nuevas recomendaciones.
  const handleRailMore = () => {
    if (railPageClamped >= railPageCount - 1) return;
    setRailDirection(1);
    setRailPage(railPageClamped + 1);
  };

  // "Regresar": vuelve a las sugerencias anteriores (desliza al revés).
  const handleRailBack = () => {
    if (railPageClamped <= 0) return;
    setRailDirection(-1);
    setRailPage(railPageClamped - 1);
  };

  const renderRailCard = (card: RailCard) => {
    // Desktop: se encoge si hace falta para que quepan 3, pero nunca crece más
    // de RAIL_CARD_W. Celular: ancho fijo + snap (como antes).
    const wrapperStyle: React.CSSProperties = isDesktopRail
      ? { flex: "1 1 0", minWidth: 0, maxWidth: RAIL_CARD_W }
      : {
          minWidth: RAIL_CARD_W,
          maxWidth: RAIL_CARD_W,
          flexShrink: 0,
          scrollSnapAlign: "start",
        };

    if (card.kind === "live") {
      return (
        <div key={`live-${card.rec.postId}`} style={wrapperStyle}>
          <LiveRecommendationCard
            rec={card.rec}
            currentUserId={currentUserId}
            actionState={liveActionStates[card.rec.postId] ?? "none"}
            actionLoading={Boolean(liveActionLoading[card.rec.postId])}
            onOpenViewer={() => void handleOpenLiveViewer(card.rec.postId)}
            onAction={() => void handleLiveAction(card.rec)}
          />
        </div>
      );
    }
    if (card.kind === "group") {
      return (
        <div key={`group-${card.group.id}`} style={wrapperStyle}>
          <GroupCard
            group={card.group}
            joinState={joinStates[card.group.id] ?? "join"}
            loading={Boolean(joinLoadingByGroup[card.group.id])}
            onJoin={() => handleJoin(card.group)}
            currentUserId={currentUserId}
          />
        </div>
      );
    }
    return (
      <div key={`profile-${card.profile.uid}`} style={wrapperStyle}>
        <ProfileCard
          profile={card.profile}
          isFollowing={followStates[card.profile.uid] ?? false}
          loading={Boolean(followLoadingByProfile[card.profile.uid])}
          onFollow={() => handleFollow(card.profile)}
          currentUserId={currentUserId}
        />
      </div>
    );
  };

  // Precarga las imágenes de la página SIGUIENTE mientras se ven las actuales,
  // para que al deslizar ya estén cargadas (sin parpadeo). `window.Image` porque
  // aquí `Image` es el componente de next/image.
  useEffect(() => {
    if (!showOnboarding || typeof window === "undefined") return;
    const start = (interestPage + 1) * interestsPerPage;
    GROUP_CATEGORY_OPTIONS.slice(start, start + interestsPerPage).forEach((o) => {
      const src = CATEGORY_IMAGE[o.value];
      if (src) {
        const img = new window.Image();
        img.src = src;
      }
    });
  }, [showOnboarding, interestPage, interestsPerPage]);

  if (!currentUserId) {
    return null;
  }

  // Modo "solo selector": no renderiza nada salvo el selector de onboarding.
  // (Mientras carga o si el onboarding ya está completo, no muestra nada.)
  if (onboardingOnly && !showOnboarding) {
    return null;
  }

  return (
    <section
      className={className}
      style={{ width: "100%", color: "#fff" }}
    >
      {error ? (
        <div
          style={{
            marginBottom: 12,
            borderRadius: 12,
            background: "rgba(255, 80, 80, 0.12)",
            border: "1px solid rgba(255, 80, 80, 0.25)",
            padding: 12,
            fontSize: 13,
            fontFamily: fontStack,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? <SkeletonRail /> : null}

      {showOnboarding ? (
        <motion.div
          initial={false}
          style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 28, marginBottom: 28 }}
        >
          <style>{`
            .vibInterestsGradient {
              background: linear-gradient(100deg, #ff2fb3 0%, #a855ff 45%, #4f46ff 100%);
              background-size: 220% 220%;
              -webkit-background-clip: text;
              background-clip: text;
              color: transparent;
              animation: vibInterestsFlow 4.5s ease-in-out infinite;
            }
            @keyframes vibInterestsFlow {
              0%, 100% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
            }
            .vibCatIcon { will-change: transform; }
            .vibCatCard:hover .vibCatIcon { transform: scale(1.08); }
          `}</style>
          <motion.div
            initial={false}
            animate={celebrating ? { opacity: 0, y: -6 } : { opacity: 1, y: 0 }}
            transition={chromeFade}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              textAlign: "center",
              fontFamily: fontStack,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "#a855ff", letterSpacing: "0.01em" }}>
              {tGroups("interestsIntro")}
            </span>
            <span style={{ fontSize: 26.4, fontWeight: 665, lineHeight: 1.15, color: "#fff" }}>
              {tGroups("interestsTitlePre")}{" "}
              <span className="vibInterestsGradient" style={{ fontWeight: 740 }}>{tGroups("interestsTitleHighlight")}</span>
            </span>
            <span style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.6)" }}>
              {tGroups("interestsSubtitle")}
            </span>
            <span style={{ fontSize: 12, fontWeight: 400, color: "rgba(255,255,255,0.45)" }}>
              {tGroups("interestsFootnote")}
            </span>
            <span style={{ fontSize: 11, fontWeight: 500, color: "rgba(168,85,255,0.55)" }}>
              {tGroups("interestsMinHint")}
            </span>
          </motion.div>

          {celebrating ? (
            <CelebrationBurst
              categories={selectedOptions}
              width={interestsContainerWidth}
              height={interestsGridHeight ?? 300}
            />
          ) : (
            <motion.div
              ref={setInterestsGridEl}
              animate={{ height: interestsGridHeight ?? "auto" }}
              transition={{ height: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }}
              style={{ position: "relative", width: "100%", overflow: "hidden" }}
            >
              <AnimatePresence initial={false} custom={interestsDirection} mode="popLayout">
                <motion.div
                  key={interestPage}
                  custom={interestsDirection}
                  variants={INTEREST_SLIDE_VARIANTS}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    x: { type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.4 },
                    opacity: { duration: 0.25 },
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(auto-fill, minmax(${INTEREST_GRID_MIN_COL}px, 1fr))`,
                    gap: INTEREST_GRID_GAP,
                    width: "100%",
                  }}
                >
                  {interestPageOptions.map((option) => (
                    <GroupCategoryPill
                      key={option.value}
                      label={option.label}
                      category={option.value}
                      selected={selectedCategories.includes(option.value)}
                      onToggle={() => toggleCategory(option.value)}
                    />
                  ))}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}

          <motion.div
            initial={false}
            animate={celebrating ? { opacity: 0, y: -6 } : { opacity: 1, y: 0 }}
            transition={chromeFade}
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: celebrating ? "none" : "auto",
            }}
          >
            {interestPage > 0 && (
              <button
                type="button"
                onClick={() => {
                  setInterestsDirection(-1);
                  setInterestsPage(interestPage - 1);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  color: "#a855ff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: fontStack,
                }}
              >
                {tGroups("interestsGoBack")}
              </button>
            )}

            {isLastInterestPage ? (
              <button
                type="button"
                onClick={handleFinish}
                disabled={
                  savingOnboarding || selectedCategories.length < minCategories
                }
                style={{
                  marginLeft: "auto",
                  border: "none",
                  borderRadius: 10,
                  padding: "7px 32px",
                  fontWeight: 600,
                  fontSize: 14,
                  letterSpacing: "-0.01em",
                  color:
                    savingOnboarding || selectedCategories.length < minCategories
                      ? "rgba(255,255,255,0.6)"
                      : "#fff",
                  backgroundColor:
                    savingOnboarding || selectedCategories.length < minCategories
                      ? "rgba(255,255,255,0.16)"
                      : "transparent",
                  backgroundImage:
                    savingOnboarding || selectedCategories.length < minCategories
                      ? "none"
                      : "linear-gradient(100deg, #ff2fb3 0%, #a855ff 35%, #4f46ff 70%, #ff2fb3 100%)",
                  backgroundSize: "280% 280%",
                  backgroundPosition: "0% 50%",
                  boxShadow:
                    savingOnboarding || selectedCategories.length < minCategories
                      ? "none"
                      : "0 10px 28px rgba(168,85,255,0.22)",
                  cursor:
                    savingOnboarding || selectedCategories.length < minCategories
                      ? "default"
                      : "pointer",
                  overflow: "hidden",
                  fontFamily: fontStack,
                }}
              >
                {savingOnboarding ? tCommon("saving") : tCommon("continue")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setInterestsDirection(1);
                  setInterestsPage(interestPage + 1);
                }}
                style={{
                  marginLeft: "auto",
                  border: "none",
                  borderRadius: 10,
                  padding: "7px 32px",
                  fontWeight: 600,
                  fontSize: 14,
                  letterSpacing: "-0.01em",
                  color: "#fff",
                  backgroundColor: "transparent",
                  backgroundImage:
                    "linear-gradient(100deg, #ff2fb3 0%, #a855ff 35%, #4f46ff 70%, #ff2fb3 100%)",
                  backgroundSize: "280% 280%",
                  backgroundPosition: "0% 50%",
                  boxShadow: "0 10px 28px rgba(168,85,255,0.22)",
                  cursor: "pointer",
                  overflow: "hidden",
                  fontFamily: fontStack,
                }}
              >
                {tCommon("next")}
              </button>
            )}
          </motion.div>
        </motion.div>
      ) : null}

      {(!loading && result?.onboardingCompleted && result.groups.length > 0) || liveRecs.length > 0 ? (
        <>
          <style>{`
            .vibraRecsRail {
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
            .vibraRecsRail::-webkit-scrollbar { display: none; }
          `}</style>

          {isDesktopRail ? (
            // Laptop: sin scroll. Solo las cards completas que quepan + "Ver más".
            <div style={{ width: "100%", overflow: "hidden" }}>
              <AnimatePresence initial={false} custom={railDirection} mode="popLayout">
                <motion.div
                  key={railPageClamped}
                  custom={railDirection}
                  variants={INTEREST_SLIDE_VARIANTS}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    x: { type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.42 },
                    opacity: { duration: 0.25 },
                  }}
                  style={{
                    display: "flex",
                    gap: RAIL_GAP,
                    justifyContent: "center",
                    paddingBottom: 6,
                  }}
                >
                  {railPageCards.map(renderRailCard)}
                </motion.div>
              </AnimatePresence>

              {railPageCount > 1 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 18,
                    marginTop: 8,
                  }}
                >
                  {railPageClamped > 0 && (
                    <button
                      type="button"
                      onClick={handleRailBack}
                      style={railTextButtonStyle}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                      {tGroups("interestsGoBack")}
                    </button>
                  )}
                  {railPageClamped < railPageCount - 1 && (
                    <button
                      type="button"
                      onClick={handleRailMore}
                      style={{ ...railTextButtonStyle, marginLeft: "auto" }}
                    >
                      {tCommon("viewMore")}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            // Celular: se mantiene el scroll horizontal tal como está hoy.
            <div
              className="vibraRecsRail"
              style={{
                display: "flex",
                gap: RAIL_GAP,
                overflowX: "auto",
                scrollSnapType: "x mandatory",
                paddingBottom: 6,
                // Pequeño marco a los lados: el scrollPadding hace que el snap
                // respete el margen y la primera card no quede pegada al borde.
                paddingLeft: 14,
                paddingRight: 14,
                scrollPaddingLeft: 14,
                scrollPaddingRight: 14,
                willChange: "transform",
              }}
            >
              {variantRailCards.map(renderRailCard)}
            </div>
          )}
        </>
      ) : null}

      {viewingPost && (
        <LiveViewerModal
          open={!!viewingPost}
          onClose={() => setViewingPost(null)}
          post={viewingPost}
        />
      )}

      {!loading && result?.onboardingCompleted && result.groups.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "8px 0 2px",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: "rgba(255,255,255,0.68)",
              fontFamily: fontStack,
            }}
          >
            {tGroups("noCommunitiesAvailable")}
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                if (onCreateGroup) {
                  onCreateGroup();
                  return;
                }
                router.push("/groups/new");
              }}
              style={{
                border: "none",
                borderRadius: 12,
                padding: "10px 14px",
                background: "#ffffff",
                color: "#08111d",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: fontStack,
              }}
            >
              {tGroups("createCommunityRailButton")}
            </button>

            <button
              type="button"
              onClick={() => {
                setResult((prev) =>
                  prev
                    ? {
                        ...prev,
                        onboardingCompleted: false,
                      }
                    : prev
                );
              }}
              style={{
                border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: 12,
                padding: "10px 14px",
                background: "transparent",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: fontStack,
              }}
            >
              {tGroups("changeCategories")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}