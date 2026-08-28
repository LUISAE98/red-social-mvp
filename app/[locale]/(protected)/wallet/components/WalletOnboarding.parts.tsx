"use client";

// Tipos, helpers y sub-componentes de WalletOnboarding (aislados).

// Wallet de un creador que todavía no monetiza: no tiene servicios activos ni
// ha recibido ninguna solicitud. En vez del reporte en ceros, ve una invitación
// a empezar. La condición la decide useWalletVisibility, el mismo gate que
// muestra u oculta la sección Wallet del rail derecho.

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/app/providers";
import VibraGradientText from "@/app/components/VibraGradientText/VibraGradientText";
import WalletPhonePreview from "./WalletPhonePreview";
import WalletOnboardingGlobe from "./WalletOnboardingGlobe";
import ServiceFeaturePreview from "@/components/services/ServiceFeaturePreview";
import { buildCollageTiles } from "@/lib/collage";
import { WALLET_COMMISSION_RATE } from "@/lib/wallet/walletFinances";

// Deriva el porcentaje de la comisión real: si algún día cambia la tasa, este
// texto de marketing se actualiza con ella en vez de quedar desincronizado.
/**
 * El porcentaje del caso ESTÁNDAR.
 *
 * ⚠️ Ya no vale para todos: en los 29 países de transferencia cara es 30%. Ver
 * `docs/payout-tiers.md`. La pantalla de onboarding lo resuelve con `useCreatorNetRate`, que
 * sí conoce al creador; esta constante se queda para lo que se pinta sin saber quién mira.
 */
export const COMMISSION_PCT = Math.round(WALLET_COMMISSION_RATE * 100);

// `onboardingPerk2` ("Sin censura política") queda fuera a propósito. La clave
// se conserva traducida por si se retoma, igual que el hueco de HERO_LIST_KEYS.
export const PERK_KEYS = ["onboardingPerk1", "onboardingPerk3", "onboardingPerk4"] as const;

export const FEE_PERK_KEYS = [
  "onboardingFeePerk1",
  "onboardingFeePerk2",
  "onboardingFeePerk3",
  "onboardingFeePerk4",
] as const;

export const HERO_LIST_KEYS = [
  "onboardingHeroList1",
  "onboardingHeroList3",
  "onboardingHeroList4",
  "onboardingHeroList5",
  "onboardingHeroList6",
  "onboardingHeroList7",
  "onboardingHeroList8",
] as const;

// Orden de aparición de los 11 servicios (cada valor es el id del servicio; el
// número que se muestra es la posición). El 9 va a la posición 5 y el 8 a la 6.
export const SERVICE_ORDER = [1, 2, 3, 4, 9, 8, 5, 6, 7, 10, 11] as const;

// Para el fan (audience "users") algunas experiencias se unifican en una sola
// card (mismo orden que SERVICE_ORDER). Cada entrada es uno o más ids de
// servicio; con más de uno se muestra como card combinada (nombre/desc propios
// en wallet.onboardingUMerge*, y el panel apila la vista previa de cada uno).
// El usuario no necesita ver las 11 por separado: 7+8 (supercomentarios +
// donaciones en vivo) y 10+11 (videos exclusivos + publicaciones premium).
export const USER_SERVICE_ENTRIES: number[][] = [
  [1],
  [2],
  [3],
  [4],
  [9],
  [8],
  [5, 6],
  [7],
  [11, 10],
];
// La prioridad (primer id del grupo) define la imagen de fondo y el orden del
// panel: 5+6 lidera con supercomentarios (5); 11+10 lidera con publicaciones (11).
// `previewSvcs` acota qué vistas previas se muestran en el panel (por defecto,
// todas las del grupo). `firstCell` reemplaza la primera celda de la vista previa
// principal (usado en 5+6 para poner la donación —corazón morado— arriba).
export type MergeMeta = {
  nameKey: string;
  descKey: string;
  previewSvcs?: number[];
  firstCell?: { icon: string; color: string; titleKey: string; descKey: string };
};
export const MERGE_META: Record<string, MergeMeta> = {
  "5,6": {
    nameKey: "onboardingUMerge56Name",
    descKey: "onboardingUMerge56Desc",
    previewSvcs: [5],
    firstCell: {
      icon: "heart",
      color: "#a855f7",
      titleKey: "liveDonationPreviewSupportLabel",
      descKey: "mergeDonationSupportDesc",
    },
  },
  "11,10": {
    nameKey: "onboardingUMerge1011Name",
    descKey: "onboardingUMerge1011Desc",
    previewSvcs: [11],
  },
};

