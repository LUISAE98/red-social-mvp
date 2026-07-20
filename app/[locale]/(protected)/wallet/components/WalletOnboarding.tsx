"use client";

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
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import WalletPhonePreview from "./WalletPhonePreview";
import WalletOnboardingGlobe from "./WalletOnboardingGlobe";
import ServiceFeaturePreview from "@/components/services/ServiceFeaturePreview";
import { buildCollageTiles } from "@/lib/collage";
import {
  WALLET_COMMISSION_RATE,
  WALLET_NET_RATE,
} from "@/lib/wallet/walletFinances";

// Deriva el porcentaje de la comisión real: si algún día cambia la tasa, este
// texto de marketing se actualiza con ella en vez de quedar desincronizado.
const COMMISSION_PCT = Math.round(WALLET_COMMISSION_RATE * 100);

// Cifras del ejemplo, ancladas en MXN (como todo el sistema de precios). El neto
// se deriva de la tasa real, no se quema, y se pasan a usePriceFormat para que
// entren al switcheo de moneda de la plataforma.
const EXAMPLE_CHARGE_MXN = 1000;
const EXAMPLE_RECEIVE_MXN = Math.round(EXAMPLE_CHARGE_MXN * WALLET_NET_RATE);

const PERK_KEYS = [
  "onboardingPerk1",
  "onboardingPerk2",
  "onboardingPerk3",
  "onboardingPerk4",
] as const;

const FEE_PERK_KEYS = [
  "onboardingFeePerk1",
  "onboardingFeePerk2",
  "onboardingFeePerk3",
  "onboardingFeePerk4",
] as const;

