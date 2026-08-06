// Firma de reproducción de Mux (playback firmado).
//
// Un asset con `playback_policy: "signed"` no se puede reproducir con la URL a
// secas: hay que acompañarla de un JWT firmado con la llave privada de la cuenta
// de Mux. Eso convierte la URL en un permiso TEMPORAL, en vez de un enlace
// eterno que cualquiera puede reenviar.
//
// Vibra usa esto solo para el contenido DE PAGO. El video gratis sigue siendo
// público (no tiene sentido cobrarle un token a nadie).
//
// Audiencias (`aud`) del JWT según Mux:
//   v = video (HLS)   ·   t = miniatura   ·   s = storyboard   ·   g = gif
//
// La llave privada se guarda en Secret Manager en base64 (tal cual la entrega el
// panel de Mux) y NUNCA en el repositorio.

import * as crypto from "crypto";
import { defineSecret } from "firebase-functions/params";

export const muxSigningKeyId = defineSecret("MUX_SIGNING_KEY_ID");
export const muxSigningPrivateKey = defineSecret("MUX_SIGNING_PRIVATE_KEY");

export type MuxTokenAudience = "v" | "t" | "s" | "g";

/** Duración por defecto del permiso de video: suficiente para ver, corto para filtrar. */
export const PLAYBACK_TOKEN_TTL_SECONDS = 6 * 60 * 60; // 6 horas

/**
 * La miniatura sí se muestra a quien NO ha pagado (es la portada del paywall),
 * así que su token se emite con vida larga y se guarda en el documento público.
 * Un token de `aud: "t"` solo sirve para la imagen: no abre el video.
 */
export const THUMBNAIL_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 año

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function readPrivateKey(): string {
  const raw = muxSigningPrivateKey.value();
  if (!raw) throw new Error("Falta el secreto MUX_SIGNING_PRIVATE_KEY.");

  // El panel de Mux entrega la llave en base64; se admite también el PEM plano.
  const trimmed = raw.trim();
  if (trimmed.startsWith("-----BEGIN")) return trimmed;
  return Buffer.from(trimmed, "base64").toString("utf8");
}

/** ¿Está configurada la firma? Permite degradar sin romper si falta el secreto. */
export function isMuxSigningConfigured(): boolean {
  try {
    return Boolean(muxSigningKeyId.value()) && Boolean(muxSigningPrivateKey.value());
  } catch {
    return false;
  }
}

/**
 * Firma un JWT RS256 para un playbackId concreto. Se hace con `crypto` nativo
 * para no sumar dependencias al bundle de funciones.
 */
export function signMuxPlaybackToken(params: {
  playbackId: string;
  audience: MuxTokenAudience;
  expiresInSeconds: number;
  /** Parámetros extra que Mux exige repetir dentro del token (p. ej. `time` de la miniatura). */
  extraClaims?: Record<string, string | number>;
}): string {
  const keyId = muxSigningKeyId.value();
  if (!keyId) throw new Error("Falta el secreto MUX_SIGNING_KEY_ID.");

  const nowSeconds = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT", kid: keyId };
  const payload = {
    sub: params.playbackId,
    aud: params.audience,
    exp: nowSeconds + params.expiresInSeconds,
    kid: keyId,
    ...(params.extraClaims ?? {}),
  };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(payload)
  )}`;

  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(readPrivateKey());

  return `${signingInput}.${base64Url(signature)}`;
}

/** URL HLS lista para reproducir (token de video incluido). */
export function buildSignedHlsUrl(playbackId: string, ttlSeconds = PLAYBACK_TOKEN_TTL_SECONDS): string {
  const token = signMuxPlaybackToken({
    playbackId,
    audience: "v",
    expiresInSeconds: ttlSeconds,
  });
  return `https://stream.mux.com/${playbackId}.m3u8?token=${token}`;
}

/** URL de miniatura firmada — la portada del paywall, visible para todos. */
export function buildSignedThumbnailUrl(
  playbackId: string,
  ttlSeconds = THUMBNAIL_TOKEN_TTL_SECONDS
): string {
  const token = signMuxPlaybackToken({
    playbackId,
    audience: "t",
    expiresInSeconds: ttlSeconds,
  });
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?token=${token}`;
}
