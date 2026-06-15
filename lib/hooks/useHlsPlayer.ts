"use client";

import { type RefObject, useEffect, useRef } from "react";
import type HlsType from "hls.js";

/**
 * Attaches an HLS or regular video source to a <video> element.
 * - Safari / iOS WebKit: uses native HLS decoder (no extra library).
 * - Chrome, Firefox, Android: dynamically loads hls.js for .m3u8 sources.
 * - MP4 / other formats: sets src directly.
 *
 * The video element should NOT have a `src` prop — this hook manages it imperatively.
 */
export function useHlsPlayer(
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string | null,
) {
  const hlsRef = useRef<HlsType | null>(null);

  useEffect(() => {
    const video = videoRef.current;

    // Destroy any previous hls instance before switching source
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (!video || !src) {
      if (video) video.src = "";
      return;
    }

    const isHls = src.includes(".m3u8");

    // Native HLS support — Safari, iOS WebKit
    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.load();
      video.play().catch(() => {});
      return;
    }

    // Chrome, Firefox, Android — use hls.js
    import("hls.js").then(({ default: Hls }) => {
      // Re-check that video still exists and src hasn't changed
      if (!videoRef.current || videoRef.current.src !== "") return;

      if (!Hls.isSupported()) {
        // Last resort: attempt direct src (may fail on Firefox)
        video.src = src;
        video.play().catch(() => {});
        return;
      }

      const hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        enableWorker: true,
      });

      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });
    });

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
}
