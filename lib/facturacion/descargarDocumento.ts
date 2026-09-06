// Bajar el PDF o el XML de un CFDI.
//
// 🚨 LOS PDF DE LOS CFDI LOS GENERA FACTURAPI, con el formato oficial del SAT. No se diseñan ni
//    se maquetan aquí: lo único que hacía falta era la puerta para que su dueño los bajara.
//
//    Los documentos que NO son CFDI —el comprobante de retiro, el mensual y el recibo del
//    comprador extranjero— no pasan por aquí: se ven en la vista imprimible, porque no existen
//    en ningún sitio más que en nuestra base de datos.
//
// ⚠️ La autorización la resuelve el BACKEND contra nuestros registros. Aquí solo se pide.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type TipoDocumento = "factura" | "notaCredito" | "comision" | "retenciones";

type Respuesta = { formato: string; mime: string; base64: string };

/**
 * Pide el documento y lo guarda en el disco del usuario.
 *
 * 🚨 Viene en base64 porque un callable no puede transmitir binario. Se reconstruye a bytes en el
 *    navegador; un `data:` URI directo se rompe con documentos grandes en algunos navegadores, y
 *    el nombre del archivo no se puede fijar.
 *
 * ⚠️ La URL del objeto **se revoca siempre**, incluso si algo falla al hacer clic. Sin eso, cada
 *    descarga deja el archivo entero retenido en memoria hasta que se recarga la página.
 */
export async function descargarDocumentoFiscal(params: {
  tipo: TipoDocumento;
  /** Id de NUESTRO registro, no de Facturapi. */
  referencia: string;
  /** Obligatorio para factura y nota de crédito. */
  buyerId?: string;
  formato?: "pdf" | "xml";
  /** Nombre con el que se guarda. Sin extensión: la pone el formato. */
  nombre?: string;
}): Promise<void> {
  const fn = httpsCallable<Record<string, unknown>, Respuesta>(
    functions,
    "descargarDocumentoFiscal"
  );
  const formato = params.formato ?? "pdf";
  const r = await fn({
    tipo: params.tipo,
    referencia: params.referencia,
    buyerId: params.buyerId,
    formato,
  });

  const bytes = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: r.data.mime }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${params.nombre ?? params.referencia}.${formato}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
