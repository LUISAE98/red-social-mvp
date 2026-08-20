"use client";

// Me gusta de una historia, desde el cliente.
//
// Es GLOBAL y uno por persona: darlo desde el feed de reels o desde el perfil
// del creador es lo mismo, suma uno y se ve igual en los dos sitios. No hay un
// contador por superficie.
//
// Si ya lo diste se lee del ESPEJO que vive bajo tu propio usuario, no de la
// subcolección de la historia. Así la respuesta llega con una lectura de un
// documento tuyo, sin depender de las reglas del contenido ni de listar nada.

import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";

/** ¿Esta persona ya le dio me gusta a esta historia? */
export async function hasLikedStory(uid: string, storyId: string): Promise<boolean> {
  if (!uid || !storyId) return false;
  try {
    const snap = await getDoc(doc(db, "users", uid, "storyLikes", storyId));
    return snap.exists();
  } catch {
    // Sin saberlo, se asume que no. Un corazón apagado que en realidad estaba
    // encendido se corrige al pulsarlo; al revés se queda mintiendo.
    return false;
  }
}

export type ToggleStoryLikeResult = { liked: boolean; likes: number };

/** Da o quita el me gusta. Devuelve el estado y el total que quedó. */
export async function toggleStoryLike(storyId: string): Promise<ToggleStoryLikeResult | null> {
  if (!storyId) return null;
  try {
    const call = httpsCallable<{ storyId: string }, ToggleStoryLikeResult>(
      functions,
      "toggleStoryLike",
    );
    const res = await call({ storyId });
    return res.data;
  } catch {
    // Quien llama ya pintó el cambio y lo revierte si esto falla.
    return null;
  }
}
