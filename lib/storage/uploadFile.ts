import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";

import { storage } from "@/lib/firebase";
import { normalizeImageFile } from "@/lib/uploads/image-normalizer";

type UploadOptions = {
  file: File;
  path: string;
  onProgress?: (progress: number) => void;
};

const MAX_IMAGE_SIZE_BYTES = 80 * 1024 * 1024;

function isImageLike(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  return (
    type.startsWith("image/") ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

export async function uploadFile({ file, path, onProgress }: UploadOptions) {
  const fileToUpload = isImageLike(file)
    ? (
        await normalizeImageFile(file, {
          maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
        })
      ).file
    : file;

  return new Promise<string>((resolve, reject) => {
    const storageRef = ref(storage, path);

    const uploadTask = uploadBytesResumable(storageRef, fileToUpload, {
      contentType: fileToUpload.type || undefined,
    });

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress =
          (snapshot.bytesTransferred / snapshot.totalBytes) * 100;

        onProgress?.(progress);
      },
      (error) => {
        reject(error);
      },
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        resolve(downloadURL);
      }
    );
  });
}