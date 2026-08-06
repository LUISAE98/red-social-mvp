// Conversión de un asset de Mux de reproducción PÚBLICA a FIRMADA.
//
// Un asset público se reproduce con solo tener su `playbackId`: la URL sirve
// para siempre y para cualquiera. Para el contenido de pago eso significa que un
// comprador puede reenviar el enlace y todos ven gratis.
//
// Mux permite cambiar esto sin volver a subir el video: se le añade al asset un
// playbackId nuevo con política `signed` y se borra el público. A partir de ahí
// la URL solo funciona acompañada de un token firmado y con caducidad.
//
// Se usa la API REST directa (Basic auth con el token de la cuenta) en vez del
// SDK para no depender de la forma exacta de sus métodos entre versiones.

import * as logger from "firebase-functions/logger";
import { muxTokenId, muxTokenSecret } from "./mux";

const MUX_API = "https://api.mux.com/video/v1";

function authHeader(): string {
  const credentials = `${muxTokenId.value()}:${muxTokenSecret.value()}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

type PlaybackIdRecord = { id: string; policy: string };

async function listPlaybackIds(assetId: string): Promise<PlaybackIdRecord[]> {
  const res = await fetch(`${MUX_API}/assets/${assetId}`, {
    headers: { Authorization: authHeader() },
  });

  if (!res.ok) {
    throw new Error(`Mux GET asset ${assetId} falló: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as { data?: { playback_ids?: PlaybackIdRecord[] } };
  return body.data?.playback_ids ?? [];
}

async function createSignedPlaybackId(assetId: string): Promise<string> {
  const res = await fetch(`${MUX_API}/assets/${assetId}/playback-ids`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ policy: "signed" }),
  });

  if (!res.ok) {
    throw new Error(`Mux POST playback-id ${assetId} falló: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as { data?: PlaybackIdRecord };
  const id = body.data?.id;
  if (!id) throw new Error(`Mux devolvió un playback-id vacío para ${assetId}.`);
  return id;
}

async function deletePlaybackId(assetId: string, playbackId: string): Promise<void> {
  const res = await fetch(`${MUX_API}/assets/${assetId}/playback-ids/${playbackId}`, {
    method: "DELETE",
    headers: { Authorization: authHeader() },
  });

  // 404 = ya no existe; para nuestros efectos es éxito.
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Mux DELETE playback-id ${playbackId} falló: ${res.status} ${await res.text()}`
    );
  }
}

/**
 * Deja el asset con UN solo playbackId firmado y devuelve su id.
 *
 * Idempotente: si ya tiene uno firmado, lo reutiliza (y de paso limpia los
 * públicos que hayan quedado). Devuelve null si el asset ya no existe en Mux.
 */
export async function ensureSignedPlaybackId(assetId: string): Promise<string | null> {
  let playbackIds: PlaybackIdRecord[];

  try {
    playbackIds = await listPlaybackIds(assetId);
  } catch (error) {
    logger.warn("muxSignedAssets: no se pudo leer el asset", {
      assetId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const existingSigned = playbackIds.find((item) => item.policy === "signed");
  const signedId = existingSigned?.id ?? (await createSignedPlaybackId(assetId));

  // Con el firmado ya en su lugar, se retiran los públicos: son los que hacen
  // que el enlace funcione sin permiso.
  for (const item of playbackIds) {
    if (item.policy === "public") {
      await deletePlaybackId(assetId, item.id);
      logger.info("muxSignedAssets: playbackId público retirado", { assetId, publicId: item.id });
    }
  }

  return signedId;
}
