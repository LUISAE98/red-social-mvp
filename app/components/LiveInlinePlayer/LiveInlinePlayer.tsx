"use client";

import Image from "next/image";
import { frasePorVoz } from "@/lib/liveChat/super-comment-service";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { useTranslations , useLocale } from "next-intl";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Hls from "hls.js";
import { auth } from "@/lib/firebase";
import type { ActiveSuperComment } from "@/lib/posts/types";
import { TTS_MIN_DURATION_SECS } from "@/lib/tts/edge-tts-client";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { FIXED_SERVICE_FEE_USD } from "@/lib/currency/catalog";

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

// ── Coordinador global: solo un video activo al mismo tiempo ──────────────────
let _activeVideo: HTMLVideoElement | null = null;

function activateVideo(video: HTMLVideoElement) {
  if (_activeVideo && _activeVideo !== video) {
    _activeVideo.pause();
  }
  _activeVideo = video;
}

function deactivateVideo(video: HTMLVideoElement) {
  if (_activeVideo === video) _activeVideo = null;
}
// ─────────────────────────────────────────────────────────────────────────────

const fontStack = 'inherit';

// Thumbnail en tiempo real de CF Stream mientras conecta WebRTC
function CfThumbnail({ url, ts, title }: { url: string; ts: number; title?: string | null }) {
  const tLive = useTranslations("live");
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  useEffect(() => {
    const src = `${url}?_t=${ts}`;
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => { if (!cancelled) setLoadedSrc(src); };
    img.src = src;
    return () => { cancelled = true; img.onload = null; };
  }, [url, ts]);

  if (!loadedSrc) {
    return (
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 10,
        color: "rgba(255,255,255,0.55)", fontFamily: fontStack, fontSize: 13,
        textAlign: "center", padding: "0 20px",
      }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round"
          style={{ animation: "liveInlineSpin 1s linear infinite", flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.15)" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="rgba(255,255,255,0.7)" />
        </svg>
        {tLive("connectingToLive")}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={loadedSrc}
      alt={title ?? tLive("liveAlt")}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}

const FONT = 'SF Pro Text, SF Pro Display, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

type Props = {
  postId?: string | null;
  playbackId?: string | null;
  hlsUrl?: string | null;
  title?: string | null;
  coverUrl?: string | null;
  portrait?: boolean;
  isVod?: boolean;
  paused?: boolean;
  streamProvider?: string | null;
  broadcastMode?: string | null;
  activeSuper?: ActiveSuperComment | null;
  isViewerOpen?: boolean;
  onClick?: () => void;
  onOrientationDetected?: (portrait: boolean) => void;
  onStreamReady?: (stream: MediaStream | null) => void;
  /**
   * Si arranca en silencio. Por omisión sí: es lo único que los navegadores
   * dejan reproducir sin que el usuario haya tocado nada.
   */
  /**
   * Como encaja la imagen en su hueco. Por omision decide el reproductor.
   *
   * A pantalla completa hace falta poder imponer "contain": una transmision
   * horizontal recortada a un hueco vertical se come la mitad de la escena.
   */
  fit?: "cover" | "contain";
  initialMuted?: boolean;
  /**
   * Avisa de cada cambio de sonido, INCLUIDO el silencio que impone el navegador
   * cuando bloquea la reproducción con audio. Sirve para que quien lo monta
   * mantenga una sola preferencia de sonido para toda su superficie.
   */
  onMutedChange?: (muted: boolean) => void;
};

export default function LiveInlinePlayer({
  postId,
  playbackId,
  hlsUrl: hlsUrlProp,
  title,
  coverUrl,
  portrait = false,
  isVod = false,
  paused = false,
  streamProvider,
  broadcastMode,
  activeSuper,
  isViewerOpen = false,
  onClick,
  onOrientationDetected,
  onStreamReady,
  fit,
  initialMuted = true,
  onMutedChange,
}: Props) {
  const tGroups = useTranslations("groups");
  const locale = useLocale();
  const tCommon = useTranslations("common");
  const tLive = useTranslations("live");
  const pf = usePriceFormat();
  // Monto mostrado de una donación = total que pagó el fan (base + cargo fijo + impuesto del país) en MXN.
  // `baseCurrency:"MXN"` evita el bug ×FX (tratar el MXN como USD → 1095).
  const fanPaidTotal = (baseMxn: number) =>
    pf.formatWithTax(baseMxn + FIXED_SERVICE_FEE_USD, { baseCurrency: SETTLEMENT_CURRENCY, code: true }).total;
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const cfPcRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const isIntersectingRef = useRef(false);
  const prevScKeyRef = useRef<string | null>(null);

  const [muted, setMuted] = useState(initialMuted);
  const mutedRef = useRef(initialMuted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // El primer aviso se salta: arrancar con un valor no es cambiarlo.
  const onMutedChangeRef = useRef(onMutedChange);
  useEffect(() => { onMutedChangeRef.current = onMutedChange; });
  const mutedReportedRef = useRef(false);
  useEffect(() => {
    if (!mutedReportedRef.current) { mutedReportedRef.current = true; return; }
    onMutedChangeRef.current?.(muted);
  }, [muted]);

  // ── SC overlay state ───────────────────────────────────────────────────────
  const [activeSC, setActiveSC] = useState<ActiveSuperComment | null>(null);
  const [scFadingOut, setScFadingOut] = useState(false);
  const activeSCRef = useRef<ActiveSuperComment | null>(null);
  const isViewerOpenRef = useRef(isViewerOpen);
  const overlayTimerRef = useRef<number | null>(null);
  const fadeOutTimerRef = useRef<number | null>(null);
  const scDelayTimerRef = useRef<number | null>(null);
  const ttsAudioRef = useRef<EdgeTTSHandle | null>(null);
  const prewarmAudioRef = useRef<HTMLAudioElement | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [cfThumbTs, setCfThumbTs] = useState(() => Date.now());

  const rawHlsUrl = hlsUrlProp ?? (playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : "");
  const hlsUrl = rawHlsUrl ? rawHlsUrl.split("?")[0] : "";

  // broadcastMode es más confiable que streamProvider (evita datos stale de lives anteriores)
  const isCfLive = broadcastMode != null ? broadcastMode === "direct" : streamProvider === "cloudflare";
  // CF thumbnail para mostrar mientras conecta WebRTC (puede fallar → spinner)
  const cfThumbnailUrl = isCfLive && hlsUrl
    ? hlsUrl.replace("/manifest/video.m3u8", "/thumbnails/thumbnail.jpg")
    : null;

  // ── SC overlay + TTS ─────────────────────────────────────────────────────────
  function triggerFadeOut() {
    if (overlayTimerRef.current !== null) { window.clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
    if (fadeOutTimerRef.current !== null) return;
    setScFadingOut(true);
    fadeOutTimerRef.current = window.setTimeout(() => {
      activeSCRef.current = null;
      setActiveSC(null);
      setScFadingOut(false);
      fadeOutTimerRef.current = null;
    }, 700);
  }

  function showOverlay(sc: ActiveSuperComment, durationSecs: number) {
    setScFadingOut(false);
    if (fadeOutTimerRef.current !== null) { window.clearTimeout(fadeOutTimerRef.current); fadeOutTimerRef.current = null; }
    if (overlayTimerRef.current !== null) { window.clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }

    activeSCRef.current = sc;
    setActiveSC(sc);

    if (!isViewerOpenRef.current && durationSecs >= TTS_MIN_DURATION_SECS) {
      if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
      const fullText = frasePorVoz(sc, locale);
      const elapsed = sc.displaySeconds - durationSecs;
      const progressRatio = elapsed > 0 ? Math.min(elapsed / sc.displaySeconds, 0.95) : 0;
      const startChar = Math.floor(progressRatio * fullText.length);
      const ttsSlice = startChar > 0 ? fullText.slice(startChar) : fullText;
      // iOS-safe: reutilizar elemento prewarmed (desbloqueado en gesto del usuario)
      const audio = prewarmAudioRef.current ?? document.createElement("audio");
      audio.pause();
      audio.src = `/api/tts?text=${encodeURIComponent(ttsSlice)}&voice=es-MX-DaliaNeural`;
      audio.volume = mutedRef.current ? 0 : 1;
      if (!mutedRef.current) audio.play().catch(() => {});
      ttsAudioRef.current = {
        audio,
        stop: () => { audio.pause(); audio.src = ""; },
        setVolume: (v: number) => {
          audio.volume = v;
          if (v === 0) {
            audio.pause();
          } else if (audio.paused && activeSCRef.current) {
            audio.play().catch(() => {});
          }
        },
      };
      // Hide overlay as soon as TTS finishes — don't wait for the full display timer
      audio.addEventListener("ended", () => {
        if (overlayTimerRef.current !== null) { window.clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
        ttsAudioRef.current = null;
        overlayTimerRef.current = window.setTimeout(() => {
          overlayTimerRef.current = null;
          triggerFadeOut();
        }, 500);
      }, { once: true });
    }

    overlayTimerRef.current = window.setTimeout(() => {
      overlayTimerRef.current = null;
      if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
      triggerFadeOut();
    }, durationSecs * 1000);
  }

  // Nuevo SC: muestra overlay solo para CF (en Mux el SC va embebido en el video vía Browser Source)
  useEffect(() => {
    if (isViewerOpenRef.current) return;
    // Usar broadcastMode (confiable) en vez de streamProvider (puede llegar stale de un live anterior de CF)
    if (broadcastMode !== "direct") return;
    if (!activeSuper) {
      if (activeSCRef.current) {
        // El creador detuvo el SC — cancelar TTS y cerrar overlay
        if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
        triggerFadeOut(); // eslint-disable-line react-hooks/set-state-in-effect
      }
      return;
    }
    const scKey = `${activeSuper.id}:${activeSuper.scheduledAt ?? 0}`;
    if (scKey === prevScKeyRef.current) return;
    prevScKeyRef.current = scKey;

    // Cancelar timer pendiente de un SC anterior (no usar cleanup del efecto:
    // el cleanup cancela el timer cuando Firestore reenvía el mismo SC con nueva
    // referencia de objeto, y el dedup impediría crear uno nuevo → SC perdido)
    if (scDelayTimerRef.current !== null) { window.clearTimeout(scDelayTimerRef.current); scDelayTimerRef.current = null; }

    if (activeSuper.scheduledAt != null) {
      const delay = activeSuper.scheduledAt - Date.now();
      if (delay > 0) {
        scDelayTimerRef.current = window.setTimeout(() => {
          scDelayTimerRef.current = null;
          if (!isViewerOpenRef.current) showOverlay(activeSuper, activeSuper.displaySeconds);
        }, delay);
        return;
      }
      const remainingSecs = activeSuper.displaySeconds + delay / 1000;
      if (remainingSecs < 1) return;
      showOverlay(activeSuper, remainingSecs);
    } else {
      showOverlay(activeSuper, activeSuper.displaySeconds);
    }
  }, [activeSuper]); // eslint-disable-line react-hooks/exhaustive-deps

  // Viewer abre/cierra: ceder o retomar control del overlay y TTS
  useEffect(() => {
    isViewerOpenRef.current = isViewerOpen;
    if (isViewerOpen) {
      // Viewer toma el control — parar timers y TTS del feed
      if (overlayTimerRef.current !== null) { window.clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
      if (fadeOutTimerRef.current !== null) { window.clearTimeout(fadeOutTimerRef.current); fadeOutTimerRef.current = null; }
      if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
      activeSCRef.current = null;
      setActiveSC(null); // eslint-disable-line react-hooks/set-state-in-effect
      setScFadingOut(false);
    } else {
      // Viewer cerró — retomar SC si sigue activo
      const sc = activeSuper;
      if (!sc) return;
      const now = Date.now();
      const elapsed = sc.scheduledAt != null ? (now - sc.scheduledAt) / 1000 : 0;
      const remaining = sc.displaySeconds - elapsed;
      if (remaining < 1) return;
      const scKey = `${sc.id}:${sc.scheduledAt ?? 0}`;
      prevScKeyRef.current = scKey;
      showOverlay(sc, remaining);
    }
  }, [isViewerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mute/unmute: ajuste de volumen en tiempo real
  useEffect(() => {
    if (ttsAudioRef.current) ttsAudioRef.current.setVolume(muted ? 0 : 1);
  }, [muted]);

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      if (overlayTimerRef.current !== null) window.clearTimeout(overlayTimerRef.current);
      if (fadeOutTimerRef.current !== null) window.clearTimeout(fadeOutTimerRef.current);
      if (scDelayTimerRef.current !== null) window.clearTimeout(scDelayTimerRef.current);
      if (ttsAudioRef.current) { ttsAudioRef.current.stop(); ttsAudioRef.current = null; }
    };
  }, []);

  // Reset visual state cuando cambia la fuente (solo para non-CF)
  useEffect(() => {
    if (isCfLive) return;
    setReady(false); // eslint-disable-line react-hooks/set-state-in-effect
    setError(false);
  }, [hlsUrl, isCfLive]);

  // ── WebRTC (CF Vibra Directo) ─────────────────────────────────────────────
  // CF no envía CORS headers desde el browser — se usa el mismo proxy que el viewer modal.
  useEffect(() => {
    if (!isCfLive || !postId) return;

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: "stun:stun.l.google.com:19302" },
      ],
    });
    cfPcRef.current = pc;

    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;

    pc.ontrack = ({ track }) => {
      if (cancelled) return;
      if (!remoteStream.getTrackById(track.id)) remoteStream.addTrack(track);

      if (video.srcObject !== remoteStream) {
        video.srcObject = remoteStream;
        onStreamReady?.(remoteStream);

        video.addEventListener("loadedmetadata", () => {
          if (!cancelled) {
            setReady(true);
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              onOrientationDetected?.(video.videoHeight > video.videoWidth);
            }
          }
        }, { once: true });

        video.addEventListener("canplay", () => {
          if (!cancelled) setReady(true);
        }, { once: true });

        activateVideo(video);
        video.play().catch(() => {
          video.muted = true;
          setMuted(true);
          activateVideo(video);
          video.play().catch(() => {});
        });
      }
    };

    pc.addEventListener("connectionstatechange", () => {
      if (!cancelled && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) {
        setError(true);
      }
    });

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Esperar a que ICE gathering termine (max 5s)
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === "complete") { resolve(); return; }
          const timer = setTimeout(resolve, 5000);
          const handler = () => {
            if (pc.iceGatheringState === "complete") {
              clearTimeout(timer);
              pc.removeEventListener("icegatheringstatechange", handler);
              resolve();
            }
          };
          pc.addEventListener("icegatheringstatechange", handler);
        });

        if (cancelled) return;

        const sdp = pc.localDescription?.sdp;
        if (!sdp) return;

        // El proxy exige identidad para los lives que no son "para todos"
        // (comunidad oculta o alcance solo-miembros). Para los públicos el token
        // es opcional y el deslogueado sigue entrando sin él.
        const idToken = await auth.currentUser?.getIdToken().catch(() => null);

        const resp = await fetch(`/api/cf-viewer-proxy?postId=${encodeURIComponent(postId)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/sdp",
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: sdp,
        });

        if (!resp.ok || cancelled) return;

        const answer = await resp.text();
        if (cancelled) return;

        await pc.setRemoteDescription({ type: "answer", sdp: answer });
      } catch {
        // Fallo silencioso en el feed (no bloquear la experiencia)
      }
    })();

    return () => {
      cancelled = true;
      onStreamReady?.(null);
      try { pc.close(); } catch { /* best effort */ }
      cfPcRef.current = null;
      remoteStreamRef.current = null;
      if (video) { video.srcObject = null; }
      setReady(false);
    };
  }, [isCfLive, postId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresca el thumbnail de CF cada 5s mientras conecta
  useEffect(() => {
    if (!cfThumbnailUrl || ready) return;
    const id = setInterval(() => setCfThumbTs(Date.now()), 5000);
    return () => clearInterval(id);
  }, [cfThumbnailUrl, ready]);

  // ── HLS (Mux / OBS) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isCfLive) return; // CF usa WebRTC arriba

    const video = videoRef.current;
    if (!video) return;

    const tryDetectOrientation = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        onOrientationDetected?.(video.videoHeight > video.videoWidth);
        return true;
      }
      return false;
    };

    const onMeta = () => {
      setReady(true);
      if (!tryDetectOrientation()) {
        video.addEventListener("loadeddata", tryDetectOrientation, { once: true });
        video.addEventListener("canplay", tryDetectOrientation, { once: true });
      }
    };

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startLevel: -1,
        autoStartLoad: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        liveDurationInfinity: true,
        abrEwmaFastLive: 3.0,
        abrEwmaSlowLive: 9.0,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 5,
        fragLoadingMaxRetry: 8,
        manifestLoadingMaxRetry: 6,
        levelLoadingMaxRetry: 6,
        backBufferLength: 30,
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.addEventListener("loadedmetadata", onMeta, { once: true });
        setReady(true);
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError(true);
      });
      hlsRef.current = hls;
      return () => { hls.destroy(); hlsRef.current = null; };
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      video.addEventListener("loadedmetadata", onMeta, { once: true });
    } else {
      setError(true); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [hlsUrl, isCfLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause/resume cuando el modal del live está abierto
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) {
      video.pause();
    } else if (isIntersectingRef.current) {
      activateVideo(video);
      video.play().catch(() => {});
    }
  }, [paused]);

  // Autoplay / pause on scroll via IntersectionObserver
  // Solo un video puede estar activo globalmente (coordinador de módulo)
  useEffect(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.intersectionRatio >= 0.5;
        isIntersectingRef.current = visible;
        if (visible && !pausedRef.current) {
          activateVideo(video);
          video.play().catch(() => {});
        } else {
          deactivateVideo(video);
          video.pause();
          if (!isViewerOpenRef.current && ttsAudioRef.current) {
            ttsAudioRef.current.stop();
            ttsAudioRef.current = null;
          }
        }
      },
      { threshold: [0, 0.5] }
    );
    observer.observe(container);
    return () => {
      observer.disconnect();
      deactivateVideo(video);
    };
  }, []);

  const wrapper: CSSProperties = {
    position: "relative",
    width: "100%",
    aspectRatio: (portrait && !isVod) ? "9 / 16" : "16 / 9",
    background: "#000",
    borderRadius: 12,
    overflow: "hidden",
    cursor: onClick ? "pointer" : "default",
  };

  return (
    <div ref={containerRef} style={wrapper} onClick={onClick}>
      {/* Cover placeholder hasta que el video esté listo */}
      {!ready && coverUrl && (
        <Image
          src={coverUrl}
          alt={title ?? tGroups("liveLabel")}
          fill
          style={{ objectFit: "cover", opacity: 0.5 }}
        />
      )}

      {/* CF live: thumbnail mientras WebRTC conecta (spinner si thumbnail no disponible) */}
      {isCfLive && !ready && cfThumbnailUrl && (
        <CfThumbnail url={cfThumbnailUrl} ts={cfThumbTs} title={title} />
      )}
      {isCfLive && !ready && !cfThumbnailUrl && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 10,
          color: "rgba(255,255,255,0.55)", fontFamily: fontStack, fontSize: 13,
          textAlign: "center", padding: "0 20px",
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round"
            style={{ animation: "liveInlineSpin 1s linear infinite", flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.15)" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="rgba(255,255,255,0.7)" />
          </svg>
          {tLive("connectingToLive")}
        </div>
      )}

      {/* Error state — solo para streams no-CF (Mux / HLS) */}
      {error && !isCfLive && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 8,
          color: "rgba(255,255,255,0.5)", fontFamily: fontStack, fontSize: 13,
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          {tLive("cantLoadStream")}
        </div>
      )}

      {/* Video element */}
      <video
        ref={videoRef}
        muted={muted}
        playsInline
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: fit ?? ((portrait && isVod) ? "contain" : "cover"),
          opacity: ready ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
      />

      {/* SC overlay: avatar + nombre + monto (sin texto) — detrás del badge En vivo y del botón mute */}
      {activeSC && (
        <div style={{
          position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, bottom: 0,
          zIndex: 2, padding: "0 8px 8px",
          pointerEvents: "none",
          animation: scFadingOut ? "lipSCOut 0.7s ease forwards" : "lipSCIn 0.4s ease forwards",
        }}>
          <div style={{
            background: "rgba(8,8,8,0.88)",
            borderRadius: 12,
            padding: "8px 10px",
            display: "flex", alignItems: "center", gap: 8,
            borderInlineStart: `2px solid ${activeSC.color}`,
          }}>
            {/* Avatar con aro */}
            <div style={{ position: "relative", width: 32, height: 32, flexShrink: 0 }}>
              {activeSC.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeSC.avatarUrl} alt="" style={{ position: "absolute", inset: 2, borderRadius: "50%", width: "calc(100% - 4px)", height: "calc(100% - 4px)", objectFit: "cover" }} />
              ) : (
                <div style={{ position: "absolute", inset: 2, borderRadius: "50%", background: "rgba(168,85,247,0.5)", display: "grid", placeItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#fff", fontWeight: 700, fontFamily: FONT }}>{activeSC.username.charAt(0).toUpperCase()}</span>
                </div>
              )}
              <div style={{
                position: "absolute", inset: 0, borderRadius: "50%",
                background: activeSC.color,
                WebkitMaskImage: `radial-gradient(farthest-side, transparent calc(100% - 2px), white calc(100% - 2px))`,
                maskImage: `radial-gradient(farthest-side, transparent calc(100% - 2px), white calc(100% - 2px))`,
              }} />
            </div>
            {/* Nombre + monto */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#fff", fontFamily: FONT, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeSC.username}
              </div>
              <div style={{ fontSize: 10, fontFamily: FONT }}>
                <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 400 }}>{tLive("donated")} </span>
                <span style={{ color: "#4ade80", fontWeight: 700 }}>{fanPaidTotal(activeSC.amount)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Botón mute/unmute */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          // Desbloquear audio en iOS durante el gesto del usuario
          if (!prewarmAudioRef.current) {
            prewarmAudioRef.current = document.createElement("audio");
          }
          prewarmAudioRef.current.src = SILENT_WAV;
          prewarmAudioRef.current.play().catch(() => {});
          setMuted((m) => !m);
        }}
        style={{
          position: "absolute",
          bottom: 10,
          insetInlineEnd: 10,
          width: 32,
          height: 32,
          zIndex: 5,
          borderRadius: "50%",
          border: "none",
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
        aria-label={muted ? tCommon("unmuteLabel") : tCommon("muteLabel")}
      >
        {muted ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>

      <style>{`
        @keyframes liveInlinePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes liveInlineSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes lipSCIn  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes lipSCOut { from { opacity:1; transform:translateY(0); } to { opacity:0; transform:translateY(5px); } }
      `}</style>
    </div>
  );
}
