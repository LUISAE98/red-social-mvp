import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase";

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
  await uploadBytes(storageRef, blob, { contentType });
  const url = await getDownloadURL(storageRef);
  return `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`;
}
