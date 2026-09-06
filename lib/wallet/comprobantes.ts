// Los comprobantes del creador: el de cada retiro y el mensual de liquidación.
//
// Son DOS documentos distintos y responden preguntas distintas. El de retiro dice que el dinero
// salió —cuándo, cuánto, a qué cuenta, a qué tipo de cambio—. El mensual dice qué ganó en el
// periodo y qué se le descontó. Un retiro junta ventas de varios meses, así que ninguno de los
// dos puede sustituir al otro.
//
// ⚠️ Los escribe SOLO el backend. Aquí únicamente se leen.

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  where,
  query,
  limit as fsLimit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type ComprobanteRetiroDoc = {
  id: string;
  currency: string;
  /** Lo que salió del saldo. */
  neto: number;
  /** Lo que le llegó en su moneda. `null` si el retiro aún no se concilió. */
  acreditado: number | null;
  monedaAcreditada: string | null;
  /** `null` cuando no hubo conversión. No es un 1.0, es que no hubo cambio de moneda. */
  tipoCambio: number | null;
  route: string | null;
  payoutCountry: string | null;
  cuentaLast4: string | null;
  referencia: string | null;
  pagadoEn: Date | null;
};

export type ComprobanteMensualDoc = {
  /** El periodo, `YYYY-MM`. Es el id del documento. */
  id: string;
  currency: string;
  ventas: number;
  base: number;
  participacion: number;
  comision: number;
  ivaComision: number;
  isrRetenido: number;
  ivaRetenido: number;
  neto: number;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOnulo(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function texto(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

function fecha(v: unknown): Date | null {
  const t = v as { toDate?: () => Date } | null | undefined;
  return typeof t?.toDate === "function" ? t.toDate() : null;
}

/**
 * Los comprobantes de retiro del creador, del más reciente al más viejo.
 *
 * 🚨 CON manejador de error, no es opcional. Una suscripción sin él se come el fallo en
 *    silencio, y el creador ve una lista vacía que no distingue de «todavía no tengo ninguno».
 *    Ya pasó con `suscribirMisRetiros` y costó encontrarlo.
 */
export function suscribirComprobantesRetiro(
  uid: string,
  cb: (rows: ComprobanteRetiroDoc[]) => void,
  onError?: (e: unknown) => void
): () => void {
  const q = query(
    collection(db, "users", uid, "comprobantesRetiro"),
    orderBy("pagadoEn", "desc"),
    fsLimit(50)
  );
  return onSnapshot(
    q,
    (snap) =>
      cb(
        snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            currency: String(x.currency ?? "USD"),
            neto: num(x.neto),
            acreditado: numOnulo(x.acreditado),
            monedaAcreditada: texto(x.monedaAcreditada),
            tipoCambio: numOnulo(x.tipoCambio),
            route: texto(x.route),
            payoutCountry: texto(x.payoutCountry),
            cuentaLast4: texto(x.cuentaLast4),
            referencia: texto(x.referencia),
            pagadoEn: fecha(x.pagadoEn),
          };
        })
      ),
    (e) => onError?.(e)
  );
}

/** Los comprobantes mensuales de liquidación, del periodo más reciente al más viejo. */
export function suscribirComprobantesMensuales(
  uid: string,
  cb: (rows: ComprobanteMensualDoc[]) => void,
  onError?: (e: unknown) => void
): () => void {
  const q = query(
    collection(db, "users", uid, "payoutStatements"),
    orderBy("periodo", "desc"),
    fsLimit(24)
  );
  return onSnapshot(
    q,
    (snap) =>
      cb(
        snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            currency: String(x.currency ?? "USD"),
            ventas: num(x.ventas),
            base: num(x.base),
            participacion: num(x.participacion),
            comision: num(x.comision),
            ivaComision: num(x.ivaComision),
            isrRetenido: num(x.isrRetenido),
            ivaRetenido: num(x.ivaRetenido),
            neto: num(x.neto),
          };
        })
      ),
    (e) => onError?.(e)
  );
}

/**
 * Un comprobante de retiro concreto, para la vista imprimible.
 *
 * Se lee de una vez en vez de reusar la suscripción de la lista: la vista de impresión no
 * necesita actualizarse en vivo, y un `onSnapshot` abierto mientras el navegador imprime es
 * pedir que el documento cambie a media hoja.
 */
export async function leerComprobanteRetiro(
  uid: string,
  id: string
): Promise<ComprobanteRetiroDoc | null> {
  const snap = await getDoc(doc(db, "users", uid, "comprobantesRetiro", id));
  if (!snap.exists()) return null;
  const x = snap.data() as Record<string, unknown>;
  return {
    id: snap.id,
    currency: String(x.currency ?? "USD"),
    neto: num(x.neto),
    acreditado: numOnulo(x.acreditado),
    monedaAcreditada: texto(x.monedaAcreditada),
    tipoCambio: numOnulo(x.tipoCambio),
    route: texto(x.route),
    payoutCountry: texto(x.payoutCountry),
    cuentaLast4: texto(x.cuentaLast4),
    referencia: texto(x.referencia),
    pagadoEn: fecha(x.pagadoEn),
  };
}

