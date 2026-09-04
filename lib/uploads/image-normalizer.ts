export type NormalizedImageFile = {
  file: File;
  wasConverted: boolean;
  originalType: string;
  originalName: string;
};

export type NormalizedImageThumbnail = {
  file: File;
};

const DEFAULT_MAX_IMAGE_SIZE_BYTES = 150 * 1024 * 1024;

/**
 * Los avisos, en un solo sitio.
 *
 * 🚨 ESTAS CADENAS SON TAMBIÉN LA LLAVE DE `lib/i18n/cfError.ts`. Es ahí donde
 * se traducen a los 47 idiomas, buscando el mensaje en minúsculas. Cambiar una
 * aquí sin cambiarla allí deja el aviso en español para todo el mundo.
 *
 * Ninguno lleva dos puntos ni menciona el iPhone. El de antes decía "No se pudo
 * convertir la imagen del iPhone" a cualquiera, incluido quien subía desde un
 * escritorio con Chrome.
 */
const MENSAJES = {
  demasiadoGrande: "La imagen no puede pesar más de 150 MB.",
  ilegible: "No se pudo abrir esta imagen.",
  formatoNoAdmitido: "Este formato de imagen no se puede usar.",
  procesoFallido: "No se pudo procesar la imagen.",
} as const;

const OUTPUT_MAX_WIDTH = 2000;
const OUTPUT_MAX_HEIGHT = 2000;
const OUTPUT_QUALITY = 0.82;

const THUMBNAIL_MAX_WIDTH = 720;
const THUMBNAIL_MAX_HEIGHT = 720;
const THUMBNAIL_QUALITY = 0.72;

/**
 * Formato REAL del archivo, leído de sus primeros bytes.
 *
 * 🚨 NO SE MIRA NI LA EXTENSIÓN NI EL `type` DEL FICHERO. Los dos mienten, y de
 * ahí salía el fallo: una imagen descargada de una web se guarda como `.jpg`
 * siendo AVIF o WebP por dentro, el navegador la reportaba como `image/jpeg`, se
 * daba por buena y luego `<img>` no podía decodificarla. El aviso que salía era
 * "El navegador no pudo leer esta imagen", que no decía nada útil ni tenía
 * arreglo posible por parte de quien subía.
 *
 * Los primeros bytes no mienten: son la firma del formato.
 */
type FormatoDeImagen =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "bmp"
  | "avif"
  | "heic"
  | "tiff"
  | "desconocido";

/** Formatos que los navegadores actuales decodifican sin ayuda. */
const DECODIFICA_EL_NAVEGADOR = new Set<FormatoDeImagen>([
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "avif",
]);

function texto(bytes: Uint8Array, desde: number, hasta: number): string {
  return String.fromCharCode(...bytes.slice(desde, hasta));
}

function empiezaPor(bytes: Uint8Array, firma: number[]): boolean {
  return firma.every((b, i) => bytes[i] === b);
}

/**
 * Marcas de la caja `ftyp`, que comparten AVIF y HEIC.
 *
 * Las dos familias usan el mismo contenedor (ISO-BMFF) y solo se distinguen por
 * la marca principal. Importa mucho separarlas: AVIF lo decodifica el navegador
 * solo, y HEIC necesita pasar por el conversor.
 */
const MARCAS_AVIF = new Set(["avif", "avis"]);
const MARCAS_HEIC = new Set([
  "heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1",
]);

async function detectarFormato(file: File): Promise<FormatoDeImagen> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  } catch {
    // El archivo no se puede leer siquiera. Pasa con los marcadores de nube
    // (OneDrive, iCloud) que aún no se han descargado de verdad.
    return "desconocido";
  }

  if (bytes.length < 12) return "desconocido";

  if (empiezaPor(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (empiezaPor(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (texto(bytes, 0, 4) === "GIF8") return "gif";
  if (texto(bytes, 0, 4) === "RIFF" && texto(bytes, 8, 12) === "WEBP") return "webp";
  if (empiezaPor(bytes, [0x42, 0x4d])) return "bmp";
  if (
    empiezaPor(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    empiezaPor(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return "tiff";
  }

  if (texto(bytes, 4, 8) === "ftyp") {
    const marca = texto(bytes, 8, 12).toLowerCase();
    if (MARCAS_AVIF.has(marca)) return "avif";
    if (MARCAS_HEIC.has(marca)) return "heic";
  }

  return "desconocido";
}

function getSafeBaseName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^/.]+$/, "");
  const safe = withoutExtension
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return safe || "image";
}

function assertMaxSize(file: File, maxSizeBytes: number) {
  if (file.size > maxSizeBytes) {
    throw new Error(MENSAJES.demasiadoGrande);
  }
}

function getOutputSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
) {
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);

  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(MENSAJES.ilegible));
    };

    image.src = objectUrl;
  });
}

