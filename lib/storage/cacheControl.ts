/**
 * Cabecera de caché de TODO lo que se sube a Storage.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 Sin esto, el navegador vuelve a descargar cada imagen SIEMPRE.
 *
 * Firebase Storage no pone `Cache-Control` por su cuenta: si la subida no lo
 * declara, el objeto se sirve como privado y sin vida útil, y el navegador lo
 * pide entero en cada render, en cada navegación y en cada recarga. Se nota
 * sobre todo en los avatares del chat, que salen decenas de veces por pantalla
 * y parecen cargar de cero cada vez aunque el perfil esté cacheado — el dato
 * estaba, la imagen no.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Un año e `immutable` son seguros porque en esta plataforma la URL SIEMPRE
 * cambia cuando cambia el contenido, por uno de dos motivos:
 *
 *  - las rutas de contenido (publicaciones, mensajes, historias) llevan nombre
 *    único por archivo, así que reemplazar es subir a otro sitio;
 *  - avatar y portada sí reescriben la misma ruta, pero su URL se guarda con un
 *    sufijo de versión (`?v=…`) y además Storage emite un token de descarga
 *    nuevo al sobrescribir.
 *
 * ⚠️ Esto solo alcanza a lo que se suba DESDE AHORA. Lo ya guardado conserva su
 * metadato y sigue sin cachearse; hace falta un backfill que le pase
 * `setMetadata({ cacheControl })` con el Admin SDK.
 */
export const IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
