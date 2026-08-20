"use client";

// Las muestras de saludos y consejos, dentro del feed de reels.
//
// Un creador que activa su servicio puede grabar hasta tres ejemplos,
// inventándose la solicitud. No hay comprador, ni cobro, ni encargo: viven en su
// propia colección, `greetingSamples`.
//
// Hasta ahora solo las veía su propio dueño, en el panel de configuración. O sea
// que el escaparate que justifica la función —un escaparate vacío no vende— no
// llegaba a ningún comprador. El reel es su primera salida al público.
//
// ⚠️ LA FORMA DE LA CONSULTA NO ES NEGOCIABLE. Fija los tres campos que la regla
// comprueba. En un `list` la regla se evalúa documento a documento y basta con
// que uno no pase para que se deniegue la consulta ENTERA, así que el resultado
// no puede contener nada que no sea escaparate.
//
// Solo entran las de PERFIL. Las de comunidad deberían heredar la visibilidad de
// su comunidad, y comprobar eso por documento es lo que agota el tope de accesos
// de un `list`. Es la misma línea que ya deja fuera del reel a las historias de
// comunidades privadas.

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { StoryDoc } from "@/lib/stories/types";

/**
 * Tope de muestras que se traen.
 *
 * Son pocas por diseño —tres por servicio— y solo sirven para dar de comer al
 * feed cuando aún hay poco material, así que no hace falta paginarlas.
 */
const SAMPLES_LIMIT = 30;

/**
 * Convierte una muestra en la forma que el reel ya sabe pintar.
 *
 * No es un disfraz: para quien mira, una muestra ES un saludo o un consejo, con
 * su video, su contexto y su creador. Lo que la distingue —que nadie la encargó—
 * no cambia un solo píxel de cómo se ve, así que reutiliza el mismo slide en vez
 * de duplicarlo.
 *
 * Lo que sí cambia queda marcado con `isSample`.
 */
export function sampleToStory(d: {
  id: string;
  data: () => DocumentData | undefined;
}): StoryDoc {
  // Acepta tanto un documento de consulta como uno suelto: el enlace compartido
  // llega por `getDoc`, donde el contenido puede venir vacio.
  const g = d.data() ?? {};
  return {
    id: d.id,
    creatorId: typeof g.creatorId === "string" ? g.creatorId : "",
    type: g.type === "consejo" ? "consejo" : "saludo",
    muxPlaybackId: typeof g.muxPlaybackId === "string" ? g.muxPlaybackId : null,
    thumbnailUrl: null,
    videoDuration: typeof g.videoDuration === "number" ? g.videoDuration : null,
    // El contexto que el creador escribió al grabar hace de instrucciones: es
    // literalmente el mismo texto que se lee en pantalla.
    instructions: typeof g.context === "string" ? g.context : undefined,
    // No hay encargo detrás. El reel usa esto para identificar el VIDEO, y sin
    // ello recurre al id del documento, que aquí es igual de único.
    greetingRequestId: "",
    source: "profile",
    groupId: null,
    createdAt: g.createdAt ?? null,
    isSample: true,
  };
}

/** Las muestras publicables que hay ahora mismo. */
export async function fetchReelSamples(): Promise<StoryDoc[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, "greetingSamples"),
        where("status", "==", "ready"),
        where("isDeleted", "==", false),
        where("source", "==", "profile"),
        orderBy("createdAt", "desc"),
        limit(SAMPLES_LIMIT),
      ),
    );
    // Sin video no hay nada que enseñar, aunque el estado diga que está lista.
    return snap.docs.map(sampleToStory).filter((s) => !!s.muxPlaybackId);
  } catch (err) {
    // Sin muestras el feed sigue funcionando. Pero se dice el motivo: una
    // consulta denegada no puede verse igual que "no hay muestras".
    console.error("[reelSamples] fallo la consulta de muestras:", err);
    return [];
  }
}
