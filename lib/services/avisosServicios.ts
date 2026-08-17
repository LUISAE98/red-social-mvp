/**
 * Los avisos de la configuración de servicios.
 *
 * El panel de la comunidad y el del perfil configuran lo mismo —precios,
 * duraciones, donación— y cada uno tenía escrita su propia copia de estos
 * textos. Al ser dos copias empezaron a separarse: el mismo fallo decía
 * "❌ No se pudieron guardar los servicios." en un sitio y "No se pudieron
 * guardar los servicios del perfil." en el otro.
 *
 * Aquí vive el nombre de la clave, una sola vez. El texto sale del catálogo
 * `services`, traducido a los 47 idiomas.
 */

export const AVISOS_SERVICIOS = {
  precioSaludos: "priceInvalidGreetings",
  precioConsejos: "priceInvalidAdvice",
  precioMeetGreet: "priceInvalidMeetGreet",
  precioSesion: "priceInvalidSession",
  precioSuscripcion: "priceInvalidSubscription",

  duracionMeetGreet: "durationInvalidMeetGreet",
  duracionSesion: "durationInvalidSession",

  donacionMontoMinimo: "donationAmountFloor",
  donacionTextoBoda: "donationWeddingText",

  guardado: "configSaved",
  noGuardado: "configSaveError",

  /** Lleva {service}, {min} y {max}. */
  rangoMinutos: "minutesRange",
} as const;
