"use client";

// El contador de vistas de una historia.
//
// ⚠️ Una VISTA no es lo mismo que "ya la vi", y confundirlas fue el fallo que
// esto viene a separar:
//
//   · "ya la vi"  → 2 segundos. Marca `userStoryViews` y hace que el feed de
//                   reels no vuelva a mostrarla. Es una sola vez por persona.
//   · una VISTA   → 35% del video. Suma al contador público. Cuenta CADA vez:
//                   verla en el reel y luego otra vez desde el perfil del
//                   creador son dos vistas.
//
// Dos umbrales, dos significados y dos recuentos. Hasta ahora el contador se
// alimentaba del marcador de los dos segundos, así que el número decía otra cosa
// de la que aparentaba.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

/** Fracción del video que hay que ver para que cuente como vista. */
export const PLAY_COUNT_THRESHOLD = 0.35;

/**
 * Suma una vista. Se llama UNA vez por apertura de la historia.
 *
 * No devuelve nada útil a propósito: quien lo llama ya ha pintado el número
 * sumado, y si la llamada falla, un contador desfasado es preferible a un aviso
 * de error por algo que al espectador no le importa.
 */
export async function recordStoryPlay(storyId: string): Promise<void> {
  if (!storyId) return;
  try {
    const call = httpsCallable<{ storyId: string }, { counted: boolean }>(
      functions,
      "recordStoryPlay",
    );
    await call({ storyId });
  } catch {
    // Silencio deliberado.
  }
}