/** Un comprobante mensual concreto. El id es el periodo, `YYYY-MM`. */
export async function leerComprobanteMensual(
  uid: string,
  periodo: string
): Promise<ComprobanteMensualDoc | null> {
  const snap = await getDoc(doc(db, "users", uid, "payoutStatements", periodo));
  if (!snap.exists()) return null;
  const x = snap.data() as Record<string, unknown>;
  return {
    id: snap.id,
    currency: String(x.currency ?? "USD"),
    ventas: num(x.ventas),
    base: num(x.base),
    participacion: num(x.participacion),
    comision: num(x.comision),
    ivaComision: num(x.ivaComision),
    isrRetenido: num(x.isrRetenido),
    ivaRetenido: num(x.ivaRetenido),
    neto: num(x.neto),
  };
}

/**
 * Recibo del comprador EXTRANJERO.
 *
 * ⚠️ Vive en el árbol del COMPRADOR, no del creador, aunque comparta este archivo: es el mismo
 * tipo de documento —constancia de un pago, sin valor fiscal mexicano— y separarlo en otro
 * módulo solo por a quién pertenece duplicaría los mismos ayudantes.
 */
export type ReciboDoc = {
  id: string;
  creatorId: string;
  type: string;
  buyerCountry: string;
  /** Lo que vio y pagó, en su moneda. */
  pagado: number | null;
  monedaPagada: string | null;
  total: number;
  currency: string;
  base: number;
  impuesto: number;
  fecha: Date | null;
};

function aRecibo(id: string, x: Record<string, unknown>): ReciboDoc {
  return {
    id,
    creatorId: String(x.creatorId ?? ""),
    type: String(x.type ?? ""),
    buyerCountry: String(x.buyerCountry ?? ""),
    pagado: numOnulo(x.pagado),
    monedaPagada: texto(x.monedaPagada),
    total: num(x.total),
    currency: String(x.currency ?? "USD"),
    base: num(x.base),
    impuesto: num(x.impuesto),
    fecha: fecha(x.fecha),
  };
}

/** Los recibos del comprador, del más reciente al más viejo. */
export function suscribirRecibos(
  uid: string,
  cb: (rows: ReciboDoc[]) => void,
  onError?: (e: unknown) => void
): () => void {
  const q = query(collection(db, "users", uid, "recibos"), orderBy("fecha", "desc"), fsLimit(50));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => aRecibo(d.id, d.data() as Record<string, unknown>))),
    (e) => onError?.(e)
  );
}

/** Un recibo concreto, para la vista imprimible. */
export async function leerRecibo(uid: string, id: string): Promise<ReciboDoc | null> {
  const snap = await getDoc(doc(db, "users", uid, "recibos", id));
  if (!snap.exists()) return null;
  return aRecibo(snap.id, snap.data() as Record<string, unknown>);
}

/**
 * Los CFDI mensuales del creador: su factura global, la comisión que Vibra le cobra y su
 * constancia de retenciones.
 *
 * 🚨 Hasta el 2026-09-06 el creador NO PODÍA VER NINGUNO. Estaban en `creatorMonthlyDocs`, sin
 *    regla de lectura y sin pantalla — justo los tres papeles que su contador le pide.
 *
 * ⚠️ La consulta TIENE que fijar `creatorId` con `==`. La regla identifica al dueño por un CAMPO,
 *    no por la ruta, y `allow list` en Firestore solo ve los campos fijados con igualdad: sin ese
 *    filtro se deniega la consulta entera, no solo los documentos ajenos.
 */
export type CfdiMensualDoc = {
  id: string;
  tipo: "global" | "comision" | "retenciones" | "liquidacion";
  periodo: string;
  /** `null` si el mes se calculó con el timbrado apagado. Sin folio no hay PDF que bajar. */
  facturapiId: string | null;
  uuid: string | null;
  timbrado: boolean;
  /**
   * 🧾 Cuántas veces se reexpidió, y por qué.
   *
   * Solo la global. Cambia de folio cada vez que un comprador pide su factura de una venta que
   * ya estaba dentro. Es normal y el creador no tiene que hacer nada — pero un CFDI que cambia
   * solo, sin explicación, asusta.
   */
  reexpedida: { veces: number; causa: string | null } | null;
};

export function suscribirCfdiMensuales(
  uid: string,
  cb: (rows: CfdiMensualDoc[]) => void,
  onError?: (e: unknown) => void
): () => void {
  const q = query(
    collection(db, "creatorMonthlyDocs"),
    where("creatorId", "==", uid),
    orderBy("createdAt", "desc"),
    fsLimit(60)
  );
  return onSnapshot(
    q,
    (snap) =>
      cb(
        snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            tipo: (texto(x.tipo) ?? "comision") as CfdiMensualDoc["tipo"],
            periodo: texto(x.periodo) ?? "",
            facturapiId: texto(x.facturapiId),
            uuid: texto(x.uuid),
            timbrado: x.timbrado === true,
            reexpedida: (() => {
              const r = x.reexpedida as { veces?: unknown; causa?: unknown } | undefined;
              const veces = Number(r?.veces);
              return Number.isFinite(veces) && veces > 0
                ? { veces, causa: texto(r?.causa) }
                : null;
            })(),
          };
        })
      ),
    (e) => onError?.(e)
  );
}
