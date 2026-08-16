"use client";

/**
 * Grabación de video desde la cámara del navegador.
 *
 * Extraído de `GreetingReviewOverlay`, donde vivía enredado con el flujo de
 * saludos pagados (comprador, ganancias, historias, descargas). Aquí queda solo
 * la parte de medios, que no sabe nada de para qué se graba.
 *
 * 🚨 Los ajustes de abajo NO son arbitrarios: cada uno arregla un fallo real que
 * ya se pagó descubriendo. Cambiarlos sin repetir esas pruebas en un iPhone es
 * volver a romper lo mismo.
 */

import { useCallback, useRef, useState } from "react";

export type RecordPhase = "idle" | "preview" | "recording" | "done";

export type VideoRecorderState = {
  phase: RecordPhase;
  /** URL local del video grabado, para previsualizar antes de subir. */
  recordedBlobUrl: string | null;
  /** El archivo en sí, listo para subir. */
  recordedBlob: Blob | null;
  seconds: number;
  error: string | null;
};

export function useVideoRecorder(options?: {
  onError?: () => string;
  /**
   * Corta la grabación sola al llegar a este segundo. Cada uso tiene su tope: un
   * saludo lo fija la compra, una muestra lo fija el producto. Sin esto, el
   * creador puede grabar diez minutos y descubrir el límite al intentar subir.
   */
  maxSeconds?: number;
}) {
  const [phase, setPhase] = useState<RecordPhase>("idle");
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("");
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Pide cámara y micrófono y deja el previo listo. */
  const openCamera = useCallback(async () => {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // 1080p@30 con TOPE (max): pedir 4K@60 saturaba el encoder del celular y
        // dejaba de producir frames a mitad de la grabación (video congelado con
        // el audio corriendo). Con este tope codifica estable en cualquier
        // teléfono, sin importar la duración.
        video: {
          facingMode: "user",
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 2 },
        },
      });

      streamRef.current = stream;
      setPhase("preview");
      return stream;
    } catch {
      setError(options?.onError?.() ?? "No se pudo acceder a la cámara.");
      stopCamera();
      return null;
    }
  }, [options, stopCamera]);

  const startRecording = useCallback(() => {
    const cameraStream = streamRef.current;
    if (!cameraStream) return;

    chunksRef.current = [];

    const preferredTypes = [
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType =
      preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

    // 🚨 NO forzar `videoBitsPerSecond`. El cálculo que hubo antes daba ~8 kbps
    // para 1080p: Chrome lo ignora y usa su default, pero iOS Safari lo respeta
    // literal y codifica poco más que el primer keyframe → video congelado con
    // audio. Se deja que el navegador elija el bitrate de video.
    const mrOptions = (
      mimeType
        ? { mimeType, audioBitsPerSecond: 192_000 }
        : { audioBitsPerSecond: 192_000 }
    ) as MediaRecorderOptions;

    const recorder = new MediaRecorder(cameraStream, mrOptions);

    // Tipo REAL del grabador: iOS puede ignorar el pedido y usar otro. Si no se
    // lee de vuelta, el Blob queda mal etiquetado y el previo no decodifica.
    mimeTypeRef.current = recorder.mimeType || mimeType;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      cameraStream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      const blob = new Blob(chunksRef.current, {
        type: mimeTypeRef.current || "video/mp4",
      });

      setRecordedBlob(blob);

      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      setRecordedBlobUrl(url);
      setPhase("done");
    };

    // 🚨 `timeslice` de 1s. Sin él, en iOS Safari la pista de VIDEO se congela a
    // los ~13-15s mientras el audio sigue. Pedir datos cada segundo mantiene
    // viva la codificación toda la grabación; los trozos se reensamblan al
    // parar.
    recorder.start(1000);
    recorderRef.current = recorder;

    setSeconds(0);
    setPhase("recording");

    const limit = options?.maxSeconds;

    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        // El corte se pide desde aquí y no desde un efecto aparte: el efecto
        // tendría que depender del contador y se re-suscribiría cada segundo.
        if (limit != null && next >= limit) recorder.stop();
        return next;
      });
    }, 1000);
  }, [options?.maxSeconds]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * Usa un archivo ya existente en lugar de grabar.
   *
   * El resto del flujo —previsualizar y subir— es idéntico, así que comparten
   * estado: quien consume el hook no necesita saber si el video se grabó o se
   * eligió del carrete.
   */
  const useExistingFile = useCallback((file: File) => {
    stopCamera();

    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const url = URL.createObjectURL(file);
    blobUrlRef.current = url;

    setRecordedBlob(file);
    setRecordedBlobUrl(url);
    setPhase("done");
  }, [stopCamera]);

  /** Descarta lo grabado y vuelve al previo para repetir. */
  const reset = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    setRecordedBlob(null);
    chunksRef.current = [];
    setRecordedBlobUrl(null);
    setSeconds(0);
    setPhase("idle");
  }, []);

  /** Suelta cámara, temporizador y la URL local. Llamar al cerrar. */
  const dispose = useCallback(() => {
    stopCamera();
    recorderRef.current = null;

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, [stopCamera]);

  /**
   * Conecta el previo en vivo a un `<video>`. Se expone esto en vez del ref del
   * stream: devolver refs desde un hook obliga a quien lo usa a manejar el ciclo
   * de vida del MediaStream, que es justo lo que este hook existe para esconder.
   */
  const attachPreview = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    el.srcObject = streamRef.current;
  }, []);

  return {
    phase,
    recordedBlobUrl,
    recordedBlob,
    seconds,
    error,
    attachPreview,
    openCamera,
    useExistingFile,
    startRecording,
    stopRecording,
    reset,
    dispose,
  };
}
