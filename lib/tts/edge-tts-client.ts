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
    // ⚠️ La PRIMERA vez, el audio llega en streaming desde /api/tts sin
    // Content-Length, así que `audio.duration` vale Infinity hasta que termina
    // de bajar. Con el guardia anterior, `onProgress` no se llamaba ni una vez
    // y el resaltado no arrancaba; a la segunda sí, porque el audio ya estaba
    // en caché y el navegador conocía la duración de entrada. Eso es lo que se
    // veía como "se traba la primera vez".
    //
    // Ahora hay una duración ESTIMADA por longitud del texto para arrancar
    // desde el primer segundo, y en cuanto el navegador conoce la real se usa
    // esa. Va en segundos de MEDIO, no de reloj, así que no se divide por la
    // velocidad: `currentTime` ya avanza en la escala del propio audio.
    const estimatedDuration = Math.max(1, text.length * 0.066);

    // ⚠️ NO se usa `timeupdate`: el navegador lo dispara unas cuatro veces por
    // segundo, así que el resaltado avanzaba a saltos y siempre por detrás de
    // la voz. `requestAnimationFrame` lee el MISMO dato —`currentTime`— pero
    // en cada fotograma, así que va pegado a lo que se oye.
    let rafId = 0;
    const tick = () => {
      const real = audio.duration;
      const total = real > 0 && isFinite(real) ? real : estimatedDuration;
      onProgress(Math.min(1, audio.currentTime / total));
      // Mientras suene, otro fotograma. Al pausar o acabar, el bucle muere
      // solo: no hay que acordarse de cancelarlo desde fuera.
      if (!audio.paused && !audio.ended) rafId = requestAnimationFrame(tick);
      else rafId = 0;
    };
    audio.addEventListener("play", () => {
      if (!rafId) rafId = requestAnimationFrame(tick);
    });
    // Un último tick al terminar, para que el resaltado llegue al final del
    // texto en vez de quedarse a un fotograma del borde.
    audio.addEventListener("ended", () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      onProgress(1);
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
