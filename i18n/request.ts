import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

type MessageTree = { [key: string]: string | MessageTree };

/**
 * 🚨 RESPALDO EN INGLÉS PARA CLAVES QUE FALTEN 🚨
 *
 * Sin esto, una clave que exista en `en.json` pero todavía no en `fi.json` NO cae a otro
 * idioma: next-intl lanza `MISSING_MESSAGE` y pinta la RUTA CRUDA de la clave. El usuario
 * finlandés vería literalmente `wallet.creditAvailable` en pantalla.
 *
 * Y el test de paridad no lo atrapa: recorre solo las claves presentes en AMBOS archivos,
 * así que una clave ausente pasa en verde.
 *
 * El efecto era que añadir una cadena nueva obligaba a traducirla a los 43 idiomas EN EL
 * MISMO COMMIT o se rompía la app. Con este respaldo, una clave sin traducir se ve en
 * inglés —degradación aceptable— y la traducción puede llegar después.
 *
 * Se mezcla en profundidad porque los mensajes van por espacios de nombres (`wallet`,
 * `services`…): un `{...en, ...locale}` plano perdería las claves inglesas de cualquier
 * namespace que el idioma defina, que es justo el caso normal.
 */
function mergeDeep(base: MessageTree, override: MessageTree): MessageTree {
  const out: MessageTree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const prev = out[key];
    out[key] =
      typeof value === "object" && value !== null && typeof prev === "object" && prev !== null
        ? mergeDeep(prev, value)
        : value;
  }
  return out;
}

/**
 * El árbol ya fusionado, por idioma.
 *
 * El respaldo de arriba es obligatorio, pero se estaba pagando en CADA render
 * del servidor: `mergeDeep` recorre las 3 185 claves del árbol y medía **3,13 ms
 * por petición**. El `import()` del JSON sí lo cachea el sistema de módulos, así
 * que ese era todo el coste, y era puro trabajo repetido — el resultado es
 * idéntico petición tras petición porque los ficheros no cambian en caliente.
 *
 * Con esto la fusión ocurre UNA vez por idioma y por instancia del servidor.
 * El respaldo sigue exactamente igual de vivo: lo que se guarda es su resultado,
 * no la decisión de aplicarlo.
 *
 * (Medido el 2026-09-04: los 46 idiomas tienen HOY las 3 185 claves completas,
 * así que la fusión no está tapando ningún hueco. No es motivo para quitarla —
 * existe justo para el día en que se añada una cadena nueva y aún no esté
 * traducida— pero sí para dejar de recalcularla en cada visita.)
 */
const fusionados = new Map<string, MessageTree>();

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale;
  }

  const enCache = fusionados.get(locale);
  if (enCache) return { locale, messages: enCache };

  const messages = (await import(`../messages/${locale}.json`)).default as MessageTree;

  if (locale === routing.defaultLocale) {
    fusionados.set(locale, messages);
    return { locale, messages };
  }

  const fallback = (await import(`../messages/${routing.defaultLocale}.json`))
    .default as MessageTree;

  const fusionado = mergeDeep(fallback, messages);
  fusionados.set(locale, fusionado);

  return { locale, messages: fusionado };
});