const HERO_LIST_KEYS = [
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
const SERVICE_ORDER = [1, 2, 3, 4, 9, 8, 5, 6, 7, 10, 11] as const;

// Imagen de fondo por servicio (webp en /public). Los que faltan usan un fondo
// neutro por ahora; se agregarán cuando se suban sus imágenes.
const SERVICE_IMAGES: Record<number, string> = {
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
const SERVICE_PREVIEW_KEY: Record<
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
const SERVICE_ACCENT: Record<number, string> = {
  1: "#a855ff", // saludos → morado
  2: "#eab308", // consejos → amarillo
  3: "#ec4899", // sesiones → rosa
  4: "#3b82f6", // tiempo contigo → azul
  5: "#a855ff", // supercomentarios → morado
  6: "#fdba74", // donaciones en vivo → naranja claro
  7: "#38bdf8", // donaciones en el perfil → azul celeste
  8: "#3b82f6", // suscripciones → azul
  9: "#a855ff", // acceso a lives → morado
  10: "#a855ff", // videos exclusivos → morado
  11: "#a855ff", // publicaciones premium → morado
};

// Servicios que se activan desde la pestaña de experiencias del PERFIL. El botón
// "Comenzar ahora" del card lleva al dueño a su perfil con esa card centrada.
// (Los demás servicios se configuran en otro flujo; por eso no tienen entrada.)
const SERVICE_ACTIVATE_KEY: Record<number, string> = {
  1: "saludo",
  2: "consejo",
  3: "customClass", // sesión exclusiva
  4: "meetGreet", // tiempo contigo
  7: "donation", // donaciones en tu perfil
};

// Los 3 tipos de comunidad, con su ícono y color de acento. El texto vive en
// i18n (onboardingCommunity{Public|Private|Hidden}{Name|Desc}).
const COMMUNITY_TYPES = [
  {
    key: "Public",
    color: "#a855ff",
    icon: (
      <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18" />
      </svg>
    ),
  },
  {
    key: "Private",
    color: "#a855ff",
    icon: (
      <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    ),
  },
  {
    key: "Hidden",
    color: "#a855ff",
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
const COLLAGE_TILES = buildCollageTiles();

export default function WalletOnboarding() {
  const tWallet = useTranslations("wallet");
  const { format: formatPrice } = usePriceFormat();
  const { user } = useAuth();
  // Handle del creador para armar el enlace a su propio perfil ("Comenzar ahora").
  const [handle, setHandle] = useState<string | null>(null);
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      setHandle(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, "users", uid))
      .then((snap) => {
        if (cancelled) return;
        const h = snap.data()?.handle;
        setHandle(typeof h === "string" && h.trim() ? h.trim() : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // Comunidades del creador, para el CTA de "Suscripciones": si tiene una
  // comunidad (preferimos privada/oculta, donde sí se puede cobrar suscripción)
  // lo mandamos ahí a configurarla; si no tiene ninguna, a crear comunidad.
  const [subGroupId, setSubGroupId] = useState<string | null>(null);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      setSubGroupId(null);
      setGroupsLoaded(false);
      return;
    }
    let cancelled = false;
    getDocs(query(collection(db, "groups"), where("ownerId", "==", uid)))
      .then((snap) => {
        if (cancelled) return;
        const owned = snap.docs
          .map((d) => ({
            id: d.id,
            visibility:
              (d.data() as { visibility?: unknown }).visibility ?? null,
            isDeleted: (d.data() as { isDeleted?: unknown }).isDeleted === true,
          }))
          .filter((g) => !g.isDeleted);
        const preferred =
          owned.find(
            (g) => g.visibility === "private" || g.visibility === "hidden"
          ) ?? owned[0];
        setSubGroupId(preferred?.id ?? null);
        setGroupsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setGroupsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // Entrada por scroll: cada elemento con la clase `reveal` hace fade + rise
  // cuando entra al viewport (una sola vez). Estilo sobrio, no PowerPoint.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    if (els.length === 0) return;
    if (typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Cifras demo sin centavos: quita el ".00"/",00" cuando el monto es redondo,
  // conservando el símbolo de moneda (respeta el switcheo de moneda).
  const formatNoCents = (mxn: number) =>
    formatPrice(mxn, { code: true }).replace(/([.,])00(\D*)$/, "$2");

  return (
    <>
      <style jsx>{`
        /* Solo el onboarding se acota: en laptops grandes las filas con
           space-between se estiraban y quedaban huecas. La wallet activa (otro
           componente) no pasa por aquí y sigue sin restricción de ancho. */
        .onboardingRoot {
          max-width: 768px;
          margin-left: auto;
          margin-right: auto;
        }

        /* Entrada por scroll: fade + rise sutil, easing suave, una sola vez.
           El estado inicial (oculto) lo aplica el CSS; el observer añade
           .is-in al entrar al viewport. */
        .reveal {
          opacity: 0;
          transform: translateY(22px);
          transition:
            opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1),
            transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
          will-change: opacity, transform;
        }
        .reveal.is-in {
          opacity: 1;
          transform: none;
        }
        /* Respeta a quien pidió menos movimiento: todo visible, sin animación. */
        @media (prefers-reduced-motion: reduce) {
          .reveal {
            opacity: 1;
            transform: none;
            transition: none;
          }
        }

        .onboarding {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          padding: 40px 36px 48px;
        }

        /* Velo oscuro sobre la imagen: la escena tiene el brillo de la TV que
           haría ilegible el texto blanco, sobre todo el bloque de la derecha. */
        .onboardingScrim {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: linear-gradient(
            100deg,
            rgba(8, 5, 16, 0.9) 0%,
            rgba(8, 5, 16, 0.55) 52%,
            rgba(8, 5, 16, 0.78) 100%
          );
        }

        .onboardingInner {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .onboardingTitle {
          margin: 0;
          font-size: 34px;
          line-height: 1.1;
          letter-spacing: -0.03em;
          font-weight: 700;
          color: #ffffff;
        }

        /* Ventajas + reglas, centradas como grupo con un espacio intermedio
           controlado. clamp evita que en laptops grandes quede un hueco muerto
           enorme (tope 64px) y que en angosto se peguen (mínimo 32px). */
        .onboardingColumns {
          align-self: stretch;
          margin-top: 56px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: clamp(32px, 5vw, 64px);
        }

        .onboardingRules {
          text-align: right;
        }

        .onboardingRulesTitle {
          margin: 0;
          font-size: 22px;
          line-height: 1.15;
          letter-spacing: -0.02em;
          font-weight: 700;
          color: #ffffff;
        }

        .onboardingText {
          margin: 14px 0 0;
          max-width: 46ch;
          font-size: 15px;
          line-height: 1.5;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.72);
        }

        /* Lista de ventajas, alineada a la izquierda de la fila inferior. */
        .onboardingPerks {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 9px;
        }

        .onboardingPerk {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          line-height: 1.3;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.92);
          transform-origin: left center;
          transition: transform 0.2s ease;
          cursor: default;
        }
        /* Micro-zoom al pasar el mouse por cada punto; vuelve solo al salir. */
        .onboardingPerk:hover {
          transform: scale(1.2);
        }

        /* Círculo sin relleno, solo contorno morado, con el mismo grosor de trazo
           que la paloma de adentro. */
        .onboardingPerkCheck {
          flex: 0 0 auto;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: transparent;
          border: 1.9px solid #a855ff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .onboardingPerkCheck svg {
          width: 8px;
          height: 8px;
          display: block;
        }

        /* Sección de comisión, fuera de la tarjeta con imagen. Igual que la fila
           de arriba: centrada como grupo, con espacio intermedio controlado por
           clamp para no dejar hueco muerto en laptops grandes. */
        .commission {
          margin-top: 16px;
          display: flex;
          justify-content: center;
          align-items: stretch;
          gap: clamp(32px, 5vw, 64px);
        }

        .commissionLeft {
          flex: 0 1 auto;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 14px;
        }

        /* 23% y su lista de garantías, lado a lado. */
        .commissionFigureRow {
          display: flex;
          align-items: center;
          gap: 22px;
        }

        /* Ejemplo, a la derecha de la sección de comisión. */
        .commissionRight {
          flex: 0 1 auto;
          min-width: 0;
          display: flex;
          justify-content: flex-end;
        }

        /* Tarjeta con imagen de fondo (entretenimiento) en vez del contenedor
           morado. styled-jsx no scopea clases sobre <Image>: el posicionamiento
           va inline; velo y contenido en clases de hermanos (elementos DOM). */
        /* Ancho por contenido; sin redondeo (esquinas cuadradas). La altura la
           toma del estirado de la fila (align-items: stretch), igualando al
           bloque de la izquierda para acercar su borde superior al banner. */
        .exampleCard {
          position: relative;
          isolation: isolate;
          overflow: hidden;
        }

        .exampleScrim {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: linear-gradient(
            160deg,
            rgba(8, 5, 16, 0.82) 0%,
            rgba(8, 5, 16, 0.62) 100%
          );
        }

        .exampleCardInner {
          position: relative;
          z-index: 2;
          height: 100%;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 26px 32px;
          text-align: center;
        }

        .exampleChargeGroup {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        /* "Si cobras $1,000 MXN" en una sola línea, misma fuente que el label. */
        .exampleChargeLine {
          font-size: 18px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.7);
          white-space: nowrap;
        }

        /* Nota sutil debajo del monto cobrado. */
        .exampleBeforeTax {
          font-size: 10px;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.4);
          white-space: nowrap;
        }

        .exampleDivider {
          align-self: stretch;
          height: 1px;
          background: rgba(168, 85, 255, 0.28);
          margin: 4px 0;
        }

        /* "Tú recibes" + monto: centrados dentro de la tarjeta. */
        .exampleLabel {
          align-self: center;
          font-size: 18px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.7);
          white-space: nowrap;
        }

        .exampleReceive {
          align-self: center;
          font-size: 39px;
          font-weight: 500;
          letter-spacing: -0.01em;
          color: #a855ff;
          white-space: nowrap;
        }

        .commissionTitle {
          margin: 0;
          font-size: 26px;
          line-height: 1.15;
          letter-spacing: -0.03em;
          font-weight: 700;
          color: #ffffff;
        }

        /* Bloque de transparencia, alineado a la derecha. */
        /* Fila: mockup de celular a la izquierda, texto a la derecha.
           align-items flex-start sube el texto a la altura donde arranca el celular. */
        .clearSection {
          margin-top: 48px;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          gap: clamp(24px, 5vw, 56px);
        }

        .clearTextBlock {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          text-align: right;
        }

        /* Mockup de celular (marco). La pantalla queda lista para su contenido. */
        .phoneMock {
          flex-shrink: 0;
          width: 190px;
          aspect-ratio: 9 / 19;
          border-radius: 30px;
          padding: 7px;
          box-sizing: border-box;
          background: linear-gradient(155deg, #16131c 0%, #0a0810 100%);
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow:
            0 24px 60px rgba(0, 0, 0, 0.55),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
          position: relative;
        }

        /* Notch superior */
        .phoneMock::before {
          content: "";
          position: absolute;
          top: 10px;
          left: 50%;
          transform: translateX(-50%);
          width: 46px;
          height: 6px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.14);
          z-index: 2;
        }

        .phoneScreen {
          width: 100%;
          height: 100%;
          border-radius: 24px;
          overflow: hidden;
          background: #05040a;
          position: relative;
        }

        .clearTitle {
          margin: 0;
          font-size: 26px;
          line-height: 1.15;
          letter-spacing: -0.03em;
          font-weight: 700;
          color: #ffffff;
        }

        .clearText {
          margin: 14px 0 0;
          max-width: 40ch;
          font-size: 15px;
          line-height: 1.5;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.72);
        }

        /* Ancho grande; el globo llena este contenedor y se encoge solo en móvil. */
        .clearGlobe {
          margin-top: -14px;
          width: min(430px, 100%);
          align-self: flex-end;
        }

        /* Imagen de estilo de vida, a lo ancho del onboarding. Margen negativo
           para subir el banner al hueco vacío bajo el globo (evita espacio muerto). */
        .lifestyle {
          margin-top: 14px;
        }

        /* Las 11 formas de generar ingresos. */
        .ways {
          margin-top: 56px;
        }

        .communitiesTitle {
          position: relative;
          margin-top: 14px;
          padding: 44px 26px 48px;
          border-radius: 0;
          overflow: hidden;
          isolation: isolate;
          /* Contenedor de consulta: la descripción se mide contra el ancho REAL
             de este panel (no del viewport), para no desbordar en laptops con
             rieles laterales donde el panel es más angosto que la pantalla. */
          container-type: inline-size;
        }

        /* Tapete de fondo con profundidad. */
        .communitiesBg {
          position: absolute;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          background: #07030f;
          pointer-events: none;
        }
        .communitiesBgStage {
          position: absolute;
          inset: -30%;
          perspective: 1400px;
          display: grid;
          place-items: center;
        }
        .communitiesBgGrid {
          display: grid;
          grid-template-columns: repeat(10, 1fr);
          grid-auto-rows: auto;
          gap: 8px;
          width: 160%;
          transform-origin: center;
          transform: rotateX(18deg) rotateZ(-10deg) scale(0.9);
        }
        .communitiesBgTile {
          grid-column: span 1;
          aspect-ratio: 1 / 1;
          overflow: hidden;
          border-radius: 0;
          background: linear-gradient(160deg, #1b1530, #0d0a18);
          box-shadow: 0 16px 34px rgba(0, 0, 0, 0.5);
        }
        .communitiesBgTile.is-wide {
          grid-column: span 2;
          aspect-ratio: 2 / 1;
        }
        .communitiesBgTile img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          opacity: 0.62;
        }
        /* Oscurecido + viñeta para que el texto se lea sobre el tapete. */
        .communitiesBgOverlay {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(
              130% 130% at 50% 45%,
              rgba(6, 3, 14, 0.42) 0%,
              rgba(5, 2, 11, 0.66) 55%,
              rgba(3, 1, 8, 0.8) 100%
            ),
            linear-gradient(
              180deg,
              rgba(5, 2, 11, 0.6) 0%,
              rgba(5, 2, 11, 0.5) 50%,
              rgba(3, 1, 8, 0.7) 100%
            );
        }

        /* El contenido va por encima del tapete. */
        .communitiesTitle > .waysTitle,
        .communitiesTitle > .communityCards {
          position: relative;
          z-index: 1;
        }

        /* Cierre. */
        .closeSection {
          margin-top: 20px;
          padding: 0 8px;
          text-align: center;
        }
        .closeTitle {
          margin: 0 0 14px;
          font-size: 27px;
          line-height: 1.3;
          letter-spacing: -0.03em;
          font-weight: 700;
          color: #ffffff;
        }
        .closeText {
          max-width: 560px;
          margin: 0 auto;
          font-size: 15px;
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.72);
        }
        @media (max-width: 900px) {
          .closeSection {
            margin-top: 16px;
          }
          .closeTitle {
            font-size: 22px;
          }
          .closeText {
            font-size: 14px;
          }
        }

        .communityCards {
          margin-top: 18px;
          display: flex;
          flex-direction: row;
          align-items: stretch;
          gap: 12px;
          transition: gap 0.45s ease;
        }
        /* Al pasar el mouse por el renglón, el gap desaparece para que la card
           expandida ocupe todo el ancho sin huecos de las colapsadas. */
        .communityCards:hover {
          gap: 0;
        }

        .communityCard {
          flex: 1 1 0;
          min-width: 0;
          /* Fila: [ícono+título] a la izq, descripción a la der. El alto lo fija
             el bloque ícono+título y NO cambia al abrir la descripción, así la
             expansión es solo horizontal (sin mover el scroll vertical). */
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: center;
          padding: 24px 14px;
          border-radius: 16px;
          background: transparent;
          border: none;
          overflow: hidden;
          cursor: default;
          transition:
            flex-grow 0.45s ease,
            flex-basis 0.45s ease,
            padding 0.45s ease,
            opacity 0.3s ease,
            background 0.3s ease,
            border-color 0.3s ease;
        }
        /* Las NO señaladas se colapsan y se ocultan. */
        .communityCards:hover .communityCard:not(:hover) {
          flex-grow: 0;
          flex-basis: 0;
          padding-left: 0;
          padding-right: 0;
          opacity: 0;
        }

        .communityHead {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          text-align: center;
        }

        .communityIcon {
          display: inline-flex;
        }

        .communityName {
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: #ffffff;
          white-space: nowrap;
        }

        /* Capa externa: solo recorta el ancho (se despliega hacia el lado). El
           texto vive en un inner de ancho FIJO, así su alto es estable y la card
           nunca crece de alto (cero movimiento en Y). */
        .communityDesc {
          flex-shrink: 0;
          max-width: 0;
          margin-left: 0;
          opacity: 0;
          overflow: hidden;
          transition:
            max-width 0.5s ease,
            margin-left 0.5s ease,
            opacity 0.35s ease;
        }
        .communityDescInner {
          display: block;
          /* Ancho definido (alto estable) pero relativo al ANCHO DEL PANEL (cqw),
             así se encoge cuando el panel es angosto y nunca desborda. */
          width: min(500px, 58cqw);
          text-align: left;
          font-size: 13.5px;
          line-height: 1.5;
          color: rgba(255, 255, 255, 0.9);
        }

        /* Nota sutil (ícono ⓘ + texto) debajo de la descripción de "Pública". */
        .communityNote {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          margin-top: 10px;
          font-size: 12px;
          line-height: 1.4;
          color: rgba(255, 255, 255, 0.45);
        }
        .communityCard:hover .communityDesc {
          max-width: 520px;
          margin-left: 22px;
          opacity: 1;
        }

        .waysTitle {
          margin: 0 0 22px;
          padding-bottom: 4px;
          text-align: center;
          font-size: 24px;
          line-height: 1.35;
          letter-spacing: -0.03em;
          font-weight: 700;
          color: #ffffff;
        }

        /* El título de comunidades va alineado a la derecha. */
        .communitiesTitle .waysTitle {
          text-align: right;
        }

        /* Lista de servicios: número grande intercalado izquierda/derecha. */
        .waysList {
          list-style: none;
          margin: 8px 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        /* Cada servicio es una tarjeta con la imagen de su categoría de fondo. */
        /* La tarjeta es una columna: parte visible (imagen) + panel desplegable.
           El fondo es negro; la imagen vive solo en .wayMain (tamaño fijo). */
        .wayRow {
          position: relative;
          display: flex;
          flex-direction: column;
          background: #05040a;
        }

        /* Parte siempre visible: número + texto sobre la imagen de tamaño fijo. */
        .wayMain {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          min-height: 150px;
          padding: 22px 28px;
          display: flex;
          align-items: center;
          gap: 26px;
        }

        .wayRow.isRight .wayMain {
          flex-direction: row-reverse;
        }

        /* Velo oscuro sobre la imagen, para que número y texto se lean. */
        .wayScrim {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: rgba(6, 3, 14, 0.7);
          pointer-events: none;
        }

        /* Difuminado a negro en el borde inferior de la imagen. Invisible hasta
           que se abre el panel: entonces la imagen se funde con el fondo negro. */
        .wayMainFade {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 55%;
          z-index: 1;
          background: linear-gradient(to bottom, rgba(5, 4, 10, 0), #05040a);
          opacity: 0;
          transition: opacity 320ms ease;
          pointer-events: none;
        }

        .wayRow:hover .wayMainFade,
        .wayRow:focus-within .wayMainFade {
          opacity: 1;
        }

        .wayMain .wayNum,
        .wayMain .wayText {
          position: relative;
          z-index: 2;
        }

        .wayNum {
          flex: 0 0 auto;
          min-width: 96px;
          text-align: center;
          font-size: 84px;
          line-height: 0.9;
          font-weight: 600;
          letter-spacing: -0.04em;
          color: #ffffff;
        }

        .wayText {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        /* En las pares el texto se alinea hacia el número (derecha). */
        .wayRow.isRight .wayText {
          text-align: right;
          align-items: flex-end;
        }

        .wayName {
          font-size: 21px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: #ffffff;
        }

        .wayDesc {
          max-width: 60ch;
          font-size: 14px;
          line-height: 1.45;
          color: rgba(255, 255, 255, 0.72);
        }

        /* Panel desplegable (fondo negro de .wayRow): se abre hacia abajo al hover
           sin tocar el tamaño de la imagen. */
        .wayInfo {
          display: grid;
          grid-template-rows: 0fr;
          opacity: 0;
          transition:
            grid-template-rows 380ms cubic-bezier(0.4, 0, 0.2, 1),
            opacity 300ms ease;
        }

        .wayRow:hover .wayInfo,
        .wayRow:focus-within .wayInfo {
          grid-template-rows: 1fr;
          opacity: 1;
        }

        .wayInfoInner {
          overflow: hidden;
        }

        .wayInfoContent {
          padding: 4px 28px 24px;
        }

        .lifestyleImageWrap {
          position: relative;
          isolation: isolate;
          width: 100%;
          overflow: hidden;
        }

        /* Velo oscuro sobre la imagen, para que la lista se lea. */
        .lifestyleScrim {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: rgba(8, 5, 16, 0.55);
          pointer-events: none;
        }

        /* Fila sobre la imagen: garantías a la izquierda, seguridad a la derecha. */
        .lifestyleContent {
          position: relative;
          z-index: 2;
          padding: 20px 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: clamp(28px, 5vw, 72px);
        }

        .lifestyleList {
          list-style: none;
          margin: 0;
          padding: 0;
          max-width: 460px;
          display: flex;
          flex-direction: column;
          gap: 11px;
        }

        /* Columna de seguridad (escudo + reconocimiento facial). */
        .lifestyleSecurity {
          flex: 0 0 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 22px;
          max-width: 150px;
        }

        .securityBadge {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          text-align: center;
          transition: transform 0.2s ease;
          cursor: default;
        }
        .securityBadge:hover {
          transform: scale(1.2);
        }

        .securityIcon {
          width: 58px;
          height: 58px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .securityIcon svg {
          width: 100%;
          height: 100%;
          display: block;
        }

        .securityText {
          font-size: 11px;
          line-height: 1.3;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.92);
          max-width: 140px;
        }

        .lifestyleItem {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          line-height: 1.3;
          font-weight: 500;
          color: #ffffff;
          transform-origin: left center;
          transition: transform 0.2s ease;
          cursor: default;
        }
        .lifestyleItem:hover {
          transform: scale(1.2);
        }

        /* Círculo sin relleno, contorno verde grueso, con la paloma verde. */
        .lifestyleCheck {
          flex: 0 0 auto;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: transparent;
          border: 1.7px solid #22c55e;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .lifestyleCheck svg {
          width: 8px;
          height: 8px;
          display: block;
        }

        /* El tamaño y el estirado van en este span normal (styled-jsx no scopea
           clases sobre el componente VibraGradientText); el degradado los hereda.
           line-height holgado + padding evitan que background-clip:text corte el
           número por abajo. */
        .commissionPct {
          display: inline-block;
          font-size: 92px;
          line-height: 1.15;
          letter-spacing: -0.04em;
          font-weight: 500;
          padding-bottom: 0.12em;
          /* Sin estirado vertical: se conserva la altura y se ensancha un poco. */
          transform: scaleX(1.08);
          transform-origin: left center;
        }

        @media (max-width: 900px) {
          .onboarding {
            padding: 28px 20px 36px;
          }

          /* En angosto: lista arriba y seguridad como fila debajo. */
          .lifestyleContent {
            flex-direction: column;
            align-items: flex-start;
            gap: 22px;
          }

          .waysTitle {
            font-size: 18px;
          }

          .wayMain {
            gap: 16px;
          }

          .wayInfoContent {
            padding: 4px 18px 20px;
          }

          .wayNum {
            min-width: 60px;
            font-size: 56px;
          }

          .wayName {
            font-size: 18px;
          }

          .wayDesc {
            font-size: 13px;
          }

          .lifestyleSecurity {
            flex-direction: row;
            align-self: stretch;
            max-width: none;
            justify-content: space-around;
            gap: 16px;
          }

          /* En angosto: título+23% arriba, ejemplo abajo, ambos a lo ancho. */
          .commission {
            margin-top: 32px;
            flex-direction: column;
            align-items: stretch;
            gap: 20px;
          }

          .commissionTitle {
            font-size: 22px;
            text-align: center;
          }

          /* Centra el contenido de la columna izquierda (título + 23% + lista). */
          .commissionLeft {
            align-items: center;
          }

          /* En celular: teléfono a la izquierda, texto (título + descripción) a
             su derecha. */
          .clearSection {
            margin-top: 36px;
            flex-direction: row;
            align-items: flex-start;
            gap: 16px;
          }

          .phoneMock {
            width: 140px;
          }

          .clearTextBlock {
            flex: 1;
            min-width: 0;
            align-items: flex-start;
            text-align: left;
          }

          .clearText {
            max-width: none;
            margin-top: 10px;
            font-size: 13.5px;
          }

          .clearGlobe {
            align-self: flex-start;
          }

          .clearTitle {
            font-size: 22px;
          }

          .commissionPct {
            font-size: 72px;
          }

          /* En angosto el 23% no cabe junto a la lista: se apilan, centrados.
             La lista se corre al centro (queda a la altura de la primera lista). */
          .commissionFigureRow {
            flex-direction: column;
            align-items: center;
            gap: 18px;
          }
          .commissionFigureRow .onboardingPerks {
            align-items: flex-start;
            align-self: center;
            width: fit-content;
            max-width: 100%;
          }

          .commissionRight {
            justify-content: flex-start;
          }

          .exampleCard {
            width: 100%;
            /* Un cuadrado a ancho completo sería altísimo en el teléfono. */
            aspect-ratio: 16 / 10;
          }
          /* Texto mucho más grande en celular: hay bastante espacio en la tarjeta. */
          .exampleCardInner {
            gap: 14px;
            padding: 26px;
          }
          .exampleChargeLine,
          .exampleLabel {
            font-size: 24px;
          }
          .exampleBeforeTax {
            font-size: 13px;
          }
          .exampleReceive {
            font-size: 62px;
          }

          .onboardingTitle {
            font-size: 28px;
            max-width: none;
          }

          /* En pantalla angosta las dos columnas no caben lado a lado:
             se apilan, ventajas arriba y reglas abajo. */
          .onboardingColumns {
            margin-top: 36px;
            flex-direction: column;
            align-items: stretch;
            gap: 36px;
          }

          .onboardingRulesTitle {
            font-size: 19px;
          }

          .onboardingText {
            max-width: none;
          }
        }
      `}</style>

      <div className="onboardingRoot" ref={rootRef}>
      <section className="onboarding reveal">
        {/* Fondo decorativo. styled-jsx no scopea clases sobre <Image>, así que
            el posicionamiento va inline; el aspecto (velo, capas) en las clases
            de los hermanos, que sí son elementos DOM. */}
        <Image
          src="/desbloquearcontenido.webp"
          alt=""
          fill
          priority
          sizes="(max-width: 900px) 100vw, 860px"
          style={{ objectFit: "cover", zIndex: 0 }}
        />
        <div className="onboardingScrim" aria-hidden="true" />

        <div className="onboardingInner">
          {/* Texto enriquecido: cada idioma decide qué palabra lleva el degradado
              y en qué punto de la frase cae, en vez de asumir que va al final. */}
          <h2 className="onboardingTitle">
            {tWallet.rich("onboardingTitle", {
              vibra: (chunks) => (
                <VibraGradientText style={{ fontSize: "1.12em" }}>{chunks}</VibraGradientText>
              ),
            })}
          </h2>

          <div className="onboardingColumns">
            <ul className="onboardingPerks">
              {PERK_KEYS.map((key) => (
                <li key={key} className="onboardingPerk">
                  <span className="onboardingPerkCheck" aria-hidden="true">
                    <svg viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6.2 4.7 9 10 3.2"
                        stroke="#a855ff"
                        strokeWidth="2.1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  {tWallet(key)}
                </li>
              ))}
            </ul>

            <div className="onboardingRules">
              <h3 className="onboardingRulesTitle">
                {tWallet.rich("onboardingRulesTitle", {
                  vibra: (chunks) => (
                    <VibraGradientText style={{ fontSize: "1.25em" }}>{chunks}</VibraGradientText>
                  ),
                })}
              </h3>
              <p className="onboardingText">{tWallet("onboardingRulesText")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Comisión: fuera de la tarjeta con imagen. Texto a la izquierda; la
          derecha queda reservada para un ejemplo que se agregará después. */}
      <section className="commission reveal">
        <div className="commissionLeft">
          <h2 className="commissionTitle">{tWallet("onboardingCommissionTitle")}</h2>

          <div className="commissionFigureRow">
            <span className="commissionPct">
              <VibraGradientText>{COMMISSION_PCT}%</VibraGradientText>
            </span>

            <ul className="onboardingPerks">
              {FEE_PERK_KEYS.map((key) => (
                <li key={key} className="onboardingPerk">
                  <span className="onboardingPerkCheck" aria-hidden="true">
                    <svg viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6.2 4.7 9 10 3.2"
                        stroke="#a855ff"
                        strokeWidth="2.1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  {tWallet(key)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="commissionRight">
          <div className="exampleCard">
            <Image
              src="/entretenimiento.webp"
              alt=""
              fill
              sizes="(max-width: 900px) 90vw, 260px"
              style={{ objectFit: "cover", zIndex: 0 }}
            />
            <div className="exampleScrim" aria-hidden="true" />

            <div className="exampleCardInner">
              <span className="exampleChargeGroup">
                <span className="exampleChargeLine">
                  {tWallet("onboardingExampleCharge")}{" "}
                  {formatNoCents(EXAMPLE_CHARGE_MXN)}
                </span>
                <span className="exampleBeforeTax">{tWallet("onboardingBeforeTax")}</span>
              </span>

              <span className="exampleDivider" aria-hidden="true" />

              <span className="exampleLabel">{tWallet("onboardingExampleReceive")}</span>
              <span className="exampleReceive">
                {formatNoCents(EXAMPLE_RECEIVE_MXN)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Transparencia: título + descripción, alineados a la derecha. */}
      <section className="clearSection reveal">
        {/* Simulador de celular con una wallet activa demo (Finanzas / Estadísticas). */}
        <div className="phoneMock">
          <div className="phoneScreen">
            <WalletPhonePreview />
          </div>
        </div>

        <div className="clearTextBlock">
          <h2 className="clearTitle">
            {tWallet.rich("onboardingClearTitle", {
              vibra: (chunks) => (
                <span style={{ color: "#22c55e", fontSize: "1.12em" }}>{chunks}</span>
              ),
            })}
          </h2>
          <p className="clearText">{tWallet("onboardingClearText")}</p>

          {/* Planeta 3D blanco (mismo motor que el globo de la wallet). */}
          <div className="clearGlobe">
            <WalletOnboardingGlobe />
          </div>
        </div>
      </section>

      {/* Imagen de estilo de vida con la lista de garantías encima. */}
      <section className="lifestyle reveal">
        <div className="lifestyleImageWrap">
          <Image
            src="/wallet-hero.webp"
            alt=""
            fill
            sizes="(max-width: 900px) 100vw, 768px"
            style={{ objectFit: "cover", zIndex: 0 }}
          />
          <div className="lifestyleScrim" aria-hidden="true" />

          <div className="lifestyleContent">
            <ul className="lifestyleList">
              {HERO_LIST_KEYS.map((key) => (
                <li key={key} className="lifestyleItem">
                  <span className="lifestyleCheck" aria-hidden="true">
                    <svg viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6.2 4.7 9 10 3.2"
                        stroke="#22c55e"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  {tWallet(key, { pct: COMMISSION_PCT })}
                </li>
              ))}
            </ul>

            <div className="lifestyleSecurity">
              <div className="securityBadge">
                <span className="securityIcon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2.8 19 5.6v5.1c0 4.6-3 7.8-7 9.4-4-1.6-7-4.8-7-9.4V5.6L12 2.8Z" />
                    <path d="M8.7 12 11 14.3l4.3-4.6" />
                  </svg>
                </span>
                <span className="securityText">{tWallet("onboardingSecurePayments")}</span>
              </div>

              <div className="securityBadge">
                <span className="securityIcon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 8.2V6a2 2 0 0 1 2-2h2.2" />
                    <path d="M15.8 4H18a2 2 0 0 1 2 2v2.2" />
                    <path d="M20 15.8V18a2 2 0 0 1-2 2h-2.2" />
                    <path d="M8.2 20H6a2 2 0 0 1-2-2v-2.2" />
                    <path d="M9.2 9.6v1.2" />
                    <path d="M14.8 9.6v1.2" />
                    <path d="M12 9.8v2.8l-1.1.8" />
                    <path d="M9.4 15c.8.7 1.7 1 2.6 1s1.8-.3 2.6-1" />
                  </svg>
                </span>
                <span className="securityText">{tWallet("onboardingSecureIdentity")}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Las 11 formas: título + mosaico de categorías de fondo para el contenido. */}
      <section className="ways">
        <h2 className="waysTitle reveal">
          {tWallet.rich("onboardingWaysTitle", {
            vibra: (chunks) => (
              <VibraGradientText
                gradient="linear-gradient(100deg, #c084fc 0%, #a855ff 45%, #7c3aed 100%)"
                style={{ fontSize: "1.25em" }}
              >
                {chunks}
              </VibraGradientText>
            ),
          })}
        </h2>

        {/* Los 11 servicios: número grande intercalado izquierda/derecha, cada
            uno con la imagen de su categoría de fondo. */}
        <ol className="waysList">
          {SERVICE_ORDER.map((svc, i) => {
            const pos = i + 1;
            const img = SERVICE_IMAGES[svc];
            const previewKey = SERVICE_PREVIEW_KEY[svc];
            // CTA del card: los servicios de perfil scrollean a su card de
            // activación; los lives abren el composer para crear la transmisión.
            const cta =
              handle && SERVICE_ACTIVATE_KEY[svc]
                ? {
                    label: tWallet("onboardingStartNow"),
                    href: `/u/${handle}?configure=${SERVICE_ACTIVATE_KEY[svc]}`,
                  }
                : (svc === 9 || svc === 5 || svc === 6 || svc === 10) && handle
                  ? {
                      label: tWallet("onboardingCreateLive"),
                      href: `/u/${handle}?compose=live`,
                    }
                  : svc === 11 && handle
                    ? {
                        label: tWallet("onboardingCreatePremium"),
                        href: `/u/${handle}?compose=premium`,
                      }
                  : // Suscripciones: a una comunidad propia (a configurar) o a
                    // crear comunidad si aún no tiene ninguna.
                    svc === 8 && groupsLoaded
                    ? {
                        label: tWallet("onboardingStartNow"),
                        href: subGroupId
                          ? `/groups/${subGroupId}?configure=subscription`
                          : "/groups/new",
                      }
                    : null;
            return (
              <li
                key={svc}
                className={`wayRow reveal${pos % 2 === 0 ? " isRight" : ""}${
                  previewKey ? " hasInfo" : ""
                }`}
              >
                {/* Parte visible: imagen (tamaño fijo) + número + texto. */}
                <div className="wayMain">
                  {img ? (
                    <Image
                      src={`/${img}.webp`}
                      alt=""
                      fill
                      sizes="(max-width: 900px) 100vw, 768px"
                      style={{ objectFit: "cover", zIndex: 0 }}
                    />
                  ) : null}
                  <div className="wayScrim" aria-hidden="true" />
                  {/* Difuminado a negro en el borde inferior (aparece al abrir). */}
                  <div className="wayMainFade" aria-hidden="true" />

                  {/* CTA: lleva al dueño a activar el servicio (o crear un live). */}
                  {cta ? (
                    <Link
                      href={cta.href}
                      style={{
                        position: "absolute",
                        top: 16,
                        right: 18,
                        zIndex: 4,
                        color: SERVICE_ACCENT[svc] ?? "#c99bff",
                        fontSize: 13,
                        fontWeight: 600,
                        lineHeight: 1,
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {cta.label}
                    </Link>
                  ) : null}

                  <span className="wayNum" aria-hidden="true">{pos}</span>
                  <div className="wayText">
                    <span className="wayName">{tWallet(`onboardingSvc${svc}Name`)}</span>
                    <span className="wayDesc">{tWallet(`onboardingSvc${svc}Desc`)}</span>
                  </div>
                </div>

                {/* Panel que se despliega hacia abajo (fondo negro, no la imagen). */}
                {previewKey ? (
                  <div className="wayInfo">
                    <div className="wayInfoInner">
                      <div className="wayInfoContent">
                        <ServiceFeaturePreview
                          service={previewKey}
                          accentColor={SERVICE_ACCENT[svc] ?? "#22c55e"}
                          durationDescription={
                            svc === 3
                              ? tWallet("onboardingSvc3Duration")
                              : svc === 4
                                ? tWallet("onboardingSvc4Duration")
                                : undefined
                          }
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      {/* Título: crea 3 tipos de comunidades ("comunidades" con el degradado de
          marca, igual que "conectar" en el título principal). */}
      <section className="communitiesTitle reveal">
        {/* Tapete de categorías con profundidad (perspectiva 3D), puramente
            decorativo, detrás del título y las tarjetas. */}
        <div className="communitiesBg" aria-hidden="true">
          <div className="communitiesBgStage">
            <div className="communitiesBgGrid">
              {COLLAGE_TILES.map((tile, i) => (
                <div
                  key={i}
                  className={`communitiesBgTile${tile.wide ? " is-wide" : ""}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/${tile.src}.webp`} alt="" loading="lazy" draggable={false} />
                </div>
              ))}
            </div>
          </div>
          <div className="communitiesBgOverlay" />
        </div>

        <h2 className="waysTitle">
          {tWallet.rich("onboardingCommunitiesTitle", {
            vibra: (chunks) => (
              <VibraGradientText style={{ fontSize: "1.25em" }}>{chunks}</VibraGradientText>
            ),
          })}
        </h2>

        <div className="communityCards">
          {COMMUNITY_TYPES.map((c) => (
            <div key={c.key} className="communityCard">
              <div className="communityHead">
                <span className="communityIcon" style={{ color: c.color }} aria-hidden="true">
                  {c.icon}
                </span>
                <span className="communityName">
                  {tWallet(`onboardingCommunity${c.key}Name`)}
                </span>
              </div>
              <span className="communityDesc">
                <span className="communityDescInner">
                  {tWallet(`onboardingCommunity${c.key}Desc`)}
                  {c.key === "Public" || c.key === "Private" || c.key === "Hidden" ? (
                    <span className="communityNote">
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1, color: "#a855ff" }}>
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 11v5" />
                        <path d="M12 7.6h0" />
                      </svg>
                      <span>{tWallet(`onboardingCommunity${c.key}Note`)}</span>
                    </span>
                  ) : null}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Cierre: invitación final + aclaración de que activar experiencias es
          gratis y reversible cuando el creador quiera. */}
      <section className="closeSection reveal">
        <h2 className="closeTitle">
          {tWallet.rich("onboardingCloseTitle", {
            vibra: (chunks) => (
              <VibraGradientText
                gradient="linear-gradient(100deg, #c084fc 0%, #a855ff 45%, #7c3aed 100%)"
                style={{ fontSize: "1.25em" }}
              >
                {chunks}
              </VibraGradientText>
            ),
          })}
        </h2>
        <p className="closeText">{tWallet("onboardingCloseText")}</p>
      </section>
      </div>
    </>
  );
}
