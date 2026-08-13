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

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale;
  }

  const messages = (await import(`../messages/${locale}.json`)).default as MessageTree;
  if (locale === routing.defaultLocale) return { locale, messages };

  const fallback = (await import(`../messages/${routing.defaultLocale}.json`))
    .default as MessageTree;
  return { locale, messages: mergeDeep(fallback, messages) };
});
