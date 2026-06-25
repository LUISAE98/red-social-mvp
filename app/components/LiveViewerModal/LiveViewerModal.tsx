"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Hls from "hls.js";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import type { Post, PostLiveData, PostPlayback } from "@/lib/posts/types";
import LiveChatViewer from "@/app/components/LiveChat/LiveChatViewer";
import { checkLiveAccess, grantSimulatedLiveAccess } from "@/lib/liveAccess/live-access-service";
import { joinLivePresence, leaveLivePresence, subscribeToViewerCount, registerUniqueViewer } from "@/lib/liveKit/liveViewers";
import type { ActiveSuperComment } from "@/lib/posts/types";
import { initTtsCalibration, computeTtsRate, refineTtsCalibration, TTS_MIN_DURATION_SECS } from "@/lib/tts/ttsCalibration";

const FONT =
  'inherit';


type Props = {
  open: boolean;
  onClose: () => void;
  post: Post;
  onManage?: () => void;
  initialPortrait?: boolean;
  initialStream?: MediaStream | null;
};

// Igual que StoryViewer.desktopPanelSize()
function desktopStorySize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 405, height: 720 };
  const h = Math.min(Math.round(window.innerHeight * 0.86), 720);
  return { width: Math.round((h * 9) / 16), height: h };
}

// Video horizontal: deja espacio para el chat flotante separado
function desktopHorizontalSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 800, height: 450 };
  const w = Math.min(Math.round(window.innerWidth * 0.62), 800);
  const h = Math.round((w * 9) / 16);
  return { width: w, height: Math.min(h, Math.round(window.innerHeight * 0.80)) };
}

const CHAT_FLOAT_W = 300;

