/**
 * Comparar texto para buscar, sin perder de vista el original.
 *
 * El problema que resuelve: para que "jose" encuentre a "José" hay que comparar
 * sin tildes y en minúsculas, pero para PINTAR el trozo encontrado en negritas
 * hace falta recortar el texto ORIGINAL, con sus tildes y mayúsculas. Y los
 * índices de una cadena no sobreviven a `normalize("NFD")`, que parte una "é"
 * en dos caracteres y descoloca todo lo que viene detrás.
 *
 * Por eso el plegado se hace carácter a carácter, guardando de qué posición del
 * original salió cada carácter del texto plano. Así se busca en el plano y se
 * recorta en el original.
 */

/** Texto comparable: minúsculas y sin tildes. Para cotejos sin resaltado. */
export function comparable(texto: string): string {
  return texto
    .normalize("NFD")
    // El rango son los acentos que `NFD` deja sueltos detrás de cada letra.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

type Plegado = {
  /** El texto ya comparable. */
  plano: string;
  /**
   * Por cada posición de `plano`, de qué posición del original vino. Tiene un
   * elemento de más al final —la longitud del original— para poder marcar el
   * final de la última coincidencia sin casos especiales.
   */
  indices: number[];
};

function plegar(texto: string): Plegado {
  let plano = "";
  const indices: number[] = [];

  for (let i = 0; i < texto.length; i++) {
    const trozo = comparable(texto[i]);
    // Una letra puede plegarse a varias (o a ninguna, si era solo un acento).
    for (let k = 0; k < trozo.length; k++) {
      plano += trozo[k];
      indices.push(i);
    }
  }
  indices.push(texto.length);

  return { plano, indices };
}

export type Trozo = { texto: string; resaltado: boolean };

/**
 * Parte el texto en trozos, marcando los que casan con la búsqueda.
 *
 * Devuelve el texto ORIGINAL repartido en tramos, no una cadena con etiquetas
 * dentro: así lo pinta React sin `dangerouslySetInnerHTML`, y un mensaje que
 * contenga algo parecido a HTML no puede colarse como marcado.
 */
export function resaltar(texto: string, aguja: string): Trozo[] {
  const buscada = comparable(aguja.trim());
  if (!buscada) return [{ texto, resaltado: false }];

  const { plano, indices } = plegar(texto);
  const trozos: Trozo[] = [];

  let cursorPlano = 0;
  let cursorOriginal = 0;

  while (cursorPlano <= plano.length - buscada.length) {
    const encontrado = plano.indexOf(buscada, cursorPlano);
    if (encontrado === -1) break;

    const desde = indices[encontrado];
    const hasta = indices[encontrado + buscada.length];

    if (desde > cursorOriginal) {
      trozos.push({ texto: texto.slice(cursorOriginal, desde), resaltado: false });
    }
    trozos.push({ texto: texto.slice(desde, hasta), resaltado: true });

    cursorOriginal = hasta;
    cursorPlano = encontrado + buscada.length;
  }

  if (cursorOriginal < texto.length) {
    trozos.push({ texto: texto.slice(cursorOriginal), resaltado: false });
  }

  return trozos;
}

/**
 * Recorta alrededor de la primera coincidencia, para que el resultado se lea
 * aunque el mensaje sea larguísimo.
 *
 * Sin esto, buscar una palabra que está en el carácter 400 de un mensaje daba
 * una fila con los primeros 80 caracteres y ni rastro de lo buscado.
 */
export function recortarAlrededor(
  texto: string,
  aguja: string,
  margen = 34
): { texto: string; cortadoAlInicio: boolean } {
  const buscada = comparable(aguja.trim());
  if (!buscada) return { texto, cortadoAlInicio: false };

  const { plano, indices } = plegar(texto);
  const encontrado = plano.indexOf(buscada);
  if (encontrado === -1) return { texto, cortadoAlInicio: false };

  const desde = indices[encontrado];
  if (desde <= margen) return { texto, cortadoAlInicio: false };

  // Se corta en el espacio anterior, para no partir una palabra por la mitad.
  const bruto = Math.max(0, desde - margen);
  const espacio = texto.indexOf(" ", bruto);
  const corte = espacio !== -1 && espacio < desde ? espacio + 1 : bruto;

  return { texto: texto.slice(corte), cortadoAlInicio: true };
}
