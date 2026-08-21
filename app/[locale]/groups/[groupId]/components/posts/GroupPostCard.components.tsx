// GroupPostCard.components.tsx
// Subcomponentes presentacionales extraídos de GroupPostCard.tsx.
// Están definidos a nivel de módulo (no cierran sobre el estado del componente
// principal): reciben todo por props y son seguros de reutilizar/testear aislados.

"use client";

import Image from "next/image";
import Hls from "hls.js";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { WALLET_NET_RATE } from "@/lib/wallet/walletFinances";
import { FIXED_SERVICE_FEE_USD, SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { formatCurrency, roundReference } from "@/lib/currency/format";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import type { PostPremiumStateResult } from "@/lib/posts/post-premium-state";
import { fontStack, getInitials, formatMediaDuration } from "./GroupPostCard.utils";

/**
 * Lo que el CREADOR se lleva por cada desbloqueo.
 *
 * ⚠️ NO se usa `usePriceFormat().format` aquí. Ese calcula el precio del COMPRADOR:
 * convierte a la moneda de quien mira, le suma el 2% de conversión y redondea al paso.
 * Con eso, la ganancia del creador salía en pesos y además inflada. Lo que él cobra vive
 * en la moneda de liquidación y no se convierte.
 *
 * La referencia en su moneda vive en el panel, bajo el estado de la publicación.
 */
/**
 * Lo que el creador lleva REUNIDO con este contenido: su parte por cada desbloqueo,
 * multiplicada por las veces que se ha desbloqueado.
 *
 * Devuelve dos frases distintas según haya o no conversión de moneda de por medio, y la
 * diferencia no es cosmética:
 *
 *  · Sin conversión (mira en la moneda de liquidación) → cifra EXACTA, sin "aproximado"
 *    y sin redondeo grueso. Es la suma real de su 75% de cada venta, y puede enseñarse
 *    tal cual porque no hay ningún tipo de cambio que la mueva.
 *  · Con conversión → REFERENCIA: redondeo grueso y "aproximado" delante. Convierte al
 *    cambio de HOY, pero cada venta entró al de SU día, así que la cifra en firme es la
 *    de la wallet y esta solo sirve para ubicarse.
 *
 * ⚠️ Da por hecho que todas las ventas fueron al precio actual. Si el creador cambió el
 * precio a mitad de camino, el acumulado se desvía; la cifra buena sigue siendo la del
 * ledger, que guarda lo cobrado en cada compra.
 *
 * Sin ventas devuelve null: un "acumulado de 0" no le dice nada a quien acaba de publicar.
 */
function etiquetaAcumulado(
  netoPorUnidad: number | null,
  unlockCount: number,
  pf: ReturnType<typeof usePriceFormat>,
  /**
   * Recorta la frase para donde el ancho manda. En el aviso del ticket en
   * celular, "Acumulado aproximado de …" parte en dos renglones y descuadra la
   * tarjeta entera, que ahí ya comparte fila con el título y el precio.
   */
  short = false
): string | null {
  if (netoPorUnidad == null || netoPorUnidad <= 0 || unlockCount <= 0) return null;
  const total = netoPorUnidad * unlockCount;

  if (pf.currency === SETTLEMENT_CURRENCY) {
    const importe = formatCurrency(total, SETTLEMENT_CURRENCY, pf.locale, { code: true });
    return short ? `Acumulado ${importe}` : `Acumulado de ${importe}`;
  }

  const local = pf.fromAnchor(total);
  if (local == null) return null;
  const importe = formatCurrency(
    roundReference(local, pf.currency),
    pf.currency,
    pf.locale,
    { code: true, approx: true }
  );
  return short ? `Acumulado aprox. ${importe}` : `Acumulado aproximado de ${importe}`;
}
function GananciaCreador({ neto }: { neto: number }) {
  const pf = usePriceFormat();
  const tPosts = useTranslations("posts");
  return (
    <>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontFamily: fontStack, lineHeight: 1.3 }}>
        {tPosts("premiumEarningsLabel")}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#4ade80", fontFamily: fontStack, lineHeight: 1.3, marginTop: 1 }}>
        {formatCurrency(neto, SETTLEMENT_CURRENCY, pf.locale, { code: true })}
      </div>
    </>
  );
}