export default function LiveViewerModal({ open, onClose, post, onManage, initialPortrait = false, initialStream }: Props) {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const cfPcRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [muted, setMuted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isPortrait, setIsPortrait] = useState(initialPortrait);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobileFsHorizontal, setMobileFsHorizontal] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [screenIsPortrait, setScreenIsPortrait] = useState(
    typeof window !== "undefined" ? window.innerHeight > window.innerWidth : true
  );
  const [localLiveData, setLocalLiveData] = useState<PostLiveData | null | undefined>(post.liveData);
  const [localPlayback, setLocalPlayback] = useState<PostPlayback | null>(post.playback ?? null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [payingAccess, setPayingAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const hlsRetryCountRef = useRef(0);

  // ── DVR seek bar ──────────────────────────────────────────────────────────
  const [dvrPosition, setDvrPosition] = useState(0);
  const [dvrDuration, setDvrDuration] = useState(0);
  const dvrTickRef = useRef<number | null>(null);

  // ── Controles horizontales (desktop + mobile fs horizontal) ───────────────
  const [hzControlsVisible, setHzControlsVisible] = useState(false);
  const [videoPaused, setVideoPaused] = useState(false);

  // ── Supercomentario activo (overlay sobre el video) ────────────────────────
  const [activeSuperComment, setActiveSuperComment] = useState<ActiveSuperComment | null>(null);
  // Clave compuesta id+scheduledAt — permite detectar replays del mismo SC
  const prevActiveSuperKeyRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const overlayTimerRef = useRef<number | null>(null);

  // Subscripción propia: no depende de que el padre pase el prop a tiempo
  useEffect(() => {
    if (!post.id) return;
    const unsub = onSnapshot(
      doc(db, "posts", post.id),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (data?.liveData) setLocalLiveData(data.liveData as PostLiveData);
        if (data?.playback) setLocalPlayback(data.playback as PostPlayback);
      },
      (err) => console.warn("[LiveViewerModal] snapshot error", err)
    );
    return () => unsub();
  }, [post.id]);

  // ── Presencia de espectador ────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !hasAccess || localLiveData?.status !== "live" || !user?.uid || !post.id) return;
    const uid = user.uid;
    const postId = post.id;
    joinLivePresence(postId, uid).catch(console.warn);
    registerUniqueViewer(postId, uid).catch(console.warn);

    // Best-effort cleanup cuando el usuario cierra la pestaña o navega fuera.
    // El caso garantizado (modal cerrado normalmente) lo cubre el return cleanup de abajo.
    const handlePageHide = () => { leaveLivePresence(postId, uid).catch(console.warn); };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      leaveLivePresence(postId, uid).catch(console.warn);
    };
  }, [open, hasAccess, localLiveData?.status, user?.uid, post.id]);

  // ── Contador de espectadores ────────────────────────────────────────────────
  useEffect(() => {
    if (!open || localLiveData?.status !== "live" || !post.id) return;
    return subscribeToViewerCount(post.id, setViewerCount);
  }, [open, localLiveData?.status, post.id]);

  useEffect(() => { prevActiveSuperKeyRef.current = null; }, [post.id]);
  useEffect(() => { if (!open) prevActiveSuperKeyRef.current = null; }, [open]);

  // ── Overlay de supercomentario via liveData.activeSuper ───────────────────
  // El creador escribe liveData.activeSuper con scheduledAt al hacer play.
  // El viewer ya tiene onSnapshot activo sobre el post doc, así que este cambio
  // llega por la subscription existente (~100-300ms) en vez de una subscription
  // separada a la subcolección superComments.
  useEffect(() => {
    if (!open || !hasAccess) return;
    const activeSuper = localLiveData?.activeSuper;
    const scId = activeSuper?.id ?? null;
    // Clave compuesta: mismo SC con nuevo scheduledAt = replay, debe mostrarse
    const scKey = scId != null ? `${scId}:${activeSuper?.scheduledAt ?? 0}` : null;
    if (scKey === prevActiveSuperKeyRef.current) return;
    prevActiveSuperKeyRef.current = scKey;
    if (!activeSuper || !scId) return;

    if (activeSuper.scheduledAt != null) {
      const delay = activeSuper.scheduledAt - Date.now();
      if (delay > 0) {
        window.setTimeout(() => showSuperOverlay(activeSuper, activeSuper.displaySeconds), delay);
      } else {
        const remainingSecs = activeSuper.displaySeconds + delay / 1000;
        if (remainingSecs > 0.5) showSuperOverlay(activeSuper, remainingSecs);
      }
    } else {
      showSuperOverlay(activeSuper, activeSuper.displaySeconds);
    }
  }, [open, hasAccess, localLiveData?.activeSuper]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup de timers al desmontar
  useEffect(() => {
    return () => {
      if (overlayTimerRef.current !== null) window.clearTimeout(overlayTimerRef.current);
    };
  }, []);

  // ── Verificación de acceso ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setAccessChecked(false);
      setHasAccess(false);
      setPayingAccess(false);
      setAccessError(null);
      return;
    }

    const liveAccessType = localLiveData?.accessType ?? "free";

    // Creador siempre tiene acceso
    if (user?.uid === post.authorId) {
      setHasAccess(true);
      setAccessChecked(true);
      return;
    }

    // Live gratuito — acceso directo
    if (liveAccessType === "free") {
      setHasAccess(true);
      setAccessChecked(true);
      return;
    }

    // Live de pago — verificar
    setAccessChecked(false);
    const check = async () => {
      try {
        if (!user?.uid) {
          setHasAccess(false);
          setAccessChecked(true);
          return;
        }

        const mode = localLiveData?.paidAccessMode ?? "everyone_pays";
        if (mode === "members_free_non_members_pay" && post.groupId) {
          const memberSnap = await getDoc(doc(db, "groups", post.groupId, "members", user.uid));
          if (memberSnap.exists()) {
            const status = memberSnap.data()?.status as string | undefined;
            if (["active", "subscribed", "muted"].includes(status ?? "")) {
              setHasAccess(true);
              setAccessChecked(true);
              return;
            }
          }
        }

        const paid = await checkLiveAccess(post.id, user.uid);
        setHasAccess(paid);
        setAccessChecked(true);
      } catch {
        setHasAccess(false);
        setAccessChecked(true);
      }
    };
    check();
  }, [open, localLiveData?.accessType, localLiveData?.paidAccessMode, user?.uid, post.authorId, post.id, post.groupId]);

  const liveData = localLiveData;
  const playbackId = liveData?.playbackId;
  const isLive = liveData?.status === "live";
  const isEnded = liveData?.status === "ended";
  // For Mux ended streams the VOD asset has a different URL stored in post.playback
  const vodHlsUrl = (isEnded && liveData?.streamProvider === "mux") ? (localPlayback?.hlsUrl ?? null) : null;
  // For CF ended streams: only use hlsUrl as VOD when vodStatus=ready (recording confirmed)
  const cfVodHlsUrl = (isEnded && liveData?.streamProvider === "cloudflare" && liveData?.vodStatus === "ready")
    ? (liveData?.hlsUrl ?? null)
    : null;
  // Strip query params defensively — older code stored ?dvrEnabled=true which causes Cloudflare to return 204.
  const rawHlsUrl = vodHlsUrl ?? cfVodHlsUrl ?? (!isEnded ? (liveData?.hlsUrl ?? (playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : null)) : null);
  const hlsUrl = rawHlsUrl ? rawHlsUrl.split("?")[0] : null;
  // vodReady: when true the HLS URL is a playable recording — no "processing" overlay shown
  // CF direct live: no recording → vodReady=true when vodStatus absent (skip spinner, just show ended state)
  const vodReady = !isEnded || (
    liveData?.streamProvider === "cloudflare"
      ? (liveData?.vodStatus === "ready" || !liveData?.vodStatus)
      : !!vodHlsUrl
  );

  // For Cloudflare WHIP streams, HLS (204) only becomes available after transcoding warms up.
  // The WebRTC playback endpoint (/webRTC/play) works instantly — same pipeline the CF dashboard uses.
  const cfWebRTCPlayUrl = (liveData?.streamProvider === "cloudflare" && isLive && hlsUrl)
    ? hlsUrl.replace("/manifest/video.m3u8", "/webRTC/play")
    : null;
  const isMuted = !!(user?.uid && liveData?.mutedUsers?.includes(user.uid));
  const isBanned = !!(user?.uid && liveData?.bannedUsers?.includes(user.uid));
  const chatEnabled = !isEnded && !isBanned && liveData?.chatEnabled !== false;

  // ── Controles horizontales — computed ────────────────────────────────────
  const dvrAvailable = isLive && !cfWebRTCPlayUrl && dvrDuration >= 120;
  const badgeLift = (hzControlsVisible && dvrAvailable) ? 24 : 0;

  useEffect(() => { setMounted(true); }, []);

  // Resetear contador de reintentos cada vez que se abre el modal o cambia la URL
  useEffect(() => {
    if (open) hlsRetryCountRef.current = 0;
  }, [open]);

  useEffect(() => {
    hlsRetryCountRef.current = 0;
  }, [hlsUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPause = () => setVideoPaused(true);
    const onPlay = () => setVideoPaused(false);
    video.addEventListener("pause", onPause);
    video.addEventListener("play", onPlay);
    return () => { video.removeEventListener("pause", onPause); video.removeEventListener("play", onPlay); };
  }, [retryKey]);

  // Detecta cambio de orientación física para saber si aplicar rotación CSS o no
  useEffect(() => {
    const handler = () => setScreenIsPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine)");
    setIsDesktop(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      // iOS Safari bloquea speechSynthesis fuera de un gesto del usuario.
      // Primar aquí (dentro del efecto del gesto que abre el modal) desbloquea
      // llamadas futuras desde callbacks asíncronos de Firestore.
      // La calibración silenciosa se encola justo después del primer y solo
      // corre una vez por dispositivo (localStorage cache).
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const primer = new SpeechSynthesisUtterance("");
        primer.volume = 0;
        window.speechSynthesis.speak(primer);
        initTtsCalibration();
      }
      return;
    }
    // Modal cerrándose — cortar cualquier TTS en curso
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsFullscreen(false);
    setMobileFsHorizontal(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { (screen.orientation as any)?.unlock?.(); } catch {}
    const t = window.setTimeout(() => setShouldRender(false), 220);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ── WebRTC viewer for Cloudflare live streams ─────────────────────────────
  // WHIP → /webRTC/play works instantly. HLS (/manifest/video.m3u8) requires CF
  // transcoding warmup (10-30s) and returns 204 until segments are ready.
  useEffect(() => {
    console.log("[LiveViewerModal] CF WebRTC effect — cfWebRTCPlayUrl:", cfWebRTCPlayUrl, "open:", open, "shouldRender:", shouldRender, "hasAccess:", hasAccess);
    if (!cfWebRTCPlayUrl || !open || !shouldRender || !hasAccess) return;

    // Si el feed ya tiene un MediaStream activo, úsalo directamente sin crear nueva conexión WebRTC.
    if (initialStream) {
      const video = videoRef.current;
      if (video) {
        video.srcObject = initialStream;
        setReady(true);
        setError(false);
        if (video.videoWidth > 0 && video.videoHeight > 0) setIsPortrait(video.videoHeight > video.videoWidth);
        video.play().catch(() => {
          video.muted = true;
          setMuted(true);
          video.play().catch(() => {});
        });
      }
      const vid = videoRef.current;
      return () => {
        if (vid) vid.srcObject = null;
        setReady(false);
      };
    }

    let cancelled = false;
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: "stun:stun.l.google.com:19302" },
      ],
    });
    cfPcRef.current = pc;

    const video = videoRef.current;
    setReady(false);
    setError(false);

    // Create a single MediaStream to accumulate all remote tracks.
    // CF may deliver audio and video in separate ontrack events with different streams[0],
    // so using event.streams[0] directly as srcObject causes the second ontrack (audio) to
    // overwrite srcObject with an audio-only stream — resulting in size:0x0 and no video.
    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;

    const logVideoState = (label: string) => {
      if (!video) return;
      console.log(`[LiveViewerModal] video[${label}] readyState:${video.readyState} paused:${video.paused} size:${video.videoWidth}x${video.videoHeight}`);
    };

    pc.ontrack = ({ track }) => {
      console.log("[LiveViewerModal] ontrack — kind:", track.kind, "readyState:", track.readyState, "id:", track.id.slice(0, 8));
      if (cancelled || !video) {
        console.warn("[LiveViewerModal] ontrack skipped — cancelled:", cancelled, "video:", !!video);
        return;
      }

      if (!remoteStream.getTrackById(track.id)) {
        remoteStream.addTrack(track);
      }
      console.log("[LiveViewerModal] remoteStream tracks:", remoteStream.getTracks().map(t => `${t.kind}/${t.readyState}/${t.id.slice(0, 8)}`).join(", "));

      // Assign srcObject once (first ontrack). Subsequent ontrack calls add tracks to the
      // same remoteStream so the video element picks them up automatically.
      if (video.srcObject !== remoteStream) {
        video.srcObject = remoteStream;
        console.log("[LiveViewerModal] srcObject assigned to remoteStream");

        video.addEventListener("loadedmetadata", () => {
          console.log("[LiveViewerModal] video: loadedmetadata");
          logVideoState("loadedmetadata");
          setReady(true);
          if (video.videoWidth > 0 && video.videoHeight > 0) setIsPortrait(video.videoHeight > video.videoWidth);
        }, { once: true });

        video.addEventListener("canplay", () => {
          console.log("[LiveViewerModal] video: canplay");
          logVideoState("canplay");
          setReady(true);
          if (video.videoWidth > 0 && video.videoHeight > 0) setIsPortrait(video.videoHeight > video.videoWidth);
        }, { once: true });

        video.addEventListener("playing", () => {
          console.log("[LiveViewerModal] video: playing");
          logVideoState("playing");
        }, { once: true });

        video.addEventListener("error", () => {
          console.error("[LiveViewerModal] video error — code:", video.error?.code, "msg:", video.error?.message);
        }, { once: true });

        video.play().catch((err) => {
          console.warn("[LiveViewerModal] video.play() rejected:", (err as Error)?.message, "— retrying muted");
          video.muted = true;
          setMuted(true);
          video.play().catch((err2) => {
            console.error("[LiveViewerModal] video.play() muted also failed:", (err2 as Error)?.message);
          });
        });

        setTimeout(() => logVideoState("1s-after-ontrack"), 1000);
      }
    };

    pc.onconnectionstatechange = () => {
      if (cancelled) return;
      const s = pc.connectionState;
      console.log("[LiveViewerModal] CF WebRTC viewer connectionState:", s);
      if (s === "failed" || s === "disconnected") setError(true);
    };

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

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
        if (!sdp) throw new Error("No SDP for CF WebRTC viewer");

        // POST via server-side proxy — avoids CORS: /webRTC/play does not send
        // Access-Control-Allow-Origin headers for cross-origin browser requests.
        const proxyUrl = `/api/cf-viewer-proxy?postId=${encodeURIComponent(post.id)}`;
        console.log("[LiveViewerModal] Posting SDP offer to CF viewer proxy, postId:", post.id);
        const resp = await fetch(proxyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: sdp,
        });

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "");
          throw new Error(`CF viewer proxy ${resp.status}: ${errBody.slice(0, 120)}`);
        }

        const answer = await resp.text();
        console.log("[LiveViewerModal] SDP answer from proxy, directions:", answer.match(/a=(sendrecv|sendonly|recvonly|inactive)/g));

        if (cancelled) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
      } catch (err) {
        console.error("[LiveViewerModal] CF WebRTC viewer error:", err);
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
      try { pc.close(); } catch { /* best effort */ }
      cfPcRef.current = null;
      remoteStreamRef.current = null;
      if (video) { video.srcObject = null; }
      setReady(false);
    };
  }, [cfWebRTCPlayUrl, open, shouldRender, hasAccess, retryKey, initialStream]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize HLS (Mux streams + CF ended streams — not used for CF live WebRTC)
  useEffect(() => {
    if (!open || !shouldRender || !hlsUrl || !hasAccess) return;
    if (cfWebRTCPlayUrl) return; // CF live uses WebRTC playback above
    const video = videoRef.current;
    if (!video) return;

    setReady(false);
    setError(false);

    // iOS Safari: videoWidth/Height pueden ser 0 en loadedmetadata — fallback a loadeddata/canplay
    const trySetOrientation = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setIsPortrait(video.videoHeight > video.videoWidth);
        return true;
      }
      return false;
    };

    const onMeta = () => {
      setReady(true);
      video.play().catch(() => {});
      if (!trySetOrientation()) {
        video.addEventListener("loadeddata", trySetOrientation, { once: true });
        video.addEventListener("canplay", trySetOrientation, { once: true });
      }
    };

    console.log("[LiveViewerModal] Loading HLS:", hlsUrl);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startLevel: -1,
        autoStartLoad: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        liveDurationInfinity: true,
        fragLoadingMaxRetry: 6,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        backBufferLength: 3600,
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.addEventListener("loadedmetadata", onMeta, { once: true });
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.error("[LiveViewerModal] HLS fatal error:", data.type, data.details);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setError(true);
          }
        } else if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          videoRef.current?.play().catch(() => {});
        }
      });
      hlsRef.current = hls;
      return () => { hls.destroy(); hlsRef.current = null; };
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
      video.addEventListener("loadedmetadata", onMeta, { once: true });
    } else {
      setError(true);
    }
  }, [open, shouldRender, hlsUrl, isLive, hasAccess, retryKey, cfWebRTCPlayUrl, vodReady]);

  // Auto-reintento mientras el live esté activo — sin límite de intentos (el viewer se bloqueaba
  // cuando agotaba los 8 reintentos antes de que CF produjera segmentos HLS)
  useEffect(() => {
    if (!error || isEnded || !isLive || !hlsUrl || !hasAccess) return;
    const t = setTimeout(() => {
      hlsRetryCountRef.current++;
      setError(false);
      setRetryKey((k) => k + 1);
    }, 5000);
    return () => clearTimeout(t);
  }, [error, isEnded, isLive, hlsUrl, hasAccess]);

  // Congelar video en último frame cuando el live termina o el usuario es baneado
  useEffect(() => {
    if (!isEnded && !isBanned) return;
    videoRef.current?.pause();
  }, [isEnded, isBanned]);

  // Al terminar el live, mostrar controles para que el usuario vea "Finalizado" y pueda cerrar
  useEffect(() => {
    if (isEnded) setControlsVisible(true);
  }, [isEnded]);

  // ── DVR tick — actualiza barra de seek cada segundo mientras el live está activo ──
  useEffect(() => {
    if (!isLive || cfWebRTCPlayUrl) { setDvrDuration(0); return; }
    dvrTickRef.current = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.seekable.length === 0) return;
      const start = video.seekable.start(0);
      const end = video.seekable.end(0);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      setDvrDuration(end - start);
      setDvrPosition(video.currentTime - start);
    }, 1000);
    return () => {
      if (dvrTickRef.current !== null) window.clearInterval(dvrTickRef.current);
      dvrTickRef.current = null;
      setDvrDuration(0);
    };
  }, [isLive, cfWebRTCPlayUrl]);

  // Bloquear orientación landscape al entrar en fullscreen horizontal mobile (Android Chrome)
  // iOS Safari no soporta orientation.lock — el usuario puede girar el dispositivo manualmente
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ori = screen.orientation as any;
    if (!mobileFsHorizontal) {
      try { ori?.unlock?.(); } catch {}
      return;
    }
    try { ori?.lock?.("landscape")?.catch?.(() => {}); } catch {}
  }, [mobileFsHorizontal]);

  if (!mounted || !shouldRender) return null;

  // ── Paywall ────────────────────────────────────────────────────────────────
  const isPaidLive = (liveData?.accessType ?? "free") === "paid";

  async function handlePayAccess() {
    if (!user?.uid || payingAccess) return;
    setPayingAccess(true);
    setAccessError(null);
    try {
      await grantSimulatedLiveAccess({
        liveId: post.id,
        userId: user.uid,
        postId: post.id,
        authorId: post.authorId,
        groupId: post.groupId ?? null,
        amount: liveData?.ticketPrice ?? 0,
        currency: liveData?.currency ?? "MXN",
      });
      setHasAccess(true);
      // Si el live aún no ha iniciado, cerrar el modal — la tarjeta lo abrirá automáticamente cuando inicie
      if (localLiveData?.status !== "live") {
        onClose();
      }
    } catch {
      setAccessError("No se pudo procesar el pago. Intenta de nuevo.");
    } finally {
      setPayingAccess(false);
    }
  }

  if (isPaidLive && accessChecked && !hasAccess) {
    const ticketPrice = liveData?.ticketPrice ?? 0;
    const currency = liveData?.currency ?? "MXN";
    const isLoggedIn = !!user?.uid;

    return createPortal(
      <div style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "linear-gradient(160deg, #0a0010 0%, #0f0020 100%)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "32px 24px", fontFamily: FONT,
      }}>
        {/* Botón cerrar */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          style={{
            position: "absolute", top: "max(20px, env(safe-area-inset-top))",
            right: "max(20px, env(safe-area-inset-right))",
            background: "rgba(255,255,255,0.08)", border: "none",
            borderRadius: "50%", width: 36, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "#fff",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Portada */}
        {liveData?.coverUrl && (
          <div style={{
            position: "relative",
            width: 100, height: 100, borderRadius: 16, overflow: "hidden",
            marginBottom: 20, flexShrink: 0,
            boxShadow: "0 8px 32px rgba(168,85,255,0.3)",
          }}>
            <Image
              src={liveData.coverUrl}
              alt=""
              fill
              style={{ objectFit: "cover" }}
            />
          </div>
        )}

        {/* Ícono live si no hay portada */}
        {!liveData?.coverUrl && (
          <div style={{
            width: 72, height: 72, borderRadius: "50%", marginBottom: 20,
            background: "rgba(168,85,255,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 0 1px rgba(168,85,255,0.25)",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polygon points="10 8 16 12 10 16 10 8" />
            </svg>
          </div>
        )}

        {/* Título */}
        {liveData?.title && (
          <span style={{
            fontSize: 18, fontWeight: 700, color: "#fff",
            textAlign: "center", marginBottom: 6,
            maxWidth: 320, lineHeight: 1.3,
          }}>
            {liveData.title}
          </span>
        )}

        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 24, textAlign: "center" }}>
          Este live tiene ticket de entrada
        </span>

        {/* Precio */}
        <div style={{
          display: "flex", alignItems: "baseline", gap: 6,
          marginBottom: 28,
        }}>
          <span style={{ fontSize: 36, fontWeight: 800, color: "#a855f7", letterSpacing: "-0.02em" }}>
            ${ticketPrice.toLocaleString("es-MX")}
          </span>
          <span style={{ fontSize: 16, fontWeight: 600, color: "rgba(168,85,255,0.7)" }}>
            {currency}
          </span>
        </div>

        {/* CTA */}
        {!isLoggedIn ? (
          <div style={{
            textAlign: "center", padding: "14px 20px", borderRadius: 12,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            maxWidth: 280,
          }}>
            <span style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
              Inicia sesión o crea una cuenta para comprar el acceso al live
            </span>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={handlePayAccess}
              disabled={payingAccess}
              style={{
                padding: "13px 36px", borderRadius: 12, border: "none",
                background: payingAccess
                  ? "rgba(168,85,255,0.4)"
                  : "linear-gradient(135deg, #a855f7, #7c3aed)",
                color: "#fff", fontSize: 15, fontWeight: 700,
                fontFamily: FONT, cursor: payingAccess ? "not-allowed" : "pointer",
                letterSpacing: "-0.01em",
                boxShadow: payingAccess ? "none" : "0 4px 20px rgba(168,85,255,0.35)",
                transition: "all 0.15s",
                minWidth: 200,
              }}
            >
              {payingAccess ? "Procesando..." : `Pagar $${ticketPrice.toLocaleString("es-MX")} ${currency}`}
            </button>

            {accessError && (
              <span style={{
                fontSize: 12, color: "#f87171",
                marginTop: 12, textAlign: "center",
              }}>
                {accessError}
              </span>
            )}

            <span style={{
              fontSize: 11, color: "rgba(255,255,255,0.2)",
              marginTop: 16, textAlign: "center", maxWidth: 260, lineHeight: 1.5,
            }}>
              Acceso de un solo pago. Sin suscripción.
            </span>
          </>
        )}
      </div>,
      document.body
    );
  }

  // Mientras se verifica el acceso a live de pago, no mostrar el player
  if (isPaidLive && !accessChecked) return null;

  // ── Supercomentario overlay ─────────────────────────────────────────────────
  function playSuperCommentSound() {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const playNote = (freq: number, start: number, duration: number, vol: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0, ctx.currentTime + start);
        gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration + 0.02);
      };
      playNote(880, 0, 0.25, 0.28);     // A5
      playNote(1320, 0.12, 0.22, 0.2);  // E6
      setTimeout(() => ctx.close().catch(() => {}), 900);
    } catch { /* audio no disponible */ }
  }

  function showSuperOverlay(sc: ActiveSuperComment, durationSeconds: number) {
    playSuperCommentSound();
    // Solo reproducir TTS si queda tiempo suficiente (evita TTS fantasmas en entrada tardía)
    if (typeof window !== "undefined" && "speechSynthesis" in window && durationSeconds >= TTS_MIN_DURATION_SECS) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(sc.text);
      utterance.lang = "es-MX";
      utterance.rate = computeTtsRate(sc.text, durationSeconds);
      const capturedRate = utterance.rate;
      const speakStart = performance.now();
      utterance.onend = () => {
        refineTtsCalibration(sc.text, (performance.now() - speakStart) / 1000, capturedRate);
      };
      window.speechSynthesis.speak(utterance);
    }
    setActiveSuperComment(sc);
    if (overlayTimerRef.current !== null) window.clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = window.setTimeout(() => {
      setActiveSuperComment(null);
      overlayTimerRef.current = null;
      // Cortar TTS si aún no terminó (calibración ligeramente imprecisa o entrada tardía)
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    }, durationSeconds * 1000);
  }

  function renderSuperOverlay() {
    if (!activeSuperComment) return null;
    const sc = activeSuperComment;
    return (
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 6,
        background: "rgba(5,5,5,0.88)",
        borderTop: `3px solid ${sc.color}`,
        padding: "10px 14px 12px",
        animation: "lvFadeIn 0.3s ease",
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ width: 4, alignSelf: "stretch", background: sc.color, borderRadius: 2, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap",
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: sc.color, fontFamily: FONT }}>
                {sc.tierName}
              </span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: FONT }}>
                · ${sc.amount} MXN · {sc.username}
              </span>
            </div>
            <span style={{
              fontSize: 15, fontWeight: 500, color: "#fff",
              lineHeight: 1.4, display: "block", wordBreak: "break-word", fontFamily: FONT,
            }}>
              {sc.text}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Header — siempre visible: título izquierda (solo desktop), controles derecha ──
  function renderHeader(safeTop = false, showTitle = true) {
    const iconSz = isDesktop ? 20 : 24;
    return (
      <div style={{
        position: "absolute",
        top: 0, left: 0, right: 0, zIndex: 10,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: safeTop ? "max(12px, env(safe-area-inset-top))" : 12,
        paddingBottom: 12,
        paddingLeft: "max(14px, env(safe-area-inset-left))",
        paddingRight: "max(14px, env(safe-area-inset-right))",
      }}>
        {showTitle && liveData?.title ? (
          <span style={{
            fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.9)", fontFamily: FONT,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            minWidth: 0, flex: 1, paddingRight: 8,
          }}>
            {liveData.title}
          </span>
        ) : <span style={{ flex: 1 }} />}

        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {/* Mute — igual que historias */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
            aria-label={muted ? "Activar sonido" : "Silenciar"}
          >
            {muted ? (
              <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>

          {onManage && (
            <button
              type="button"
              onClick={onManage}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 10px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.22)",
                background: "rgba(0,0,0,0.45)",
                color: "#fff", fontSize: 11, fontWeight: 600, fontFamily: FONT,
                cursor: "pointer",
                backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Gestionar
            </button>
          )}

          {/* Fullscreen toggle — solo desktop */}
          {isDesktop && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIsFullscreen(f => !f); }}
              aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
              style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              {isFullscreen ? (
                <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                  <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
                </svg>
              ) : (
                <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
          )}

          {/* Expand/compress — solo celular horizontal (no portrait, no desktop) */}
          {!isDesktop && !isPortrait && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMobileFsHorizontal(f => !f); }}
              aria-label={mobileFsHorizontal ? "Reducir pantalla" : "Pantalla completa"}
              style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              {mobileFsHorizontal ? (
                <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                  <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
                </svg>
              ) : (
                <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
          )}

          {/* Cerrar — igual que historias */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg width={iconSz} height={iconSz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ── Badge EN VIVO / Finalizado ──────────────────────────────────────────────
  // position="bottom-right" → esquina inferior derecha (desktop + mobile horizontal)
  // position="top-center"   → centrado arriba junto al header (mobile portrait)
  function renderLiveBadge(position: "bottom-right" | "top-center" = "bottom-right", liftPx = 0) {
    if (!isLive && !isEnded) return null;

    function jumpToLive(e: React.MouseEvent) {
      e.stopPropagation();
      const video = videoRef.current;
      const hls = hlsRef.current;
      if (!video || !isLive) return;
      try {
        // Restart HLS.js loading if stalled, reset live-sync config
        if (hls) {
          hls.config.liveMaxLatencyDurationCount = 10;
          hls.config.liveSyncDurationCount = 3;
          hls.startLoad();
        }
        const len = video.seekable.length;
        if (len > 0) {
          const end = video.seekable.end(len - 1);
          if (Number.isFinite(end)) video.currentTime = end;
        }
        video.play().catch(() => {});
      } catch {
        // seekable puede estar vacío si el stream no ha cargado aún
      }
    }

    const posStyle: CSSProperties = position === "top-center"
      ? {
          position: "absolute",
          top: "max(12px, env(safe-area-inset-top))",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
        }
      : {
          position: "absolute",
          bottom: liftPx > 0
            ? `calc(max(14px, env(safe-area-inset-bottom)) + ${liftPx}px)`
            : "max(14px, env(safe-area-inset-bottom))",
          right: "max(14px, env(safe-area-inset-right))",
          zIndex: 10,
          transition: "bottom 0.25s ease",
        };

    const sharedStyle: CSSProperties = {
      ...posStyle,
      display: "inline-flex", alignItems: "center", gap: 6,
      background: isLive ? "rgba(239,68,68,0.88)" : "rgba(0,0,0,0.55)",
      borderRadius: 7,
      border: isEnded ? "1px solid rgba(255,255,255,0.18)" : "none",
      padding: "5px 11px 5px 8px",
      fontFamily: FONT, fontSize: 11, fontWeight: 700,
      letterSpacing: "0.06em",
      color: isLive ? "#fff" : "rgba(255,255,255,0.55)",
      backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
    };

    const inner = (
      <>
        {isLive && (
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: "#fff", flexShrink: 0,
            animation: "lvPulse 1.4s ease-in-out infinite",
          }} />
        )}
        {isLive ? "EN VIVO" : "Finalizado"}
      </>
    );

    return isLive ? (
      <button
        type="button"
        onClick={jumpToLive}
        aria-label="Ir al momento actual del live"
        style={{ ...sharedStyle, cursor: "pointer" }}
      >
        {inner}
      </button>
    ) : (
      <div style={{ ...sharedStyle, pointerEvents: "none" }}>{inner}</div>
    );
  }

  // ── Badge contador de espectadores ────────────────────────────────────────
  function renderViewerBadge(position: "bottom-left" | "top-left" = "bottom-left", liftPx = 0) {
    if (!isLive || viewerCount <= 0) return null;

    const posStyle: CSSProperties = position === "top-left"
      ? {
          position: "absolute",
          top: "max(12px, env(safe-area-inset-top))",
          left: "max(14px, env(safe-area-inset-left))",
          zIndex: 10,
        }
      : {
          position: "absolute",
          bottom: liftPx > 0
            ? `calc(max(14px, env(safe-area-inset-bottom)) + ${liftPx}px)`
            : "max(14px, env(safe-area-inset-bottom))",
          left: "max(14px, env(safe-area-inset-left))",
          zIndex: 10,
          transition: "bottom 0.25s ease",
        };

    return (
      <div style={{
        ...posStyle,
        display: "inline-flex", alignItems: "center", gap: 5,
        background: "rgba(0,0,0,0.55)",
        borderRadius: 7,
        border: "1px solid rgba(255,255,255,0.12)",
        padding: "5px 10px 5px 8px",
        fontFamily: FONT, fontSize: 12, fontWeight: 600,
        color: "rgba(255,255,255,0.88)",
        backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        pointerEvents: "none",
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        {viewerCount.toLocaleString("es-MX")}
      </div>
    );
  }

  // ── Overlay "Preparando grabación" / sin overlay cuando el VOD ya está listo ──
  function renderEndedOverlay() {
    if (!isEnded) return null;
    // VOD is ready — let the video play as a recording with no blocking overlay
    if (vodReady) return null;
    // VOD is still processing — show a spinner
    return (
      <div style={{
        position: "absolute", inset: 0, zIndex: 8,
        background: "rgba(0,0,0,0.72)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 12,
        fontFamily: FONT,
      }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round"
          style={{ animation: "lvSpin 1s linear infinite" }}>
          <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.15)" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="rgba(255,255,255,0.65)" />
        </svg>
        <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.72)", textAlign: "center", padding: "0 28px" }}>
          Preparando grabación…
        </span>
      </div>
    );
  }

  // ── Overlay "Fuiste baneado" — cubre el video, el usuario no puede interactuar ─
  function renderBannedOverlay() {
    if (!isBanned) return null;
    return (
      <div style={{
        position: "absolute", inset: 0, zIndex: 9,
        background: "rgba(0,0,0,0.72)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 12,
        fontFamily: FONT,
      }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,0.6)" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
        <span style={{
          fontSize: 15, fontWeight: 700,
          color: "rgba(255,255,255,0.85)",
          letterSpacing: "0.01em", textAlign: "center", padding: "0 24px",
        }}>
          Fuiste baneado de este live
        </span>
        <span style={{
          fontSize: 12, color: "rgba(255,255,255,0.4)",
          fontFamily: FONT, textAlign: "center", padding: "0 32px",
        }}>
          Ya no puedes participar en esta transmisión
        </span>
      </div>
    );
  }

  // ── Video element ──────────────────────────────────────────────────────────
  function renderVideo(fit: "cover" | "contain" = "contain", horizontal = false) {
    return (
      <>
        {!ready && liveData?.coverUrl && (
          <Image
            src={liveData.coverUrl} alt={liveData.title ?? "Live"}
            fill
            style={{ objectFit: "cover", opacity: 0.3 }}
          />
        )}
        {error && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 12,
            color: "rgba(255,255,255,0.5)", fontFamily: FONT, fontSize: 13, textAlign: "center",
            padding: "0 24px",
          }}>
            {isEnded ? (
              <>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
                La transmisión ha finalizado.
              </>
            ) : (
              <>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" style={{ animation: "lvSpin 1s linear infinite", flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.15)" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="rgba(255,255,255,0.7)" />
                </svg>
                Conectando con el stream…
                {isLive && (
                  <button
                    type="button"
                    onClick={() => { hlsRetryCountRef.current = 0; setError(false); setRetryKey((k) => k + 1); }}
                    style={{
                      marginTop: 4, padding: "7px 18px", borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.08)",
                      color: "rgba(255,255,255,0.8)", fontSize: 12,
                      cursor: "pointer", fontFamily: FONT,
                    }}
                  >
                    Reintentar ahora
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {!error && !hlsUrl && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", color: "rgba(255,255,255,0.35)", fontFamily: FONT,
            fontSize: 13, textAlign: "center", padding: "0 24px",
          }}>
            {isEnded ? "La transmisión ha finalizado." : "El stream aún no ha comenzado."}
          </div>
        )}
        <video
          ref={videoRef}
          muted={muted}
          playsInline
          controls={isEnded && vodReady}
          onClick={(e) => {
            if (horizontal) {
              e.stopPropagation();
              if (dvrAvailable) setHzControlsVisible(v => !v);
            } else {
              const video = videoRef.current;
              if (!video || (isEnded && vodReady)) return;
              if (video.paused) video.play().catch(() => {});
              else video.pause();
            }
          }}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: fit, opacity: ready ? 1 : 0, transition: "opacity 0.3s ease",
            cursor: (horizontal || !isEnded || !vodReady) ? "pointer" : "default",
          }}
        />
      </>
    );
  }

  function renderPauseButton() {
    if (!isLive || !hzControlsVisible || cfWebRTCPlayUrl || isEnded) return null;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const video = videoRef.current;
          if (!video) return;
          if (video.paused) { video.play().catch(() => {}); setVideoPaused(false); }
          else { video.pause(); setVideoPaused(true); }
        }}
        style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 8,
          background: "rgba(0,0,0,0.45)",
          border: "none", borderRadius: "50%",
          width: 56, height: 56,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer",
          backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        }}
      >
        {videoPaused ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        )}
      </button>
    );
  }

  function renderDvrBar(horizontal = false) {
    if (!isLive || cfWebRTCPlayUrl || dvrDuration < 120) return null;
    const visible = !horizontal || hzControlsVisible;
    return (
      <div style={{
        position: "absolute",
        bottom: "max(14px, env(safe-area-inset-bottom))",
        left: 14, right: 14, zIndex: 7,
        display: "flex", flexDirection: "column", gap: 4,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 0.25s ease, transform 0.25s ease",
        pointerEvents: visible ? "auto" : "none",
      }}>
        <input
          type="range"
          min={0}
          max={Math.floor(dvrDuration)}
          value={Math.min(Math.floor(dvrPosition), Math.floor(dvrDuration))}
          onChange={(e) => {
            const video = videoRef.current;
            if (!video || video.seekable.length === 0) return;
            video.currentTime = video.seekable.start(0) + Number(e.target.value);
            if (hlsRef.current) hlsRef.current.config.liveMaxLatencyDurationCount = Infinity;
          }}
          style={{ width: "100%", accentColor: "#ffffff", cursor: "pointer", height: 4 }}
        />
      </div>
    );
  }

  const keyframes = `
    @keyframes lvPulse { 0%,100%{opacity:1}50%{opacity:0.35} }
    @keyframes lvFadeIn { from{opacity:0}to{opacity:1} }
    @keyframes lvFadeOut { from{opacity:1}to{opacity:0} }
    @keyframes lvSpin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
  `;

  const floatCardShadow = "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)";

  // ── Info del creador + título + descripción — aparece en el panel del chat ──
  function renderCreatorInfo() {
    const name = post.authorName ?? post.authorUsername ?? "Creador";
    const avatar = post.authorAvatarUrl;
    const title = liveData?.title;
    const description = liveData?.description;

    return (
      <div style={{
        padding: "14px 16px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        display: "flex", flexDirection: "column", gap: 10,
        flexShrink: 0,
      }}>
        {/* Avatar + nombre + badge "En vivo" */}
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div style={{
            position: "relative",
            width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
            overflow: "hidden",
            background: "linear-gradient(135deg, #ec4899 0%, #9333ea 100%)",
            display: "grid", placeItems: "center",
          }}>
            {avatar
              ? <Image src={avatar} alt={name} fill style={{ objectFit: "cover" }} />
              : <span style={{ fontSize: 17, fontWeight: 700, color: "#fff", fontFamily: FONT }}>
                  {name.charAt(0).toUpperCase()}
                </span>
            }
          </div>
          <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{
              fontSize: 14, fontWeight: 600, color: "#fff", fontFamily: FONT,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              lineHeight: "1.2",
            }}>
              {name}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 500,
              color: "rgba(255,255,255,0.55)", fontFamily: FONT,
              lineHeight: "1.2",
            }}>
              En vivo
            </span>
          </div>
        </div>

        {/* Título + descripción — agrupados para reducir separación entre ellos */}
        {(title || description) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>

        {title && (
          <span style={{
            fontSize: 13.5, fontWeight: 700,
            color: "rgba(255,255,255,0.92)", fontFamily: FONT,
            lineHeight: 1.45, display: "block",
          }}>
            {title}
          </span>
        )}

        {/* Descripción — 1 línea colapsada con "...más", clic para expandir */}
        {description && (
          descExpanded ? (
            <span
              onClick={() => setDescExpanded(false)}
              style={{
                fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: FONT,
                lineHeight: 1.55, display: "block", cursor: "pointer",
              }}
            >
              {description}
            </span>
          ) : (
            <div style={{ position: "relative", overflow: "hidden", lineHeight: "1.55", maxHeight: "1.55em" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: FONT, lineHeight: 1.55 }}>
                {description}
              </span>
              <span
                onClick={() => setDescExpanded(true)}
                style={{
                  position: "absolute", right: 0, bottom: 0,
                  paddingLeft: 28,
                  background: "linear-gradient(to right, transparent, rgba(10,10,10,0.97) 40%)",
                  fontSize: 12, fontWeight: 500,
                  color: "rgba(255,255,255,0.65)", cursor: "pointer", fontFamily: FONT,
                }}
              >
                ...más
              </span>
            </div>
          )
        )}

        </div>/* fin grupo título+descripción */
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DESKTOP — pantalla completa (portrait o horizontal)
  // ══════════════════════════════════════════════════════════════════════════
  if (isDesktop && isFullscreen) {
    return createPortal(
      <>
        <style>{keyframes}</style>
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 10000, background: "#000",
            animation: open ? "lvFadeIn 0.2s ease" : "lvFadeOut 0.2s ease forwards",
          }}
          onClick={onClose}
        >
          <div
            style={{ position: "relative", width: "100%", height: "100%" }}
            onClick={(e) => { e.stopPropagation(); if (!isEnded && dvrAvailable) setHzControlsVisible(v => !v); }}
          >
            {renderVideo("contain", true)}
            {renderEndedOverlay()}
            {renderBannedOverlay()}
            {renderSuperOverlay()}
            {renderPauseButton()}
            {renderDvrBar(true)}
            {renderHeader(false, false)}
            {renderLiveBadge("bottom-right", badgeLift)}
            {renderViewerBadge("bottom-left", badgeLift)}

          </div>
        </div>
      </>,
      document.body
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DESKTOP — portrait: dos cards flotantes separadas (video + chat)
  // ══════════════════════════════════════════════════════════════════════════
  if (isDesktop && isPortrait) {
    const { width: pw, height: ph } = desktopStorySize();
    return createPortal(
      <>
        <style>{keyframes}</style>
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(0,0,0,0.88)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 20,
            animation: open ? "lvFadeIn 0.2s ease" : "lvFadeOut 0.2s ease forwards",
          }}
          onClick={onClose}
        >
          {/* Card de video */}
          <div
            style={{
              position: "relative", width: pw, height: ph, background: "#000",
              borderRadius: 18, overflow: "hidden", flexShrink: 0,
              boxShadow: floatCardShadow,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderVideo("cover")}
            {renderEndedOverlay()}
            {renderBannedOverlay()}
            {renderSuperOverlay()}
            {renderDvrBar()}
            {renderHeader(false, false)}
            {renderLiveBadge()}
            {renderViewerBadge()}

          </div>
          {/* Card de chat */}
          <div
            style={{
              width: CHAT_FLOAT_W, height: ph,
              background: "rgba(10,10,10,0.97)",
              borderRadius: 18, overflow: "hidden", flexShrink: 0,
              boxShadow: floatCardShadow,
              display: "flex", flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderCreatorInfo()}
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              <LiveChatViewer liveId={post.id} chatEnabled={chatEnabled} liveEnded={isEnded} isMuted={isMuted} mode="panel" broadcastMode={liveData?.broadcastMode} superCommentConfig={liveData?.superCommentConfig} />
            </div>
          </div>
        </div>
      </>,
      document.body
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DESKTOP — horizontal: dos cards flotantes separadas (video grande + chat)
  // ══════════════════════════════════════════════════════════════════════════
  if (isDesktop) {
    const { width: hw, height: hh } = desktopHorizontalSize();
    return createPortal(
      <>
        <style>{keyframes}</style>
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(0,0,0,0.88)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 24,
            animation: open ? "lvFadeIn 0.2s ease" : "lvFadeOut 0.2s ease forwards",
          }}
          onClick={onClose}
        >
          {/* Card de video */}
          <div
            style={{
              position: "relative", width: hw, height: hh, background: "#000",
              borderRadius: 18, overflow: "hidden", flexShrink: 0,
              boxShadow: floatCardShadow,
            }}
            onClick={(e) => { e.stopPropagation(); if (!isEnded && dvrAvailable) setHzControlsVisible(v => !v); }}
          >
            {renderVideo("contain", true)}
            {renderEndedOverlay()}
            {renderBannedOverlay()}
            {renderSuperOverlay()}
            {renderPauseButton()}
            {renderDvrBar(true)}
            {renderHeader(false, false)}
            {renderLiveBadge("bottom-right", badgeLift)}
            {renderViewerBadge("bottom-left", badgeLift)}

          </div>
          {/* Card de chat */}
          <div
            style={{
              width: CHAT_FLOAT_W, height: hh,
              background: "rgba(10,10,10,0.97)",
              borderRadius: 18, overflow: "hidden", flexShrink: 0,
              boxShadow: floatCardShadow,
              display: "flex", flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderCreatorInfo()}
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              <LiveChatViewer liveId={post.id} chatEnabled={chatEnabled} liveEnded={isEnded} isMuted={isMuted} mode="panel" broadcastMode={liveData?.broadcastMode} superCommentConfig={liveData?.superCommentConfig} />
            </div>
          </div>
        </div>
      </>,
      document.body
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE — horizontal fullscreen
  // Si el teléfono está en portrait: rotamos 90deg el contenido para que el
  // video landscape llene toda la pantalla (igual que iOS fullscreen nativo).
  // Si ya está en landscape (orientation.lock en Android o giro manual):
  // llenamos normal con inset: 0 sin rotación.
  // En ambos casos: sin padding de safe area — el video invade todo.
  // ══════════════════════════════════════════════════════════════════════════
  if (!isDesktop && mobileFsHorizontal) {
    const needsRotation = screenIsPortrait;
    return createPortal(
      <>
        {/*
          lvm-hz-rot: truco CSS para mostrar contenido landscape en pantalla portrait.
          Matemática: element (dvh×dvw) → translateY(-100%) sube el elemento dvw px
          → rotate(90deg) desde top-left lo mapea exactamente a la pantalla portrait.
          Fallback vh/vw para iOS ≤ 15; dvh/dvw para iOS 16+.
        */}
        <style>{`${keyframes}.lvm-hz-rot{width:100vh;width:100dvh;height:100vw;height:100dvw;transform:rotate(90deg) translateY(-100%)}`}</style>
        <div
          className={needsRotation ? "lvm-hz-rot" : undefined}
          style={needsRotation ? {
            // width/height/transform vienen de .lvm-hz-rot (necesita fallback vh/vw)
            position: "fixed", top: 0, left: 0,
            transformOrigin: "top left",
            zIndex: 10001, background: "#000", overflow: "hidden",
          } : {
            // Pantalla ya en landscape: llenar normalmente
            position: "fixed", inset: 0,
            zIndex: 10001, background: "#000", overflow: "hidden",
          }}
        >
          <div
            style={{ position: "relative", width: "100%", height: "100%" }}
            onClick={() => { if (!isEnded && dvrAvailable) setHzControlsVisible(v => !v); }}
          >
            {renderVideo("cover", true)}
            {renderEndedOverlay()}
            {renderBannedOverlay()}
            {renderSuperOverlay()}
            {renderPauseButton()}
            {renderDvrBar(true)}
            {renderHeader(false, false)}
            {renderLiveBadge("bottom-right", badgeLift)}
            {renderViewerBadge("bottom-left", badgeLift)}

          </div>
        </div>
      </>,
      document.body
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE — portrait: fullscreen + overlay chat
  // ══════════════════════════════════════════════════════════════════════════
  if (isPortrait) {
    const ctrlStyle: CSSProperties = {
      opacity: controlsVisible ? 1 : 0,
      pointerEvents: controlsVisible ? "auto" : "none",
      transition: "opacity 0.25s ease",
    };
    return createPortal(
      <>
        <style>{keyframes}</style>
        <div
          style={{ position: "fixed", inset: 0, zIndex: 10000, background: "#000", display: "flex", flexDirection: "column" }}
        >
          <div
            style={{ position: "relative", flex: 1, minHeight: 0, height: "100%" }}
            onClick={() => { if (!isEnded) setControlsVisible(v => !v); }}
          >
            {renderVideo("cover")}
            {renderEndedOverlay()}
            {renderBannedOverlay()}
            {renderSuperOverlay()}
            {renderDvrBar()}

            {/* Badge siempre visible — cambia de EN VIVO a Finalizado al terminar */}
            {renderLiveBadge("top-center")}
            {renderViewerBadge("top-left")}

            {/* Header y chat se ocultan con tap */}
            <div style={ctrlStyle}>{renderHeader(true, false)}</div>
            <div style={ctrlStyle}>
              <LiveChatViewer liveId={post.id} chatEnabled={chatEnabled} liveEnded={isEnded} isMuted={isMuted} mode="overlay" broadcastMode={liveData?.broadcastMode} superCommentConfig={liveData?.superCommentConfig} />
            </div>
          </div>
        </div>
      </>,
      document.body
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE — horizontal: video top + chat panel below
  // ══════════════════════════════════════════════════════════════════════════
  return createPortal(
    <>
      <style>{keyframes}</style>
      <div style={{
        position: "fixed", inset: 0, zIndex: 10000, background: "#0a0a0a",
        display: "flex", flexDirection: "column",
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}>
        {/* Video */}
        <div
          style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000", flexShrink: 0 }}
        >
          {renderVideo("cover")}
          {renderEndedOverlay()}
          {renderBannedOverlay()}
          {renderSuperOverlay()}
          {renderDvrBar()}
          {renderHeader(false, false)}
          {renderLiveBadge()}
          {renderViewerBadge()}
        </div>

        {/* Panel: creator info + chat */}
        <div style={{
          flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          overflow: "hidden",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}>
          {renderCreatorInfo()}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <LiveChatViewer liveId={post.id} chatEnabled={chatEnabled} liveEnded={isEnded} isMuted={isMuted} mode="panel" broadcastMode={liveData?.broadcastMode} superCommentConfig={liveData?.superCommentConfig} />
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
