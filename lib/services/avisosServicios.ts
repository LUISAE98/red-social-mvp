/**
 * Los avisos de la configuración de servicios.
 *
 * El panel de la comunidad y el del perfil configuran lo mismo —precios,
 * duraciones, donación— y cada uno tenía escrita su propia copia de estos
 * textos. Al ser dos copias empezaron a separarse: el mismo fallo decía
 * "❌ No se pudieron guardar los servicios." en un sitio y "No se pudieron
 * guardar los servicios del perfil." en el otro.
 *
 * Aquí viven una sola vez. Siguen sin traducir, que es harina de otro costal.
 */

export const AVISOS_SERVICIOS = {
  precioSaludos: "Precio inválido para saludos.",
  precioConsejos: "Precio inválido para consejos.",
  precioMeetGreet: "Precio inválido para Tiempo contigo.",
  precioSesion: "Precio inválido para sesión exclusiva.",
  precioSuscripcion: "Precio inválido para la suscripción mensual.",

  duracionMeetGreet: "Debes definir una duración válida en minutos para Tiempo contigo.",
  duracionSesion: "Debes definir una duración válida en minutos para la sesión exclusiva.",

  donacionMontoMinimo: "Cada monto sugerido de la donación debe ser al menos 50.",
  donacionTextoBoda: "Debes escribir el texto visible para la donación de boda.",

  guardado: "Configuración guardada.",
  noGuardado: "No se pudieron guardar los servicios.",
} as const;

/** El rango permitido de minutos, que cambia según el servicio. */
export function avisoRangoMinutos(servicio: string, min: number, max: number) {
  return `${servicio} solo permite entre ${min} y ${max} minutos.`;
}