export function PremiumPostPanel({
  state,
  onOpenPayment,
  overlay = false,
  oneTimePrice,
  unlockCount = 0,
  countWhenLocked = false,
  isMobile = false,
  isVod = false,
}: {
  state: PostPremiumStateResult;
  onOpenPayment?: () => void;
  overlay?: boolean;
  oneTimePrice?: number | null;
  unlockCount?: number;
  /** VOD con ticket (live grabado): usa su propia imagen de desbloqueo. */
  isVod?: boolean;
  /** Solo en público + pago simple el subtítulo bloqueado es redundante con el
   *  botón; ahí lo sustituimos por el contador. En "solo miembros"/"miembros
   *  gratis" conservamos ese mensaje de contexto. */
  countWhenLocked?: boolean;
  isMobile?: boolean;
}) {
  const tPosts = useTranslations("posts");
  const priceFmt = usePriceFormat();
  const isUnlocked = !state.isBlocked;
  const isAuthor = state.state === "unlocked_author";
  // El dueño siempre ve el contador; el visitante bloqueado solo cuando su
  // subtítulo sería el mensaje de precio redundante con el botón.
  const showUnlockCount = isAuthor || (state.isBlocked && countWhenLocked);

  let statusText: string | null = null;
  if (isAuthor) statusText = tPosts("premiumBelongsToYou");
  else if (state.hasAccessByMembership) statusText = tPosts("premiumAccessByMembership");
  else if (state.hasAccessBySubscription) statusText = tPosts("premiumAccessBySubscription");
  else if (state.hasAccessByPurchase) statusText = tPosts("premiumAlreadyHaveAccess");

  const netEarnings =
    isAuthor && typeof oneTimePrice === "number" && oneTimePrice > 0
      ? Math.round(oneTimePrice * WALLET_NET_RATE * 100) / 100 // = round2 del ledger
      : null;

  // Lo que lleva reunido con esta publicación. A la derecha ve lo que gana por cada
  // desbloqueo; aquí, la suma. Ver `etiquetaAcumulado`.
  const referenciaLocal = etiquetaAcumulado(netEarnings, unlockCount, priceFmt);

  return (
    <div
      style={{
        ...(overlay ? {} : { marginTop: 10 }),
        border: "1px solid rgba(168,85,255,0.32)",
        borderRadius: 12,
        background:
          `linear-gradient(160deg, rgba(79,70,255,0.38), rgba(168,85,255,0.32) 55%, rgba(139,92,246,0.28)), linear-gradient(rgba(0,0,0,0.62), rgba(0,0,0,0.62)), url('${isVod ? "/desbloquearvod.webp" : "/desbloquearcontenido.webp"}') center / cover no-repeat`,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: fontStack,
        overflow: "hidden",
      }}
    >
      <span style={{ flexShrink: 0, marginInlineStart: 4 }}>
        <VibraNavigationIcon
          type={isUnlocked ? "premiumUnlocked" : "premiumLock"}
          size={28}
        />
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "#a855f7",
            lineHeight: 1.3,
            fontFamily: fontStack,
          }}
        >
          {/* ⚠️ Para el CREADOR esta línea lleva su estado: de quién es la publicación y,
              en cuanto empiezan las compras, cuántas van. Antes eso vivía en la línea
              blanca de abajo y arriba había una etiqueta genérica que no le decía nada.
              Para un visitante no cambia: sigue viendo si el contenido está abierto. */}
          {isAuthor
            ? unlockCount > 0
              ? tPosts("premiumUnlockCount", { count: unlockCount })
              : tPosts("premiumBelongsToYou")
            : isUnlocked
              ? tPosts("premiumUnlockedLabel")
              : tPosts("premiumLockedLabel")}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#fff",
            lineHeight: 1.4,
            marginTop: 2,
            fontFamily: fontStack,
          }}
        >
          {/* Para el CREADOR, la referencia de su ganancia en su moneda. Para el resto, su
              estado o el mensaje de bloqueo, como siempre. */}
          {isAuthor
            ? referenciaLocal
            : showUnlockCount
              ? tPosts("premiumUnlockCount", { count: unlockCount })
              : isUnlocked
                ? (statusText ?? tPosts("premiumDefaultAccessText"))
                : (state.panelMessage ?? tPosts("premiumDefaultLockedText"))}
        </div>
      </div>

      {netEarnings !== null && (
        <div
          style={{
            flexShrink: 0,
            textAlign: "end",
            marginInlineEnd: 4,
          }}
        >
          <GananciaCreador neto={netEarnings} />
        </div>
      )}

      {/* Prueba social para quien ya desbloqueó: ese hueco es donde va el botón de compra,
          y sin botón quedaba vacío. Un solo renglón, alineado abajo.
          ⚠️ El número son DESBLOQUEOS, el mismo contador que ve el creador; el texto dice
          "vieron" porque se lee mejor. Con cero no se enseña: a quien acaba de comprar,
          un "0 personas" le sobra. */}
      {!state.isBlocked && !isAuthor && !isMobile && unlockCount > 0 && (
        <div
          style={{
            flexShrink: 0,
            alignSelf: "flex-end",
            marginInlineEnd: 4,
            whiteSpace: "nowrap",
            fontSize: 10,
            lineHeight: 1.35,
            color: "rgba(255,255,255,0.55)",
            fontFamily: fontStack,
          }}
        >
          {tPosts("premiumViewedCount", { count: unlockCount })}
        </div>
      )}

      {state.isBlocked && !isMobile && (
        <button
          type="button"
          onClick={onOpenPayment}
          aria-label={tPosts("premiumUnlockAriaLabel")}
          style={{
            height: 30,
            padding: "0 10px",
            border: "none",
            borderRadius: 6,
            background: "linear-gradient(135deg, #4f46ff, #a855f7, #ff2fb3)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: fontStack,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
            whiteSpace: "nowrap",
            marginInlineEnd: 4,
          }}
        >
          <VibraNavigationIcon type="premiumCrown" size={17} />
          {/* Monto ya con todo incluido: (base + $3) + IVA. La pasarela desglosa solo el IVA. */}
          {tPosts("premiumUnlockForPrice", { price: priceFmt.formatWithTax((oneTimePrice ?? 0) + FIXED_SERVICE_FEE_USD, { baseCurrency: SETTLEMENT_CURRENCY }).total })}
        </button>
      )}
    </div>
  );
}