async function compressImageToJpeg(
  file: File,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    fileNameSuffix?: string;
  }
): Promise<File> {
  const image = await loadImageFromFile(file);

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error(MENSAJES.ilegible);
  }

  const outputSize = getOutputSize(
    sourceWidth,
    sourceHeight,
    options?.maxWidth ?? OUTPUT_MAX_WIDTH,
    options?.maxHeight ?? OUTPUT_MAX_HEIGHT
  );

  const canvas = document.createElement("canvas");
  canvas.width = outputSize.width;
  canvas.height = outputSize.height;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error(MENSAJES.procesoFallido);
  }

  ctx.drawImage(image, 0, 0, outputSize.width, outputSize.height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error(MENSAJES.procesoFallido));
          return;
        }

        resolve(result);
      },
      "image/jpeg",
      options?.quality ?? OUTPUT_QUALITY
    );
  });

  const suffix = options?.fileNameSuffix ? `-${options.fileNameSuffix}` : "";
  const nextName = `${getSafeBaseName(file.name)}${suffix}.jpg`;

  return new File([blob], nextName, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

async function convertHeicToJpeg(file: File): Promise<File> {
  const nextName = `${getSafeBaseName(file.name)}.jpg`;

  try {
    if (typeof window === "undefined") {
      throw new Error(MENSAJES.procesoFallido);
    }

    const { default: heic2any } = await import("heic2any");

    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.88,
    });

    const blob = Array.isArray(converted) ? converted[0] : converted;

    if (blob instanceof Blob) {
      const convertedFile = new File([blob], nextName, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });

      return compressImageToJpeg(convertedFile);
    }
  } catch {
    // Fallback abajo.
  }

  return compressImageToJpeg(
    new File([file], nextName, {
      type: "image/jpeg",
      lastModified: Date.now(),
    })
  );
}

export async function createImageThumbnailFile(
  file: File
): Promise<NormalizedImageThumbnail> {
  const thumbnailFile = await compressImageToJpeg(file, {
    maxWidth: THUMBNAIL_MAX_WIDTH,
    maxHeight: THUMBNAIL_MAX_HEIGHT,
    quality: THUMBNAIL_QUALITY,
    fileNameSuffix: "thumb",
  });

  return {
    file: thumbnailFile,
  };
}

export async function normalizeImageFile(
  file: File,
  options?: {
    maxSizeBytes?: number;
  }
): Promise<NormalizedImageFile> {
  const maxSizeBytes = options?.maxSizeBytes ?? DEFAULT_MAX_IMAGE_SIZE_BYTES;

  assertMaxSize(file, maxSizeBytes);

  const originalType = file.type || "application/octet-stream";
  const originalName = file.name || "image";

  const formato = await detectarFormato(file);

  // TIFF no lo decodifica ningún navegador, así que se dice claro y aquí en vez
  // de dejar que falle tres funciones más abajo con un aviso que no ayuda.
  if (formato === "tiff") {
    throw new Error(MENSAJES.formatoNoAdmitido);
  }

  if (formato === "heic") {
    return {
      file: await convertHeicToJpeg(file),
      wasConverted: true,
      originalType,
      originalName,
    };
  }

  if (DECODIFICA_EL_NAVEGADOR.has(formato)) {
    return {
      // AVIF y WebP entran por aquí aunque el archivo se llame `.jpg`: lo que
      // manda es la firma, no el nombre. Ese desajuste era el fallo original.
      file: await compressImageToJpeg(file),
      // Se marca como convertido si el original no era ya un JPEG, que es lo
      // que sale del compresor.
      wasConverted: formato !== "jpeg",
      originalType,
      originalName,
    };
  }

  // Formato sin identificar. Se intenta igual, por si es algo que el navegador
  // sabe abrir y nosotros no reconocemos —o un HEIC con una marca rara—, pero
  // ya sin prometer nada.
  try {
    return {
      file: await compressImageToJpeg(file),
      wasConverted: true,
      originalType,
      originalName,
    };
  } catch {
    try {
      return {
        file: await convertHeicToJpeg(file),
        wasConverted: true,
        originalType,
        originalName,
      };
    } catch {
      throw new Error(MENSAJES.formatoNoAdmitido);
    }
  }
}