import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { sanitizeSocialLinks, type SocialLinks } from "./socialNetworks";

/**
 * Guarda las redes del perfil y devuelve lo que quedó guardado.
 *
 * Escribe directo, como la bio, porque no hay nada que decidir en el servidor:
 * las reglas de Firestore revisan la forma (mapa, solo las seis claves del
 * catálogo, cadenas cortas) y aquí se limpia el contenido antes de mandarlo.
 *
 * Espera a `authStateReady()` antes de escribir. Sin eso, un guardado disparado
 * en el primer render sale sin sesión y Firestore lo rechaza por permisos aunque
 * la persona sí esté dentro.
 */
export async function updateProfileSocialLinks(
  input: unknown
): Promise<SocialLinks> {
  await auth.authStateReady();

  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("No hay sesión iniciada.");

  const socialLinks = sanitizeSocialLinks(input);

  await updateDoc(doc(db, "users", uid), {
    socialLinks,
    updatedAt: serverTimestamp(),
  });

  return socialLinks;
}
