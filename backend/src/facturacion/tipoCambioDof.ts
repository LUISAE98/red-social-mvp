// El tipo de cambio OFICIAL para convertir dólares a pesos en un CFDI.
//
// POR QUÉ HACE FALTA UNA FUENTE OFICIAL, Y NO LA QUE YA TENÍAMOS
//
// `config/exchangeRates` sale de una API pública gratuita y sirve para presentar precios. No
// sirve para un CFDI: el artículo 20 del CFF dice que las obligaciones en moneda extranjera se
// pagan al **tipo de cambio que publique el Banco de México**, y ninguna otra tasa es defendible
// ante el SAT.
//
// Durante §A0 se creyó que no haría falta, porque cada venta trae el tipo de cambio REAL de su
// cobro. Eso vale para la factura de venta —el comprador mexicano pagó pesos y ahí no hay nada
// que convertir— pero **no alcanza para los comprobantes mensuales**: la comisión de Vibra y la
// retención de ISR se aplican también a las ventas de EXPORTACIÓN, donde el comprador pagó en
// dólares y no existe ninguna operación en pesos de la que despejar una tasa.
//
// QUÉ SERIE Y POR QUÉ
//
// `SF43718` del SIE de Banxico: «Tipo de cambio para solventar obligaciones denominadas en
// moneda extranjera, fecha de determinación (FIX)». Es literalmente la que nombra el artículo 20.
//
// ⚠️ **FECHA DE DETERMINACIÓN, NO DE PUBLICACIÓN.** El FIX determinado un día se publica en el
// DOF al siguiente y rige para las obligaciones de ese siguiente. Así que para una operación del
// día D se usa el FIX del **día hábil anterior**. Se resuelve pidiendo un rango que termina en
// D-1 y quedándose con el último dato: la serie solo trae días hábiles, así que fines de semana
// y días festivos se saltan solos sin tener que llevar un calendario.
//
// 🚨 SE CONGELA AL CONSULTARLO. Cada tasa usada se guarda en `tiposDeCambioDof/{fecha}` y no se
//    vuelve a pedir. Un CFDI reexpedido dentro de dos años tiene que dar el mismo número, y una
//    llamada a una API externa no garantiza eso — ni que la API siga existiendo.

import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Token del SIE de Banxico. Gratuito, 40 000 consultas al día.
 *
 * Se saca en https://www.banxico.org.mx/SieAPIRest/service/v1/ y se guarda con
 * `firebase functions:secrets:set BANXICO_TOKEN`.
 */
export const banxicoToken = defineSecret("BANXICO_TOKEN");

/** «Tipo de cambio para solventar obligaciones en moneda extranjera», fecha de determinación. */
const SERIE_FIX = "SF43718";

/** Cuántos días atrás se busca el último hábil. Cubre un puente largo con margen. */
const DIAS_ATRAS = 10;

function fechaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type RespuestaSie = {
  bmx?: {
    series?: Array<{ datos?: Array<{ fecha: string; dato: string }> }>;
  };
};

/**
 * El FIX que rige para una operación de `fecha`, o sea el del último día hábil ANTERIOR.
 *
 * @param fecha `YYYY-MM-DD` de la operación.
 * @returns pesos por dólar, y de qué día es la tasa.
 *
 * Lanza si no se puede obtener. **Nunca devuelve una aproximación**: un CFDI con un tipo de
 * cambio inventado es peor que un CFDI que no sale.
 */
export async function fixParaOperacion(
  fecha: string
): Promise<{ tasa: number; fechaTasa: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error(`Fecha inválida para el tipo de cambio: ${fecha}`);
  }

  // Ya congelado: se devuelve tal cual, sin volver a preguntar.
  const ref = db.doc(`tiposDeCambioDof/${fecha}`);
  const guardado = await ref.get();
  if (guardado.exists) {
    const tasa = Number(guardado.get("tasa"));
    const fechaTasa = String(guardado.get("fechaTasa") ?? "");
    if (Number.isFinite(tasa) && tasa > 0 && fechaTasa) return { tasa, fechaTasa };
  }

  const token = banxicoToken.value();
  if (!token) {
    throw new Error(
      "Falta el token de Banxico (BANXICO_TOKEN). Sin él no hay tipo de cambio oficial y no se puede timbrar en dólares."
    );
  }

  const hasta = new Date(`${fecha}T00:00:00Z`);
  hasta.setUTCDate(hasta.getUTCDate() - 1); // el día hábil anterior, nunca el mismo
  const desde = new Date(hasta);
  desde.setUTCDate(desde.getUTCDate() - DIAS_ATRAS);

  const url =
    `https://www.banxico.org.mx/SieAPIRest/service/v1/series/${SERIE_FIX}` +
    `/datos/${fechaISO(desde)}/${fechaISO(hasta)}`;

  const res = await fetch(url, {
    headers: { "Bmx-Token": token, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Banxico respondió ${res.status} al pedir el tipo de cambio de ${fecha}`);
  }
  const json = (await res.json()) as RespuestaSie;
  const datos = json.bmx?.series?.[0]?.datos ?? [];
  if (datos.length === 0) {
    throw new Error(`Banxico no devolvió tipo de cambio para los días previos a ${fecha}`);
  }

  // El último de la serie es el día hábil más cercano anterior a la operación.
  const ultimo = datos[datos.length - 1];
  const tasa = Number(ultimo.dato);
  if (!Number.isFinite(tasa) || tasa <= 0) {
    throw new Error(`Banxico devolvió un tipo de cambio ilegible: ${ultimo.dato}`);
  }

  /**
   * La fecha de Banxico viene como `DD/MM/YYYY`. Se normaliza para poder compararla y para que
   * quede legible en el documento congelado.
   */
  const [d, m, a] = ultimo.fecha.split("/");
  const fechaTasa = `${a}-${m}-${d}`;

  await ref.set(
    {
      tasa,
      fechaTasa,
      serie: SERIE_FIX,
      fuente: "banxico-sie",
      congeladoEn: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  logger.info("tipo_cambio_dof", { fecha, tasa, fechaTasa });

  return { tasa, fechaTasa };
}
