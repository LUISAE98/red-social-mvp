/**
 * Calibración de velocidad TTS por dispositivo.
 *
 * El primer arranque reproduce un texto corto en silencio (volume=0) para medir
 * cuántas palabras por segundo habla el motor TTS del dispositivo actual.
 * El resultado se guarda en localStorage y no vuelve a medirse nunca más.
 *
 * computeTtsRate() usa ese factor para ajustar `rate` de forma que el TTS
 * termine exactamente en `durationSecs`, independientemente del OS/navegador.
 *
 * refineTtsCalibration() refina el factor con cada supercomentario reproducido,
 * usando promedio exponencial (70% factor previo, 30% medición nueva).
 */

const LS_KEY = "vibra_tts_cal_v1";

// Texto de calibración: 8 palabras simples en español que todos los motores pronuncian igual
const CAL_TEXT = "uno dos tres cuatro cinco seis siete ocho";
const CAL_WORD_COUNT = 8;

// Fallback: ~150 wpm / 60 = 2.5 palabras por segundo (español neutro a rate=1)
const FALLBACK_WPS = 2.5;

// Mínimo de segundos restantes para que valga la pena iniciar TTS en entrada tardía
export const TTS_MIN_DURATION_SECS = 1.5;

let cachedWordsPerSec: number | null = null;
let calibrating = false;

function loadFromStorage(): number | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const v = parseFloat(raw);
    // Sanity check: entre 0.5 y 15 palabras/segundo
    return Number.isFinite(v) && v > 0.5 && v < 15 ? v : null;
  } catch {
    return null;
  }
}

function saveToStorage(v: number): void {
  try {
    localStorage.setItem(LS_KEY, String(v));
  } catch {
    // storage no disponible (modo privado sin cuota, etc.)
  }
}

/**
 * Inicia la calibración silenciosa del TTS del dispositivo.
 *
 * Debe llamarse dentro de un handler de gesto del usuario (ej. al abrir un modal),
 * porque iOS Safari bloquea speechSynthesis fuera de gestos.
 *
 * Si ya existe un valor en localStorage, lo carga sin reproducir nada.
 * Si ya está en progreso, no hace nada.
 */
export function initTtsCalibration(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (cachedWordsPerSec !== null || calibrating) return;

  const stored = loadFromStorage();
  if (stored !== null) {
    cachedWordsPerSec = stored;
    return;
  }

  calibrating = true;
  const u = new SpeechSynthesisUtterance(CAL_TEXT);
  u.lang = "es-MX";
  u.rate = 1;
  u.volume = 0;

  const t0 = performance.now();
  u.onend = () => {
    const secs = (performance.now() - t0) / 1000;
    // Entre 0.2s y 30s: rango válido para 8 palabras
    if (secs > 0.2 && secs < 30) {
      cachedWordsPerSec = CAL_WORD_COUNT / secs;
      saveToStorage(cachedWordsPerSec);
    }
    calibrating = false;
  };
  u.onerror = () => {
    calibrating = false;
  };

  window.speechSynthesis.speak(u);
}

/**
 * Calcula el `rate` necesario para que el TTS del texto termine
 * exactamente en `durationSecs` segundos en el dispositivo actual.
 *
 * Si el TTS ya cabe sin acelerar, devuelve 1.
 * El rate máximo de la Web Speech API es 2.
 */
export function computeTtsRate(text: string, durationSecs: number): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const wps = cachedWordsPerSec ?? FALLBACK_WPS;
  const naturalSecs = wordCount / wps;
  if (naturalSecs <= durationSecs) return 1;
  return Math.min(2, naturalSecs / durationSecs);
}

/**
 * Refina la calibración con la medición real de un TTS reproducido.
 * Usa promedio exponencial para suavizar variaciones.
 *
 * @param text Texto que se habló
 * @param actualSecs Duración real medida (performance.now delta)
 * @param usedRate El `rate` que se usó al reproducirlo
 */
export function refineTtsCalibration(text: string, actualSecs: number, usedRate: number): void {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  // Descartar mediciones muy cortas o sospechosas
  if (wordCount < 3 || actualSecs < 0.3 || actualSecs > 60) return;
  // Normalizar a rate=1: si hablamos a rate=2, el natural sería el doble
  const naturalSecs = actualSecs * usedRate;
  const measured = wordCount / naturalSecs;
  cachedWordsPerSec =
    cachedWordsPerSec !== null
      ? cachedWordsPerSec * 0.7 + measured * 0.3
      : measured;
  saveToStorage(cachedWordsPerSec);
}
