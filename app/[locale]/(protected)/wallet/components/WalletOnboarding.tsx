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
import WalletPhonePreview from "./WalletPhonePreview";
import WalletOnboardingGlobe from "./WalletOnboardingGlobe";
import ServiceFeaturePreview from "@/components/services/ServiceFeaturePreview";
import { buildCollageTiles } from "@/lib/collage";
import { WALLET_COMMISSION_RATE } from "@/lib/wallet/walletFinances";
import {
  COLLAGE_TILES, COMMISSION_PCT, COMMUNITY_TYPES, FEE_PERK_KEYS, HERO_LIST_KEYS,
  MERGE_META, ONBOARDING_USER_KEYS, PERK_KEYS, SERVICE_ACCENT, SERVICE_ACTIVATE_KEY,
  SERVICE_IMAGES, SERVICE_ORDER, SERVICE_PREVIEW_KEY, USER_SERVICE_ENTRIES,
} from "./WalletOnboarding.parts";

export default function WalletOnboarding({
  showCtas = true,
  twoColumn = false,
  audience = "creators",
  excludeServices,
  hideSections,
}: {
  /** Botones "Comenzar ahora"/"Crea…" de los 11 servicios. Se ocultan cuando se
   *  reutiliza esta info fuera de la wallet (p. ej. login con sesión cerrada). */
  showCtas?: boolean;
  /** En laptop reparte el contenido en 2 columnas: los 11 servicios a la derecha,
   *  el resto a la izquierda. Solo lo usa el login; la wallet queda en 1 columna. */
  twoColumn?: boolean;
  /** A quién se dirige el copy. "creators" (default, wallet real) mantiene los
   *  textos de creador. "users" redirige las claves con variante onboardingU* a
   *  un copy dirigido al fan y oculta la sección "Wallet clara" (celular + texto). */
  audience?: "creators" | "users";
  /**
   * Ids de servicio que NO se listan. Lo usa el login, donde las primeras
   * experiencias ya tienen su propio bloque arriba (video + copy propios) y
   * repetirlas aquí sería decir lo mismo dos veces. La wallet real no lo pasa:
   * ahí se siguen viendo las 11.
   *
   * El conteo del título y la numeración de las cards se ajustan solos a las que
   * queden, así que no hay que tocar nada más al cambiar esta lista.
   */
  excludeServices?: readonly number[];
  /**
   * Secciones que NO se pintan. Lo usa el login, que está sustituyendo esta
   * presentación por sus propios bloques y va apagando las que ya sobran. La
   * wallet real no lo pasa, así que ahí se siguen viendo todas.
   *
   * - `hero`: el titular "Convierte tu pasión…" con sus ventajas y reglas
   * - `commission`: la comisión de Vibra
   * - `clear`: "Wallet clara" (celular, sellos y planeta)
   * - `lifestyle`: la imagen con las garantías ("Retiros protegidos…")
   * - `communities`: los 3 tipos de comunidades
   */
  hideSections?: readonly ("hero" | "commission" | "clear" | "lifestyle" | "communities")[];
} = {}) {
  const oculta = (s: "hero" | "commission" | "clear" | "lifestyle" | "communities") =>
    hideSections?.includes(s) ?? false;
  const rawWallet = useTranslations("wallet");
  // Redirige las claves de onboarding con variante propia a su copy de usuario
  // cuando audience === "users"; el resto (claves neutrales) cae al de creador.
  const resolveKey = (key: string) =>
    audience === "users" &&
    key.startsWith("onboarding") &&
    !key.startsWith("onboardingU") &&
    ONBOARDING_USER_KEYS.has("onboardingU" + key.slice(10))
      ? "onboardingU" + key.slice(10)
      : key;
  const tWallet = Object.assign(
    (key: string, values?: Parameters<typeof rawWallet>[1]) =>
      rawWallet(resolveKey(key), values),
    {
      rich: (key: string, values?: Parameters<typeof rawWallet.rich>[1]) =>
        rawWallet.rich(resolveKey(key), values),
    },
  );
  // Servicios que se van a listar, ya sin los excluidos. Se calcula aquí —y no
  // dentro del mosaico— porque el TÍTULO también lo necesita: dice "N
  // experiencias", y ese número tiene que cuadrar con las cards que se ven.
  const serviceEntries = (
    audience === "users"
      ? (USER_SERVICE_ENTRIES as readonly (readonly number[])[])
      : SERVICE_ORDER.map((s) => [s] as readonly number[])
  ).filter(
    (group) =>
      !excludeServices?.length || !group.every((s) => excludeServices.includes(s)),
  );
  // Cuenta EXPERIENCIAS, no cards: para el fan algunas van combinadas (7+8,
  // 10+11) y aun así son dos experiencias cada una.
  const serviceCount = serviceEntries.reduce((n, group) => n + group.length, 0);

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
  // Card de comunidad abierta por tap (celular/touch); en laptop manda el hover.
  const [openCommunity, setOpenCommunity] = useState<number | null>(null);
  // Card de servicio (de los 11) abierto por tap en celular; en laptop, hover.
  // Arranca con la primera experiencia "abierta" (rowId "1"): en CELULAR eso la
  // muestra desplegada de entrada —enseña el patrón de que las cards abren/cierran—
  // y en laptop no tiene efecto (ahí data-open se ignora; manda el hover).
  const [openService, setOpenService] = useState<string | null>("1");
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
    if (typeof IntersectionObserver === "undefined") {
      root
        .querySelectorAll<HTMLElement>(".reveal, .revealPop")
        .forEach((el) => el.classList.add("is-in"));
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
    // Observa los reveal aún ocultos. Se re-escanea en los siguientes frames
    // porque algunos nodos (p. ej. las cards combinadas del grid de usuario) no
    // están en su posición final justo al montar; si se observan demasiado
    // pronto el IO no dispara y se quedan en opacity:0. `:not(.is-in)` hace el
    // re-escaneo idempotente. También se re-ejecuta cuando groupsLoaded asienta.
    const scan = () =>
      root
        .querySelectorAll<HTMLElement>(".reveal:not(.is-in), .revealPop:not(.is-in)")
        .forEach((el) => io.observe(el));
    scan();
    const r1 = requestAnimationFrame(scan);
    const r2 = requestAnimationFrame(() => requestAnimationFrame(scan));
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
      io.disconnect();
    };
    // `audience` es clave: el login reutiliza la misma instancia al cambiar de
    // pestaña (mismo componente y posición), así que al pasar creador→usuario
    // aparecen cards combinadas nuevas (keys "5,6"/"11,10") que el observer del
    // montaje inicial nunca vio. Re-ejecutar aquí las vuelve a observar.
  }, [audience, groupsLoaded]);

  return (
    <>
      <style jsx>{`
        /* Solo el onboarding se acota: en laptops grandes las filas con
           space-between se estiraban y quedaban huecas. La wallet activa (otro
           componente) no pasa por aquí y sigue sin restricción de ancho. */
        .onboardingRoot {
          max-width: 768px;
          margin-inline-start: auto;
          margin-inline-end: auto;
        }

        /* Modo 2 columnas (solo login creador, solo laptop): el contenido pasa
           de una columna a dos. Los 11 servicios (.ways) se mueven a la columna
           derecha; el resto queda apilado en la izquierda en su mismo orden.
           Se usa CSS Grid conservando el orden del DOM para no alterar celular:
           el layout de una columna sigue vigente por debajo de 901px. */
        @media (min-width: 901px) {
          .onboardingRoot.twoCol {
            max-width: 1180px;
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
            column-gap: clamp(32px, 4vw, 56px);
            align-items: start;
          }
          .onboardingRoot.twoCol > :not(.ways) {
            grid-column: 1;
          }
          /* Los 11 servicios (columna derecha) abarcan EXACTAMENTE las filas de la
             columna izquierda. La izquierda tiene 5 secciones (hero, comisión,
             wallet-clara, estilo-de-vida, comunidades), así que el span es 5. Al
             igualar el nº real de filas, cuando la derecha es más alta que la
             izquierda el navegador reparte ese sobrante ENTRE las 5 filas (espacio
             uniforme entre secciones) en vez de dejarlo como una cola negra al
             fondo (que es lo que pasaba con span 50: las ~45 filas vacías de
             abajo se comían todo el sobrante). El cierre de login-creador NO va
             aquí como celda del grid; se renderiza dentro de esta columna, debajo
             de la card 11.
             OJO: si algún día cambia el nº de secciones de la izquierda, ajustar
             este span para que siga coincidiendo. */
          .onboardingRoot.twoCol > .ways {
            grid-column: 2;
            grid-row: 1 / span 5;
            margin-top: 0;
            align-self: start;
          }
        }

        /* En CELULAR y solo para USUARIOS, el módulo de comunidades sube por
           encima de los 11 servicios. Se usa flex column + order (el reorden no
           afecta laptop, donde manda el grid .twoCol de arriba, ≥901px). Orden:
           hero → comunidades → 11 servicios → cierre. */
        @media (max-width: 900px) {
          .onboardingRoot.audienceUsers {
            display: flex;
            flex-direction: column;
          }
          .onboardingRoot.audienceUsers > .onboarding {
            order: 1;
          }
          .onboardingRoot.audienceUsers > .communitiesTitle {
            order: 2;
          }
          .onboardingRoot.audienceUsers > .ways {
            order: 3;
          }
          .onboardingRoot.audienceUsers > .closeSection {
            order: 4;
          }
        }

        /* LAPTOP + USUARIOS: acomodo propio (distinto al de creador). Arriba dos
           columnas (hero | comunidades). Debajo, a lo ancho, el título de las 11
           experiencias centrado y los cards en grid de 2 por renglón; si el total
           es impar, el último ocupa el renglón completo. El cierre va al final, a
           lo ancho. Gana por especificidad al grid genérico .twoCol de arriba. */
        @media (min-width: 901px) {
          /* Hero (izq) y comunidades (der) comparten fila: se estiran a la misma
             altura (la del más alto) para que el primer módulo de cada columna
             quede parejo. */
          .onboardingRoot.twoCol.audienceUsers > .onboarding {
            grid-column: 1;
            grid-row: 1;
            align-self: stretch;
          }
          .onboardingRoot.twoCol.audienceUsers > .communitiesTitle {
            grid-column: 2;
            grid-row: 1;
            margin-top: 0;
            align-self: stretch;
          }
          .onboardingRoot.twoCol.audienceUsers > .ways {
            grid-column: 1 / -1;
            grid-row: 2;
            margin-top: 48px;
          }
          .onboardingRoot.twoCol.audienceUsers > .closeSection {
            grid-column: 1 / -1;
            grid-row: 3;
          }
          /* Dos columnas INDEPENDIENTES (cada una fluye por su cuenta): al
             expandir un card solo empuja su propia columna, no la de al lado. */
          .onboardingRoot.twoCol.audienceUsers .waysCols {
            flex-direction: row;
            gap: 18px;
            align-items: flex-start;
          }
          .onboardingRoot.twoCol.audienceUsers .waysCol {
            display: flex;
            flex-direction: column;
            gap: 18px;
            flex: 1 1 0;
            min-width: 0;
          }
          /* La celda de cierre crece para centrarse junto a la última card. */
          .onboardingRoot.twoCol.audienceUsers .waysCol > .closeCell {
            flex: 1 1 auto;
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 0 24px;
          }
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
        /* Cada punto de las listas entra con un "pop" al aparecer en pantalla.
           Usamos animación (no transición) con fill-mode backwards: el delay del
           stagger no afecta al hover-zoom (que es transición) y no se queda
           pegada al terminar (así el hover sigue funcionando). */
        .revealPop {
          opacity: 0;
        }
        .revealPop.is-in {
          opacity: 1;
          animation: onbPopIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
        }
        @keyframes onbPopIn {
          0% {
            opacity: 0;
            transform: scale(0.5);
          }
          100% {
            opacity: 1;
            transform: none;
          }
        }

        /* Respeta a quien pidió menos movimiento: todo visible, sin animación. */
        @media (prefers-reduced-motion: reduce) {
          .reveal {
            opacity: 1;
            transform: none;
            transition: none;
          }
          .revealPop {
            opacity: 1;
          }
          .revealPop.is-in {
            animation: none;
          }
        }

        .onboarding {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          padding: 40px 36px 48px;
          /* Cuando el hero se estira (login, para igualar altura con comunidades),
             que su contenido interno pueda repartir el alto sobrante. */
          display: flex;
          flex-direction: column;
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
          flex: 1;
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
          /* Crece para ocupar el alto sobrante del hero estirado y alinea su
             contenido hacia ABAJO, así el bloque de reglas ("Tu conexión…") baja
             y llena el espacio muerto en vez de quedar centrado con hueco abajo. */
          flex: 1;
          display: flex;
          justify-content: center;
          align-items: flex-end;
          gap: clamp(32px, 5vw, 64px);
        }

        .onboardingRules {
          text-align: end;
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
          border: 1.9px solid #a855f7;
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
          align-items: center;
          gap: 14px;
        }

        /* 23% y su lista de garantías, lado a lado, con un espacio intermedio
           equilibrado (ni pegados ni exagerado). */
        .commissionFigureRow {
          display: flex;
          align-items: center;
          gap: clamp(40px, 4.5vw, 60px);
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
          color: #a855f7;
          white-space: nowrap;
        }

        .commissionTitle {
          margin: 0;
          font-size: 26px;
          line-height: 1.15;
          letter-spacing: -0.03em;
          font-weight: 700;
          color: #ffffff;
          text-align: center;
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
          text-align: end;
        }

        /* Contenedor del teléfono. En laptop solo lleva el teléfono (los badges
           están ocultos, viven en la sección lifestyle). */
        .clearPhoneRow {
          display: flex;
          align-items: center;
        }
        .clearBadges {
          display: none;
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

        /* Celda de cierre dentro del grid de experiencias (solo usuarios). En
           celular va a lo ancho al final de las cards; en laptop se coloca en la
           columna derecha, junto a la última experiencia, centrada en vertical. */
        .closeCell {
          text-align: center;
        }
        @media (max-width: 900px) {
          .closeCell {
            margin-top: 16px;
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
           expandida ocupe todo el ancho sin huecos de las colapsadas.
           Solo en dispositivos con mouse; en touch el control es por tap. */
        @media (hover: hover) {
          .communityCards:hover {
            gap: 0;
          }
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
        /* Las NO señaladas se colapsan y se ocultan (solo mouse). */
        @media (hover: hover) {
          .communityCards:hover .communityCard:not(:hover) {
            flex-grow: 0;
            flex-basis: 0;
            padding-inline-start: 0;
            padding-inline-end: 0;
            opacity: 0;
          }
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
          margin-inline-start: 0;
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
          text-align: start;
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
        @media (hover: hover) {
          .communityCard:hover .communityDesc {
            max-width: 520px;
            margin-inline-start: 22px;
            opacity: 1;
          }
        }

        /* Touch (celular): abrir/cerrar por TAP. El JS marca la card con .isOpen;
           esa se expande y las otras se colapsan (mismo efecto que el hover). */
        @media (hover: none) {
          .communityCard {
            cursor: pointer;
          }
          .communityCards:has(.communityCard.isOpen) {
            gap: 0;
          }
          .communityCards:has(.communityCard.isOpen) .communityCard:not(.isOpen) {
            flex-grow: 0;
            flex-basis: 0;
            padding-inline-start: 0;
            padding-inline-end: 0;
            opacity: 0;
          }
          .communityCard.isOpen .communityDesc {
            max-width: 520px;
            margin-inline-start: 22px;
            opacity: 1;
          }
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
          text-align: end;
        }

        /* Lista de servicios (creador): número grande intercalado izq/der. */
        .waysList {
          list-style: none;
          margin: 8px 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        /* Contenedor de las 2 columnas (usuario). Mobile-first: una sola columna
           —las columnas usan display:contents y los cards se secuencian por
           order (1..N)—. En laptop pasa a 2 columnas reales (ver @media). */
        .waysCols {
          margin: 8px 0 0;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .waysCol {
          display: contents;
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
        /* Cerrado, el card hugea su contenido (número + título) sin espacio
           muerto; la altura extra la aportan la descripción y el panel al abrir. */
        .wayMain {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          padding: 16px 28px;
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
          inset-inline-start: 0;
          inset-inline-end: 0;
          bottom: 0;
          height: 55%;
          z-index: 1;
          background: linear-gradient(to bottom, rgba(5, 4, 10, 0), #05040a);
          opacity: 0;
          transition: opacity 320ms ease;
          pointer-events: none;
        }

        @media (hover: hover) {
          .wayRow:hover .wayMainFade,
          .wayRow:focus-within .wayMainFade,
          .wayRow.firstCard .wayMainFade {
            opacity: 1;
          }
          .ways:has(.wayRow:hover) .wayRow.firstCard:not(:hover) .wayMainFade {
            opacity: 0;
          }
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
          text-align: end;
          align-items: flex-end;
        }

        .wayName {
          font-size: 21px;
          font-weight: 600;
          letter-spacing: -0.02em;
          color: #ffffff;
        }

        /* La descripción arranca COLAPSADA (solo se ve el título) y se revela al
           abrir el card, empujando el título hacia arriba. Mismo truco de colapso
           que el panel: grid 0fr→1fr con un inner de overflow hidden. */
        .wayDesc {
          display: grid;
          grid-template-rows: 0fr;
          opacity: 0;
          transition:
            grid-template-rows 380ms cubic-bezier(0.4, 0, 0.2, 1),
            opacity 300ms ease;
        }
        .wayDescInner {
          overflow: hidden;
          min-height: 0;
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

        @media (hover: hover) {
          /* En laptop se revela al pasar el cursor; además, la PRIMERA card
             arranca abierta (.firstCard) para enseñar el patrón —igual que en
             celular, pero aquí basta el hover para el resto—. */
          .wayRow:hover .wayInfo,
          .wayRow:focus-within .wayInfo,
          .wayRow.firstCard .wayInfo,
          .wayRow:hover .wayDesc,
          .wayRow:focus-within .wayDesc,
          .wayRow.firstCard .wayDesc {
            grid-template-rows: 1fr;
            opacity: 1;
          }
          /* Pero en cuanto se hoverea CUALQUIER otra card, la primera se cierra
             (solo una abierta a la vez). Si se hoverea la primera misma, sigue
             abierta por el :not(:hover). */
          .ways:has(.wayRow:hover) .wayRow.firstCard:not(:hover) .wayInfo,
          .ways:has(.wayRow:hover) .wayRow.firstCard:not(:hover) .wayDesc {
            grid-template-rows: 0fr;
            opacity: 0;
          }
        }
        /* Touch (celular): el card se abre/cierra por TAP (data-open), no por
           hover —así el scroll no lo abre por accidente. */
        @media (hover: none) {
          .wayRow[data-open] .wayInfo,
          .wayRow[data-open] .wayDesc {
            grid-template-rows: 1fr;
            opacity: 1;
          }
          .wayRow[data-open] .wayMainFade {
            opacity: 1;
          }
        }

        /* CTA (esquina superior derecha, solo wallet): oculto por defecto y
           aparece/desaparece suave al abrir/cerrar el card. Es un <Link> (hijo),
           así que styled-jsx no lo scopea → :global dentro del .wayRow scopeado. */
        .wayRow :global(.wayCta) {
          opacity: 0;
          pointer-events: none;
          transition: opacity 300ms ease;
        }
        @media (hover: hover) {
          .wayRow:hover :global(.wayCta),
          .wayRow:focus-within :global(.wayCta) {
            opacity: 1;
            pointer-events: auto;
          }
        }
        @media (hover: none) {
          .wayRow[data-open] :global(.wayCta) {
            opacity: 1;
            pointer-events: auto;
          }
        }

        /* Chevron indicador (laptop y celular). Sutil, en la esquina inferior
           OPUESTA al número grande (número izq → abajo-derecha; número der/isRight
           → abajo-izquierda). Rota 180° cuando el card está abierto: en laptop por
           hover o por ser la primera card; en celular por tap (data-open). */
        .wayChevron {
          position: absolute;
          bottom: 8px;
          inset-inline-end: 16px;
          width: 16px;
          height: 16px;
          z-index: 3;
          color: rgba(255, 255, 255, 0.34);
          transition: transform 320ms cubic-bezier(0.4, 0, 0.2, 1);
          pointer-events: none;
        }
        .wayRow.isRight .wayChevron {
          inset-inline-end: auto;
          inset-inline-start: 16px;
        }
        .wayChevron svg {
          display: block;
          width: 100%;
          height: 100%;
        }
        @media (hover: hover) {
          .wayRow:hover .wayChevron,
          .wayRow:focus-within .wayChevron,
          .wayRow.firstCard .wayChevron {
            transform: rotate(180deg);
          }
          .ways:has(.wayRow:hover) .wayRow.firstCard:not(:hover) .wayChevron {
            transform: none;
          }
        }
        @media (hover: none) {
          .wayRow[data-open] .wayChevron {
            transform: rotate(180deg);
          }
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

          /* En celular el título de comunidades va centrado (en laptop, derecha). */
          .communitiesTitle .waysTitle {
            text-align: center;
          }

          .wayMain {
            gap: 16px;
            /* Más padding abajo para el chevron indicador (borde inferior). */
            padding: 18px 20px 26px;
          }

          /* Difuminado más fuerte y alto: en celular imágenes oscuras (saludos)
             casi no se fundían. */
          .wayMainFade {
            height: 70%;
            background: linear-gradient(
              to bottom,
              rgba(5, 4, 10, 0) 0%,
              rgba(5, 4, 10, 0.85) 55%,
              #05040a 100%
            );
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

          .wayDescInner {
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

          /* En celular: texto (título + descripción) arriba, y debajo una fila
             con el teléfono a la izquierda y los 2 badges a la derecha. */
          .clearSection {
            margin-top: 48px;
            flex-direction: column-reverse;
            align-items: stretch;
            gap: 22px;
          }

          /* Fila teléfono + badges, agrupados y centrados (sin hueco muerto en
             medio). Padding lateral porque no es imagen. */
          .clearPhoneRow {
            flex-direction: row;
            align-items: center;
            justify-content: center;
            gap: 24px;
            padding: 0 16px;
          }

          .phoneMock {
            width: 150px;
          }

          /* Badges apilados (uno arriba del otro) a la derecha del teléfono, más
             chicos para que su columna nunca supere el alto del teléfono. */
          .clearBadges {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 16px;
          }
          .clearBadges .securityIcon {
            width: 40px;
            height: 40px;
          }
          .clearBadges .securityText {
            font-size: 10px;
          }

          /* Los badges de la sección lifestyle se ocultan en celular (aquí van
             junto al teléfono). */
          .lifestyleSecurity {
            display: none;
          }

          /* Texto a lo ancho, alineado a la izquierda, con margen lateral. */
          .clearTextBlock {
            align-self: stretch;
            align-items: flex-start;
            text-align: start;
            padding: 0 16px;
          }

          .clearText {
            max-width: none;
            margin-top: 12px;
            font-size: 14px;
          }

          /* Quita el planeta 3D en celular. */
          .clearGlobe {
            display: none;
          }

          .clearTitle {
            font-size: 22px;
          }

          .commissionPct {
            font-size: 58px;
          }

          /* En celular: 23% a la izquierda y la lista a la derecha, misma fila,
             con un espacio intermedio equilibrado. */
          .commissionFigureRow {
            flex-direction: row;
            align-items: center;
            justify-content: center;
            gap: 30px;
          }
          .commissionFigureRow .onboardingPerks {
            align-items: flex-start;
          }

          .commissionRight {
            justify-content: flex-start;
          }

          .exampleCard {
            width: 100%;
            /* Más alto para dar margen arriba/abajo al texto grande. */
            aspect-ratio: 4 / 3;
          }
          /* Texto mucho más grande en celular: hay bastante espacio en la tarjeta. */
          .exampleCardInner {
            gap: 16px;
            padding: 36px 26px;
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

      <div
        className={`onboardingRoot${twoColumn ? " twoCol" : ""}${
          audience === "users" ? " audienceUsers" : ""
        }`}
        ref={rootRef}
      >
      {!oculta("hero") && (
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
              {PERK_KEYS.map((key, i) => (
                <li
                  key={key}
                  className="onboardingPerk revealPop"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <span className="onboardingPerkCheck" aria-hidden="true">
                    <svg viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6.2 4.7 9 10 3.2"
                        stroke="#a855f7"
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
      )}

      {/* Comisión: fuera de la tarjeta con imagen. Texto a la izquierda; la
          derecha queda reservada para un ejemplo que se agregará después.
          Habla del % que cobra Vibra y cuánto recibe el creador → no le interesa
          al fan, así que se oculta para users. */}
      {audience !== "users" && !oculta("commission") && (
      <section className="commission reveal">
        <div className="commissionLeft">
          <h2 className="commissionTitle">{tWallet("onboardingCommissionTitle")}</h2>

          <div className="commissionFigureRow">
            <span className="commissionPct">
              <VibraGradientText>{COMMISSION_PCT}%</VibraGradientText>
            </span>

            <ul className="onboardingPerks">
              {FEE_PERK_KEYS.map((key, i) => (
                <li
                  key={key}
                  className="onboardingPerk revealPop"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <span className="onboardingPerkCheck" aria-hidden="true">
                    <svg viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6.2 4.7 9 10 3.2"
                        stroke="#a855f7"
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
      </section>
      )}

      {/* Transparencia: título + descripción, alineados a la derecha.
          Es la sección "Wallet clara" (celular + texto): habla de lo que ve el
          creador de sus ventas, así que no aplica al fan → se oculta para users. */}
      {audience !== "users" && !oculta("clear") && (
      <section className="clearSection reveal">
        {/* En celular: teléfono a la izquierda y los 2 badges de seguridad a la
            derecha (apilados). En laptop: solo el teléfono (los badges viven en
            la sección lifestyle). */}
        <div className="clearPhoneRow">
          {/* Simulador de celular con una wallet activa demo. */}
          <div className="phoneMock">
            <div className="phoneScreen">
              <WalletPhonePreview />
            </div>
          </div>
          <div className="clearBadges">
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
      )}

      {/* Imagen de estilo de vida con la lista de garantías encima (checks e
          iconos verdes). Son garantías de cobro/manejo de dinero del creador,
          no le competen al fan → se oculta para users. */}
      {audience !== "users" && !oculta("lifestyle") && (
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
              {HERO_LIST_KEYS.map((key, i) => (
                <li
                  key={key}
                  className="lifestyleItem revealPop"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
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
      )}

      {/* Las 11 formas: título + mosaico de categorías de fondo para el contenido.
          Si se excluyeron TODAS (el login, donde cada experiencia ya tiene su
          propio bloque), la sección entera desaparece: dejarla mostraría un
          título anunciando cero experiencias sobre un mosaico vacío. */}
      {serviceCount > 0 && (
      <section className="ways">
        <h2 className="waysTitle reveal">
          {tWallet.rich("onboardingWaysTitle", {
            count: serviceCount,
            vibra: (chunks) => (
              <VibraGradientText
                gradient="linear-gradient(100deg, #c084fc 0%, #a855f7 45%, #7c3aed 100%)"
                style={{ fontSize: "1.25em" }}
              >
                {chunks}
              </VibraGradientText>
            ),
          })}
        </h2>

        {/* Los 11 servicios: número grande intercalado izquierda/derecha, cada
            uno con la imagen de su categoría de fondo. */}
        {(() => {
          // `serviceEntries` se calcula arriba (lo comparte el título).
          const cardEls = serviceEntries.map((group, i) => {
            const pos = i + 1;
            const primary = group[0];
            const isMerge = group.length > 1;
            const rowId = group.join(",");
            const meta = isMerge ? MERGE_META[rowId] : undefined;
            const img = SERVICE_IMAGES[primary];
            // Servicios con vista previa (panel desplegable). En una card
            // combinada se apila la de cada servicio; `previewSvcs` (de MERGE_META)
            // puede acotar cuáles se muestran. El subtítulo por servicio solo se
            // pone cuando hay más de una vista previa.
            const previewSvcs = (meta?.previewSvcs ?? group).filter(
              (s) => SERVICE_PREVIEW_KEY[s]
            );
            const hasInfo = previewSvcs.length > 0;
            const showPreviewLabels = previewSvcs.length > 1;
            // CTA del card: los servicios de perfil scrollean a su card de
            // activación; los lives abren el composer para crear la transmisión.
            // (En el fan showCtas es false → las cards combinadas no tienen CTA;
            // se calcula sobre el servicio principal.)
            const cta = !showCtas
              ? null
              : handle && SERVICE_ACTIVATE_KEY[primary]
                ? {
                    label: tWallet("onboardingStartNow"),
                    href: `/u/${handle}?configure=${SERVICE_ACTIVATE_KEY[primary]}`,
                  }
                : (primary === 9 || primary === 5 || primary === 6 || primary === 10) && handle
                  ? {
                      label: tWallet("onboardingCreateLive"),
                      href: `/u/${handle}?compose=live`,
                    }
                  : primary === 11 && handle
                    ? {
                        label: tWallet("onboardingCreatePremium"),
                        href: `/u/${handle}?compose=premium`,
                      }
                  : // Suscripciones: a una comunidad propia (a configurar) o a
                    // crear comunidad si aún no tiene ninguna.
                    primary === 8 && groupsLoaded
                    ? {
                        label: tWallet("onboardingStartNow"),
                        href: subGroupId
                          ? `/groups/${subGroupId}?configure=subscription`
                          : "/groups/new",
                      }
                    : null;
            return (
              <div
                key={rowId}
                // El estado "abierto" va como atributo data-open, NO en className:
                // el observer de scroll añade `is-in` con classList (fuera de
                // React), y si React reescribiera el className al togglear (por el
                // isOpen) borraría ese `is-in` → el card quedaría transparente. Con
                // data-open React togglea el atributo sin tocar el className.
                className={`wayRow reveal${pos % 2 === 0 ? " isRight" : ""}${
                  hasInfo ? " hasInfo" : ""
                }${pos === 1 ? " firstCard" : ""}`}
                data-open={openService === rowId ? "" : undefined}
                // `order` sirve en celular: ahí las columnas usan display:contents
                // y los cards se secuencian 1..N por este order.
                style={{ order: pos }}
                onClick={() =>
                  setOpenService((prev) => (prev === rowId ? null : rowId))
                }
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

                  {/* CTA: lleva al dueño a activar el servicio (o crear un live).
                      Aparece/desaparece suave al abrir/cerrar el card (la opacidad
                      la controla el CSS por .wayCta; el color va inline por servicio). */}
                  {cta ? (
                    <Link
                      href={cta.href}
                      className="wayCta"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: "absolute",
                        top: 16,
                        // Lado OPUESTO al número (que alterna con isRight, pos par):
                        // número a la derecha → CTA a la izquierda, y viceversa,
                        // para que no se estorben.
                        [pos % 2 === 0 ? "left" : "right"]: 18,
                        zIndex: 4,
                        color: SERVICE_ACCENT[primary] ?? "#c99bff",
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
                    <span className="wayName">
                      {isMerge
                        ? tWallet(MERGE_META[rowId].nameKey)
                        : tWallet(`onboardingSvc${primary}Name`)}
                    </span>
                    {/* La descripción está colapsada por defecto (solo se ve el
                        título) y se revela al hover/tap, empujando el título hacia
                        arriba. El truco grid 0fr→1fr necesita un inner con
                        overflow hidden. */}
                    <span className="wayDesc">
                      <span className="wayDescInner">
                        {isMerge
                          ? tWallet(MERGE_META[rowId].descKey)
                          : tWallet(`onboardingSvc${primary}Desc`)}
                      </span>
                    </span>
                  </div>

                  {/* Chevron (solo celular): pista de que el card se toca para
                      abrir/cerrar; rota 180° al abrir. En laptop no se muestra
                      —ahí el hover ya revela el contenido—. */}
                  <span className="wayChevron" aria-hidden="true">
                    <svg viewBox="0 0 16 16" fill="none">
                      <path
                        d="M4 6l4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </div>

                {/* Panel que se despliega hacia abajo (fondo negro, no la imagen).
                    En una card combinada se apila la vista previa de cada
                    servicio, cada una con su nombre como subtítulo. */}
                {hasInfo ? (
                  <div className="wayInfo">
                    <div className="wayInfoInner">
                      <div className="wayInfoContent">
                        {previewSvcs.map((s, idx) => (
                          <div key={s} style={{ marginTop: idx > 0 ? 16 : 0 }}>
                            {showPreviewLabels ? (
                              <span
                                style={{
                                  display: "block",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  letterSpacing: "-0.01em",
                                  color: "#fff",
                                  marginBottom: 2,
                                }}
                              >
                                {tWallet(`onboardingSvc${s}Name`)}
                              </span>
                            ) : null}
                            <ServiceFeaturePreview
                              service={SERVICE_PREVIEW_KEY[s]!}
                              accentColor={SERVICE_ACCENT[s] ?? "#22c55e"}
                              audience={audience === "users" ? "user" : "creator"}
                              durationDescription={
                                s === 3
                                  ? tWallet("onboardingSvc3Duration")
                                  : s === 4
                                    ? tWallet("onboardingSvc4Duration")
                                    : undefined
                              }
                              firstCell={idx === 0 ? meta?.firstCell : undefined}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          });
          // En usuarios, la frase de cierre va como celda de la 2ª columna, a la
          // derecha de la última experiencia.
          const closeCell =
            audience === "users" ? (
              <div
                key="close"
                className="closeCell reveal"
                style={{ order: 100 }}
              >
                <h2 className="closeTitle">
                  {tWallet.rich("onboardingCloseTitle", {
                    vibra: (chunks) => (
                      <VibraGradientText
                        gradient="linear-gradient(100deg, #c084fc 0%, #a855f7 45%, #7c3aed 100%)"
                        style={{ fontSize: "1.25em" }}
                      >
                        {chunks}
                      </VibraGradientText>
                    ),
                  })}
                </h2>
                <p className="closeText">{tWallet("onboardingCloseText")}</p>
              </div>
            ) : null;
          // Creador: una sola columna apilada. Usuario: dos columnas INDEPENDIENTES
          // —al expandir un card solo empuja su propia columna, no la de al lado—.
          // En celular las columnas usan display:contents y todo se reordena 1..N
          // por `order`, quedando una sola columna secuencial.
          if (audience !== "users") {
            // Creador: una sola columna apilada. En login (twoColumn) el cierre va
            // DENTRO de esta columna, justo debajo de la card 11 (independiente de
            // la altura de la columna izquierda). En wallet (columna única) el
            // cierre se renderiza como sección aparte al final.
            return (
              <div className="waysList">
                {cardEls}
                {twoColumn ? (
                  <div
                    className="closeCell reveal"
                    style={{ order: 100, marginTop: 40 }}
                  >
                    <h2 className="closeTitle">
                      {tWallet.rich("onboardingCloseTitle", {
                        vibra: (chunks) => (
                          <VibraGradientText
                            gradient="linear-gradient(100deg, #c084fc 0%, #a855f7 45%, #7c3aed 100%)"
                            style={{ fontSize: "1.25em" }}
                          >
                            {chunks}
                          </VibraGradientText>
                        ),
                      })}
                    </h2>
                    <p className="closeText">{tWallet("onboardingCloseText")}</p>
                  </div>
                ) : null}
              </div>
            );
          }
          return (
            <div className="waysCols">
              <div className="waysCol">
                {cardEls.filter((_, i) => i % 2 === 0)}
              </div>
              <div className="waysCol">
                {cardEls.filter((_, i) => i % 2 === 1)}
                {closeCell}
              </div>
            </div>
          );
        })()}
      </section>
      )}

      {/* Título: crea 3 tipos de comunidades ("comunidades" con el degradado de
          marca, igual que "conectar" en el título principal). */}
      {!oculta("communities") && (
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
          {COMMUNITY_TYPES.map((c, i) => (
            <div
              key={c.key}
              className={`communityCard${openCommunity === i ? " isOpen" : ""}`}
              onClick={() =>
                setOpenCommunity((prev) => (prev === i ? null : i))
              }
            >
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
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1, color: "#a855f7" }}>
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
      )}

      {/* Cierre: invitación final. En usuarios va como celda del grid, y en
          login-creador (twoColumn) va dentro de la columna de servicios (ambos
          arriba). Aquí solo se renderiza para la WALLET (columna única). */}
      {audience !== "users" && !twoColumn && (
      <section className="closeSection reveal">
        <h2 className="closeTitle">
          {tWallet.rich("onboardingCloseTitle", {
            vibra: (chunks) => (
              <VibraGradientText
                gradient="linear-gradient(100deg, #c084fc 0%, #a855f7 45%, #7c3aed 100%)"
                style={{ fontSize: "1.25em" }}
              >
                {chunks}
              </VibraGradientText>
            ),
          })}
        </h2>
        <p className="closeText">{tWallet("onboardingCloseText")}</p>
      </section>
      )}
      </div>
    </>
  );
}
