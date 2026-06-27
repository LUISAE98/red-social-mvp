// Minimum display duration (secs) for TTS to be worth playing
export const TTS_MIN_DURATION_SECS = 4;

export interface EdgeTTSHandle {
  stop: () => void;
  setVolume: (v: number) => void;
  audio: HTMLAudioElement;
}

export const EDGE_TTS_VOICE = "es-MX-DaliaNeural";

/**
 * Plays TTS via the /api/tts route (msedge-tts, Microsoft Neural voice).
 * Returns a handle to stop playback and change volume.
 * No user gesture required — uses a standard <audio> element.
 */
export function playEdgeTTS(
  text: string,
  options: {
    volume?: number;
    playbackRate?: number;
    onEnded?: () => void;
    onError?: () => void;
    onProgress?: (ratio: number) => void;
    voice?: string;
  } = {},
): EdgeTTSHandle {
  const {
    volume = 1,
    playbackRate = 1,
    onEnded,
    onError,
    onProgress,
    voice = EDGE_TTS_VOICE,
  } = options;

  const url = `/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}`;
  const audio = new Audio(url);
  audio.volume = volume;
  audio.playbackRate = playbackRate;

  if (onProgress) {
    audio.addEventListener("timeupdate", () => {
      if (audio.duration > 0) onProgress(audio.currentTime / audio.duration);
    });
  }
  if (onEnded) audio.addEventListener("ended", onEnded);
  if (onError) audio.addEventListener("error", onError);

  audio.play().catch(() => {});

  return {
    audio,
    stop: () => {
      audio.pause();
      audio.src = "";
    },
    setVolume: (v: number) => {
      audio.volume = v;
    },
  };
}
