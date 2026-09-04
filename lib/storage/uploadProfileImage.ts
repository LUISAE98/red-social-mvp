import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { IMAGE_CACHE_CONTROL } from "./cacheControl";

export type ProfileImageKind = "avatar" | "cover";

// Sube un blob recortado (avatar o portada) a la MISMA ruta que usa el perfil
// (`users/{uid}/avatar/avatar.jpg` y `.../cover/cover.jpg`) y devuelve la URL de
// descarga con cache-buster (para que el navegador no sirva la imagen anterior
// tras reemplazarla). No escribe Firestore: eso lo decide quien lo llama.
export async function uploadProfileImage(
  uid: string,
  kind: ProfileImageKind,
  blob: Blob
): Promise<string> {
  const path =
    kind === "avatar"
      ? `users/${uid}/avatar/avatar.jpg`
      : `users/${uid}/cover/cover.jpg`;
  const contentType = blob.type || "image/jpeg";

  const storageRef = ref(storage, path);
  // El `?v=` de abajo es lo que hace segura una caché de un año: la ruta se
  // reescribe, pero la URL guardada en el perfil cambia con cada cambio de foto.
  // Sin la cabecera, esta imagen se volvía a descargar en CADA render del chat.
  await uploadBytes(storageRef, blob, { contentType, cacheControl: IMAGE_CACHE_CONTROL });
  const url = await getDownloadURL(storageRef);
  return `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`;
}
