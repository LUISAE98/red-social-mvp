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
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import type { PostPremiumStateResult } from "@/lib/posts/post-premium-state";
import { fontStack, getInitials, formatMediaDuration } from "./GroupPostCard.utils";

export function PremiumPostPanel({
  state,
  onOpenPayment,
  overlay = false,
  oneTimePrice,
  currency,
  unlockCount = 0,
  countWhenLocked = false,
  isMobile = false,
}: {
  state: PostPremiumStateResult;
  onOpenPayment?: () => void;
  overlay?: boolean;
  oneTimePrice?: number | null;
  currency?: string | null;
  unlockCount?: number;
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
      ? Math.floor(oneTimePrice * 0.77)
      : null;

  return (
    <div
      style={{
        ...(overlay ? {} : { marginTop: 10 }),
        border: "1px solid rgba(168,85,255,0.32)",
        borderRadius: 12,
        background:
          "linear-gradient(160deg, rgba(79,70,255,0.38), rgba(168,85,255,0.32) 55%, rgba(139,92,246,0.28)), linear-gradient(rgba(0,0,0,0.62), rgba(0,0,0,0.62)), url('/desbloquearcontenido.webp') center / cover no-repeat",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: fontStack,
        overflow: "hidden",
      }}
    >
      <span style={{ flexShrink: 0, marginLeft: 4 }}>
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
            color: "#a855ff",
            lineHeight: 1.3,
            fontFamily: fontStack,
          }}
        >
          {isUnlocked ? tPosts("premiumUnlockedLabel") : tPosts("premiumLockedLabel")}
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
          {showUnlockCount
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
            textAlign: "right",
            marginRight: 4,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.7)",
              fontFamily: fontStack,
              lineHeight: 1.3,
            }}
          >
            {tPosts("premiumEarningsLabel")}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#4ade80",
              fontFamily: fontStack,
              lineHeight: 1.3,
              marginTop: 1,
            }}
          >
            {priceFmt.format(netEarnings, { baseCurrency: currency ?? "MXN", code: true })}
          </div>
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
            background: "linear-gradient(135deg, #4f46ff, #a855ff, #ff2fb3)",
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
            marginRight: 4,
          }}
        >
          <VibraNavigationIcon type="premiumCrown" size={17} />
          {tPosts("premiumUnlockForPrice", { price: priceFmt.format(oneTimePrice ?? 0, { baseCurrency: currency ?? "MXN", code: true }) })}
        </button>
      )}
    </div>
  );
}

export function LiveTicketPanel({
  ticketPrice,
  currency,
  isAuthor,
  onBuyTicket,
  overlay = false,
  highlighted = false,
  paid = false,
  memberFree = false,
}: {
  ticketPrice: number | null;
  currency: string | null;
  isAuthor: boolean;
  onBuyTicket: () => void;
  overlay?: boolean;
  highlighted?: boolean;
  paid?: boolean;
  memberFree?: boolean;
}) {
  const tPosts = useTranslations("posts");
  const priceFmt = usePriceFormat();
  const priceLabel = ticketPrice
    ? priceFmt.format(ticketPrice, { baseCurrency: currency ?? "MXN", code: true })
    : tPosts("liveTicketPriceUndefined");

  const isPaid = paid && !isAuthor;
  const isMemberFree = memberFree && !isAuthor;
  const borderColor = isPaid
    ? "rgba(239,68,68,0.45)"
    : "rgba(168,85,255,0.32)";
  const bgColor = isPaid
    ? "rgba(20,5,5,0.88)"
    : "rgba(10,5,25,0.82)";
  const iconStroke = isPaid ? "#fca5a5" : "#a855ff";
  const titleColor = isPaid ? "#fca5a5" : "#d8b4fe";

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
        background:
          "linear-gradient(160deg, rgba(79,70,255,0.26), rgba(168,85,255,0.22) 55%, rgba(139,92,246,0.18))",
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: fontStack,
      }}
    >
      <span style={{ flexShrink: 0, marginLeft: overlay ? 0 : 4 }}>
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
            ? tPosts("liveTicketAuthorTitle")
            : isPaid ? tPosts("liveTicketPaidTitle")
            : isMemberFree ? tPosts("liveTicketMemberFreeTitle")
            : tPosts("liveTicketRequiredTitle")}
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", lineHeight: 1.4, marginTop: 2, fontFamily: fontStack }}>
          {isAuthor
            ? tPosts("liveTicketPriceLabel", { price: priceLabel })
            : isPaid
              ? tPosts("liveTicketAlreadyHaveAccess")
              : isMemberFree
                ? tPosts("liveTicketMemberFreeAccess")
                : tPosts("liveTicketBuyPrompt", { price: priceLabel })}
        </div>
      </div>

      {!isAuthor && !isPaid && !isMemberFree && (
        <button
          type="button"
          onClick={onBuyTicket}
          style={{
            height: 30,
            padding: "0 10px",
            border: "none",
            borderRadius: 6,
            background: "linear-gradient(135deg, #4f46ff, #a855ff, #ff2fb3)",
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
            marginRight: 4,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5v2" />
            <path d="M15 11v2" />
            <path d="M15 17v2" />
            <path d="M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z" />
          </svg>
          {tPosts("liveTicketBuyButton")}
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
              right: 8,
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
