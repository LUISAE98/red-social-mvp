/**
 * Cuánto dura la caché de cada cosa, en UN solo sitio.
 *
 * Antes cada lista declaraba su propio número —30 s aquí, 90 s allá, 3 min más
 * allá, 30 min en el inicio— y ninguno decía por qué. El resultado era que
 * volver a una pantalla recargaba entera en unas y no en otras, sin patrón
 * visible, y nadie recordaba qué valor tenía cada una.
 *
 * La duración NO se elige por lo cara que sea la consulta: se elige por
 * **quién puede cambiar el dato**. Ese es el único criterio que evita enseñar
 * algo falso.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ Un TTL corto NO es siempre un error.
 *
 * Lo que puede cambiar POR SU CUENTA —que un moderador apruebe tu solicitud,
 * que alguien te bloquee— tiene que caducar rápido: nadie va a avisar a esta
 * pestaña. Subir esos números no hace la app más rápida, la hace mentir. Por eso
 * `TERCEROS` existe y es corto a propósito.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MINUTO = 60 * 1000;

export const CACHE_TTL = {
  /**
   * Lo que cambia porque QUIEN MIRA hizo algo: su feed, sus guardados, las
   * publicaciones de un perfil o de una comunidad.
   *
   * Aguanta media hora porque no depende de que caduque para estar al día: los
   * cinco feeds están suscritos al bus de `lib/posts/post-feed-cache.ts`, así
   * que publicar, editar o borrar se propaga al instante a todas las listas
   * abiertas. Y siempre queda tirar de la pantalla para refrescar.
   *
   * Este es el número que hace que volver al inicio NO recargue.
   */
  CONTENIDO_PROPIO: 30 * MINUTO,

  /**
   * Listas que cambian despacio y por decisión de otros, pero sin consecuencia
   * si se ven un rato desactualizadas: resultados de búsqueda de comunidades,
   * recomendaciones, a quién sigues.
   *
   * Que una comunidad recién creada tarde unos minutos en salir en el buscador
   * no rompe nada. Que la lista entera se recargue cada vez que vuelves, sí
   * molesta.
   */
  CATALOGO: 10 * MINUTO,

  /**
   * 🚨 Estado que puede cambiar SIN que quien mira haga nada, y que si se enseña
   * viejo confunde de verdad: si eres miembro de una comunidad, si tu solicitud
   * sigue pendiente, si alguien te bloqueó.
   *
   * Un moderador aprueba tu solicitud desde su teléfono y esta pestaña no se
   * entera de nada. NO subir este número buscando velocidad: lo que se gana en
   * fluidez se paga enseñando "pendiente" a quien ya está dentro.
   */
  TERCEROS: MINUTO,
} as const;
