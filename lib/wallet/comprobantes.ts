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
  onSnapshot,
  orderBy,
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