export function LiveTicketPanel({
  ticketPrice,
  isAuthor,
  onBuyTicket,
  overlay = false,
  highlighted = false,
  paid = false,
  memberFree = false,
  unlockCount = 0,
  isMobile = false,
}: {
  ticketPrice: number | null;
  isAuthor: boolean;
  onBuyTicket: () => void;
  overlay?: boolean;
  highlighted?: boolean;
  paid?: boolean;
  memberFree?: boolean;
  unlockCount?: number;
  /** En celular el botón de compra se saca del card y va debajo de la portada. */
  isMobile?: boolean;
}) {
  const tPosts = useTranslations("posts");
  const priceFmt = usePriceFormat();
  // El comprador ve el precio YA con todo incluido: (base + $3) + IVA.
  // La pasarela desglosa solo el IVA (recibe amount = base + $3).
  const priceLabel = ticketPrice
    ? priceFmt.formatWithTax(ticketPrice + FIXED_SERVICE_FEE_USD, { baseCurrency: SETTLEMENT_CURRENCY }).total
    : tPosts("liveTicketPriceUndefined");

  // Lo que lleva reunido con este live. Mismo ayudante que el panel de post premium, para
  // que las dos tarjetas no puedan decir cosas distintas. Ver `etiquetaAcumulado`.
  const acumuladoLocal = etiquetaAcumulado(
    isAuthor && typeof ticketPrice === "number" && ticketPrice > 0
      ? ticketPrice * WALLET_NET_RATE
      : null,
    unlockCount,
    priceFmt,
    isMobile
  );

  const isPaid = paid && !isAuthor;
  const isMemberFree = memberFree && !isAuthor;
  // ⚠️ El panel es SIEMPRE el mismo, pagado o no: mismo degradado morado, mismo borde y
  // mismo acento que el de post premium y VOD. Lo que cambia es la INFORMACIÓN, no el
  // color.
  //
  // Antes, al comprar la entrada se volvía rojo oscuro con acentos rojos. El rojo en esta
  // interfaz significa problema —error de pago, contenido bloqueado—, así que el momento
  // de mayor satisfacción del comprador se le presentaba con el color de una advertencia.
  // En premium y VOD nunca fue así, y no había razón para que aquí lo fuera.
  const borderColor = "rgba(168,85,255,0.32)";
  const bgColor =
    "linear-gradient(160deg, rgba(79,70,255,0.38), rgba(168,85,255,0.32) 55%, rgba(139,92,246,0.28)), linear-gradient(rgba(0,0,0,0.62), rgba(0,0,0,0.62)), url('/desbloquearcontenido.webp') center / cover no-repeat";
  const iconStroke = "#a855f7";
  const titleColor = "#a855f7";
  // Ganancia del creador (75% de la base), como en el panel de post premium.
  const netEarnings =
    isAuthor && typeof ticketPrice === "number" && ticketPrice > 0
      ? Math.round(ticketPrice * WALLET_NET_RATE * 100) / 100 // = round2 del ledger
      : null;

  return (
    <div
      style={overlay ? {
        position: "absolute",
        bottom: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 4,
        width: "calc(100% - 24px)",
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        overflow: "hidden",
        background: bgColor,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: fontStack,
        animation: highlighted ? "liveTicketPop 0.6s ease" : undefined,
        transformOrigin: "bottom center",
      } : {
        marginTop: 10,
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        overflow: "hidden",
        background: bgColor,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: fontStack,
      }}
    >
      <span style={{ flexShrink: 0, marginInlineStart: overlay ? 0 : 4 }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={iconStroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 5v2" />
          <path d="M15 11v2" />
          <path d="M15 17v2" />
          <path d="M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z" />
        </svg>
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: titleColor, lineHeight: 1.3, fontFamily: fontStack }}>
          {isAuthor
            // En celular, la frase larga parte en dos renglones y descuadra el
            // aviso, que ahí ya vive fuera de la portada y compite por el ancho
            // con el contador de accesos. En laptop hay sitio y se queda.
            ? tPosts(isMobile ? "liveTicketAuthorTitleShort" : "liveTicketAuthorTitle")
            : isPaid ? tPosts("liveTicketPaidTitle")
            : isMemberFree ? tPosts("liveTicketMemberFreeTitle")
            : tPosts("liveTicketRequiredTitle")}
        </div>
        <div style={{ fontSize: 10, color: "#fff", lineHeight: 1.4, marginTop: 2, fontFamily: fontStack }}>
          {/* Al CREADOR no se le invita a comprar su propia entrada: se le dice cuánto
              lleva reunido, igual que en post premium y VOD. Sin ventas todavía no se
              enseña nada: un "acumulado de 0" no informa. */}
          {isAuthor
            ? acumuladoLocal
            : isPaid
              ? tPosts("liveTicketAlreadyHaveAccess")
              : isMemberFree
                ? tPosts("liveTicketMemberFreeAccess")
                : tPosts("liveTicketBuyCount", { count: unlockCount })}
        </div>
      </div>

      {netEarnings !== null && (
        <div style={{ flexShrink: 0, textAlign: "end", marginInlineEnd: 4 }}>
          <GananciaCreador neto={netEarnings} />
        </div>
      )}

      {/* Igual que en post premium y VOD: quien ya tiene su entrada no necesita
          botón, y ese hueco quedaba vacío. Se le dice cuánta gente más tiene
          acceso, que es lo que de verdad le interesa a quien ya pagó: con
          cuántos va a compartir la transmisión. Sin ventas no se enseña.

          En celular NO: la tarjeta comparte fila con el título y el precio, y
          una frase larga a la derecha la parte en dos renglones. */}
      {isPaid && !isMobile && unlockCount > 0 && (
        <div
          style={{
            flexShrink: 0,
            // A la altura del TÍTULO, no del pie. El aviso tiene dos renglones
            // y el de arriba es el que dice de qué va; colgado del de abajo se
            // emparejaba con la letra pequeña y se leía como una nota al pie.
            alignSelf: "flex-start",
            marginInlineEnd: 4,
            whiteSpace: "nowrap",
            fontSize: 10,
            lineHeight: 1.35,
            color: "rgba(255,255,255,0.55)",
            fontFamily: fontStack,
          }}
        >
          {tPosts("liveTicketAccessCount", { count: unlockCount })}
        </div>
      )}

      {!isMobile && !isAuthor && !isPaid && !isMemberFree && (
        <button
          type="button"
          onClick={onBuyTicket}
          style={{
            height: 30,
            padding: "0 10px",
            border: "none",
            borderRadius: 6,
            background: "linear-gradient(135deg, #4f46ff, #a855f7, #ff2fb3)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: fontStack,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
            whiteSpace: "nowrap",
            marginInlineEnd: 4,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5v2" />
            <path d="M15 11v2" />
            <path d="M15 17v2" />
            <path d="M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z" />
          </svg>
          {/* Precio ya con todo incluido (base + $3 + IVA) DENTRO del botón, como premium. */}
          {tPosts("liveTicketBuyForPrice", { price: priceLabel })}
        </button>
      )}
    </div>
  );
}

export function Avatar({
  name,
  avatarUrl,
  size = 38,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={name}
        width={size} height={size}
        style={{
          borderRadius: "50%",
          objectFit: "cover",
          display: "block",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "#fff",
        fontSize: Math.max(11, Math.floor(size * 0.32)),
        fontWeight: 500,
        letterSpacing: "-0.02em",
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}

export type MediaGridVideoItemHandle = {
  seek: (t: number) => void;
  getVideoElement: () => HTMLVideoElement | null;
  getFeedSlot: () => HTMLDivElement | null;
};

type MediaGridVideoItemProps = {
  hlsUrl?: string | null;
  playbackUrl?: string | null;
  thumbnailUrl?: string | null;
  duration?: number | null;
  tileStyle: CSSProperties;
  onRatioLoaded: (ratio: number) => void;
  onLoadError: () => void;
  onTimeUpdate?: (time: number) => void;
};

export const MediaGridVideoItem = forwardRef<MediaGridVideoItemHandle, MediaGridVideoItemProps>(
  function MediaGridVideoItem(
    { hlsUrl, playbackUrl, thumbnailUrl, duration, onRatioLoaded, onLoadError, onTimeUpdate },
    ref
  ) {
    const feedSlotRef = useRef<HTMLDivElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const localHlsRef = useRef<Hls | null>(null);
    const [metadataLoaded, setMetadataLoaded] = useState(false);
    const [remainingSeconds, setRemainingSeconds] = useState<number | null>(
      typeof duration === "number" && duration > 0 ? Math.ceil(duration) : null
    );

    // Stable refs for callbacks — avoids re-running event listener effects on every render
    const onRatioLoadedRef = useRef(onRatioLoaded);
    // eslint-disable-next-line react-hooks/refs
    onRatioLoadedRef.current = onRatioLoaded;
    const onLoadErrorRef = useRef(onLoadError);
    // eslint-disable-next-line react-hooks/refs
    onLoadErrorRef.current = onLoadError;
    const onTimeUpdateRef = useRef(onTimeUpdate);
    // eslint-disable-next-line react-hooks/refs
    onTimeUpdateRef.current = onTimeUpdate;
    const durationRef = useRef(duration);
    // eslint-disable-next-line react-hooks/refs
    durationRef.current = duration;

    const src = hlsUrl ?? playbackUrl ?? null;
    const srcRef = useRef(src);
    // eslint-disable-next-line react-hooks/refs
    srcRef.current = src;

    useImperativeHandle(ref, () => ({
      seek(t: number) {
        const video = videoRef.current;
        if (video) video.currentTime = t;
      },
      getVideoElement() { return videoRef.current; },
      getFeedSlot() { return feedSlotRef.current; },
    }), []);

    // Create video element imperatively on mount so it can be moved between slots without remounting
    useEffect(() => {
      const slot = feedSlotRef.current;
      if (!slot) return;

      const video = document.createElement("video");
      video.muted = true;
      video.setAttribute("playsinline", "");
      video.draggable = false;
      Object.assign(video.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        objectFit: "cover",
        background: "#050505",
        display: "block",
        touchAction: "pan-y",
      });
      if (thumbnailUrl) video.poster = thumbnailUrl;

      videoRef.current = video;
      slot.appendChild(video);

      return () => {
        video.pause();
        video.remove();
        videoRef.current = null;
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Update poster when thumbnailUrl changes
    useEffect(() => {
      const video = videoRef.current;
      if (video) video.poster = thumbnailUrl ?? "";
    }, [thumbnailUrl]);

    // HLS setup — re-runs when src changes
    useEffect(() => {
      const video = videoRef.current;
      if (!video || !src) return;
      localHlsRef.current?.destroy();
      localHlsRef.current = null;
      video.muted = true;
      if (src.includes(".m3u8") && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, startLevel: -1, maxBufferLength: 30 });
        localHlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
      } else {
        video.src = src;
      }
      return () => {
        localHlsRef.current?.destroy();
        localHlsRef.current = null;
        video.removeAttribute("src");
        video.load();
      };
    }, [src]);

    // Event listeners via addEventListener so the video element can move between slots
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      function handleLoadedMetadata() {
        const v = videoRef.current;
        if (!v) return;
        const ratio = v.videoWidth > 0 && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 1;
        setMetadataLoaded(true);
        onRatioLoadedRef.current(ratio);
        const dur = durationRef.current;
        if (typeof dur === "number" && dur > 0) {
          setRemainingSeconds(Math.ceil(Math.max(0, dur - v.currentTime)));
        }
      }

      function handleTimeUpdate() {
        const v = videoRef.current;
        if (!v) return;
        onTimeUpdateRef.current?.(v.currentTime);
        const dur = durationRef.current;
        if (typeof dur === "number" && dur > 0) {
          const newR = Math.ceil(Math.max(0, dur - v.currentTime));
          setRemainingSeconds((prev) => (prev !== newR ? newR : prev));
        }
      }

      function handleError() { onLoadErrorRef.current(); }

      video.addEventListener("loadedmetadata", handleLoadedMetadata);
      video.addEventListener("timeupdate", handleTimeUpdate);
      video.addEventListener("error", handleError);

      return () => {
        video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        video.removeEventListener("timeupdate", handleTimeUpdate);
        video.removeEventListener("error", handleError);
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Autoplay via IntersectionObserver — re-runs when src or metadataLoaded change
    useEffect(() => {
      const video = videoRef.current;
      if (!video || !src || !metadataLoaded) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry) return;
          if (entry.intersectionRatio >= 0.5) {
            video.play().catch(() => undefined);
          } else {
            video.pause();
          }
        },
        { threshold: [0, 0.5] }
      );
      observer.observe(video);
      return () => observer.disconnect();
    }, [src, metadataLoaded]);

    // Pause when any other video starts playing
    useEffect(() => {
      function handleOtherVideoPlay(e: Event) {
        const video = videoRef.current;
        if (video && e.target !== video) video.pause();
      }
      document.addEventListener("play", handleOtherVideoPlay, true);
      return () => document.removeEventListener("play", handleOtherVideoPlay, true);
    }, []);

    const durationLabel = remainingSeconds !== null ? formatMediaDuration(remainingSeconds) : null;

    return (
      <div
        ref={feedSlotRef}
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "pan-y",
          overflow: "hidden",
        }}
      >
        {durationLabel && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              insetInlineEnd: 8,
              bottom: 8,
              zIndex: 3,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.01em",
              textShadow: "0 1px 4px rgba(0,0,0,0.5)",
              pointerEvents: "none",
            }}
          >
            {durationLabel}
          </span>
        )}
      </div>
    );
  }
);
