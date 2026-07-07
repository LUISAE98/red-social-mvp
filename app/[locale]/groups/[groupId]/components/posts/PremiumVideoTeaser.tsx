"use client";

import { useEffect, useRef } from "react";

interface Props {
  hlsUrl: string | null;
  directUrl?: string | null;
  thumbnailUrl?: string | null;
}

function buildClips(duration: number): Array<{ start: number; end: number }> {
  const CLIP_DURATION = 20;
  const count = Math.max(1, Math.min(Math.floor(duration / 60), 10));
  return Array.from({ length: count }, (_, i) => ({
    start: (duration / count) * i,
    end: Math.min((duration / count) * i + CLIP_DURATION, duration - 0.1),
  })).filter((c) => c.start < duration - 1);
}

export default function PremiumVideoTeaser({ hlsUrl, directUrl, thumbnailUrl }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const clipsRef = useRef<Array<{ start: number; end: number }>>([]);
  const clipIdxRef = useRef(0);

  const src = hlsUrl ?? directUrl ?? null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let destroyed = false;
    let hlsInstance: { destroy: () => void } | null = null;

    function onLoadedMetadata() {
      if (destroyed) return;
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
      const clips = buildClips(v.duration);
      clipsRef.current = clips;
      clipIdxRef.current = 0;
      if (clips[0]) v.currentTime = clips[0].start;
      v.play().catch(() => {});
    }

    function onTimeUpdate() {
      const v = videoRef.current;
      const clips = clipsRef.current;
      if (!v || !clips.length) return;
      const clip = clips[clipIdxRef.current];
      if (clip && v.currentTime >= clip.end) {
        const next = (clipIdxRef.current + 1) % clips.length;
        clipIdxRef.current = next;
        v.currentTime = clips[next]!.start;
      }
    }

    function onEnded() {
      const v = videoRef.current;
      const clips = clipsRef.current;
      if (!v || !clips.length) return;
      clipIdxRef.current = 0;
      v.currentTime = clips[0]!.start;
      v.play().catch(() => {});
    }

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);

    const isHls = src.includes(".m3u8");

    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.load();
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (destroyed || !videoRef.current) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true, startLevel: -1, maxBufferLength: 30 });
          hlsInstance = hls;
          hls.loadSource(src);
          hls.attachMedia(videoRef.current);
          hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) hls.destroy();
          });
        } else {
          videoRef.current.src = src;
          videoRef.current.load();
        }
      });
    }

    return () => {
      destroyed = true;
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
      hlsInstance?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);

  return (
    <>
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt=""
          aria-hidden="true"
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            objectFit: "cover",
            pointerEvents: "none",
          }}
        />
      )}
      {src && (
        <video
          ref={videoRef}
          muted
          playsInline
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            objectFit: "cover",
            pointerEvents: "none",
          }}
        />
      )}
    </>
  );
}