// Claves con copy alterno dirigido al usuario/fan (en vez del creador). El
// resolvedor de traducciones las usa cuando audience === "users"; cualquier
// clave onboarding* que NO esté aquí cae al texto de creador (son neutrales).
// Fuente de los textos: messages/*.json → wallet.onboardingU*.
export const ONBOARDING_USER_KEYS = new Set([
  "onboardingUTitle",
  "onboardingURulesTitle",
  "onboardingURulesText",
  "onboardingUPerk1",
  "onboardingUPerk3",
  "onboardingUCommissionTitle",
  "onboardingUExampleCharge",
  "onboardingUExampleReceive",
  "onboardingUFeePerk1",
  "onboardingUHeroList1",
  "onboardingUHeroList4",
  "onboardingUHeroList5",
  "onboardingUHeroList6",
  "onboardingUHeroList7",
  "onboardingUHeroList8",
  "onboardingUSecureIdentity",
  "onboardingUWaysTitle",
  // Solo el título cambia ("Crea o únete…"); las descripciones y notas de cada
  // comunidad son las MISMAS del creador (un usuario normal también puede crear
  // comunidades), así que caen al copy de creador (sin variante onboardingU*).
  "onboardingUCommunitiesTitle",
  "onboardingUCloseTitle",
  "onboardingUCloseText",
  "onboardingUSvc1Desc",
  "onboardingUSvc2Desc",
  "onboardingUSvc3Desc",
  "onboardingUSvc4Desc",
  "onboardingUSvc5Desc",
  "onboardingUSvc6Desc",
  "onboardingUSvc7Desc",
  "onboardingUSvc8Desc",
  "onboardingUSvc9Desc",
  "onboardingUSvc10Desc",
  "onboardingUSvc11Desc",
  "onboardingUSvc7Name",
  "onboardingUSvc8Name",
  "onboardingUSvc3Duration",
  "onboardingUSvc4Duration",
]);

// Imagen de fondo por servicio (webp en /public). Los que faltan usan un fondo
// neutro por ahora; se agregarán cuando se suban sus imágenes.
export const SERVICE_IMAGES: Record<number, string> = {
  1: "saludo",
  2: "consejo",
  3: "sesionexclusiva",
  4: "encuentroenvivo", // "Tiempo contigo"
  5: "supercomentarios",
  6: "donacionesenvivo", // "Donaciones"
  7: "donacion-perfil", // "Donaciones en perfil"
  8: "suscripciones",
  9: "live", // "Ticket por entrar a en vivo"
  10: "desbloquearvod", // "Ticket por ver VOD"
  11: "desbloquearcontenido", // "Ticket por post premium"
};

// Solo los 4 servicios de experiencia tienen items informativos en el perfil.
// Mapea el id de servicio a la clave de ServiceFeaturePreview (reutiliza sus
// iconos, estructura de item y textos exactos). El resto no revela detalle.
export const SERVICE_PREVIEW_KEY: Record<
  number,
  | "saludo"
  | "consejo"
  | "meetGreet"
  | "customClass"
  | "liveAccess"
  | "subscription"
  | "superComments"
  | "liveDonation"
  | "profileDonation"
  | "vodUnlock"
  | "premiumPost"
> = {
  1: "saludo",
  2: "consejo",
  3: "customClass", // "Sesión exclusiva"
  4: "meetGreet", // "Tiempo contigo"
  5: "superComments", // "Supercomentarios"
  6: "liveDonation", // "Donaciones en vivo"
  7: "profileDonation", // "Donaciones en tu perfil"
  8: "subscription", // "Suscripciones a tu comunidad"
  9: "liveAccess", // "Acceso a transmisiones en vivo"
  10: "vodUnlock", // "Acceso a videos exclusivos"
  11: "premiumPost", // "Publicaciones premium"
};

// Color de acento de los íconos de cada tarjeta de servicio, por id de servicio.
export const SERVICE_ACCENT: Record<number, string> = {
  1: "#a855f7", // saludos → morado
  2: "#eab308", // consejos → amarillo
  3: "#ec4899", // sesiones → rosa
  4: "#3b82f6", // tiempo contigo → azul
  5: "#a855f7", // supercomentarios → morado
  6: "#fdba74", // donaciones en vivo → naranja claro
  7: "#38bdf8", // donaciones en el perfil → azul celeste
  8: "#3b82f6", // suscripciones → azul
  9: "#a855f7", // acceso a lives → morado
  10: "#a855f7", // videos exclusivos → morado
  11: "#a855f7", // publicaciones premium → morado
};

// Servicios que se activan desde la pestaña de experiencias del PERFIL. El botón
// "Comenzar ahora" del card lleva al dueño a su perfil con esa card centrada.
// (Los demás servicios se configuran en otro flujo; por eso no tienen entrada.)
export const SERVICE_ACTIVATE_KEY: Record<number, string> = {
  1: "saludo",
  2: "consejo",
  3: "customClass", // sesión exclusiva
  4: "meetGreet", // tiempo contigo
  7: "donation", // donaciones en tu perfil
};

// Los 3 tipos de comunidad, con su ícono y color de acento. El texto vive en
// i18n (onboardingCommunity{Public|Private|Hidden}{Name|Desc}).
export const COMMUNITY_TYPES = [
  {
    key: "Public",
    color: "#a855f7",
    icon: (
      <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18" />
      </svg>
    ),
  },
  {
    key: "Private",
    color: "#a855f7",
    icon: (
      <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    ),
  },
  {
    key: "Hidden",
    color: "#a855f7",
    icon: (
      <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 3l18 18" />
        <path d="M10.6 6.1A9 9 0 0 1 12 6c5 0 9 6 9 6a13 13 0 0 1-2.2 2.6M6.3 8.3A13 13 0 0 0 3 12s4 6 9 6a8.5 8.5 0 0 0 3.3-.65" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      </svg>
    ),
  },
] as const;

// Tapete de categorías (mismo set del login) para el fondo con profundidad de
// la sección de comunidades. Determinista → se calcula una vez.
export const COLLAGE_TILES = buildCollageTiles();

