"use client";

// Confirmación del retiro. Lo último que ve el creador antes de pedir su dinero.
//
// 🚨 AQUÍ NO SE DECIDE NINGÚN IMPORTE. El desglose que se enseña es el que calculó Finanzas
//    con `calcularRetiro`, y el que se cobra lo vuelve a calcular el SERVIDOR al recibir la
//    solicitud. Esta pantalla no manda cifras: llama a `requestWithdrawal()` sin argumentos.
//    Si mandara un importe, el creador podría escribir cuánto se le paga.
//
// Y no paga: crea una SOLICITUD que administración revisa. Decírselo aquí es lo que evita que
// se quede mirando su banco esa misma tarde.

import { useState } from "react";
import { Modal } from "@/components/ui";
import WithdrawBreakdown, { type DesgloseRetiro } from "./WithdrawBreakdown";
import { requestWithdrawal } from "@/lib/wallet/withdrawals";

type Props = {
  open: boolean;
  onClose: () => void;
  /** El desglose ya formateado. El mismo que enseña la pestaña de Retiros. */
  desglose: DesgloseRetiro;
  /**
   * 🗑️ Aquí vivía `ruta: "stripe" | "wallbit"`.
   *
   * Su único uso era la última frase de la leyenda que este panel enseñaba —«te llega en
   * dólares a tu cuenta de Wallbit» contra «te llega a la cuenta bancaria que
   * registraste»—. Al quitarse la leyenda el panel ya no promete nada distinto según la
   * ruta, así que la prop se va con ella en vez de quedarse sin leer.
   *
   * Si algún día vuelve un texto que dependa de por dónde cobra, `rutaDeCobro` sigue
   * resuelto en Finanzas y se le vuelve a pasar.
   */
  /** Ya tiene una solicitud esperando revisión. */
  yaSolicitado: boolean;
  onSolicitado: () => void;
};

export default function WithdrawConfirmPanel({
  open,
  onClose,
  desglose,
  yaSolicitado,
  onSolicitado,
}: Props) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function solicitar() {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await requestWithdrawal();
      onSolicitado();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!enviando) onClose();
      }}
      title="Retirar mi dinero"
      contentPadding="20px 20px calc(20px + var(--vb-safe-bottom, 0px))"
    >
      <div style={{ display: "grid", gap: 16 }}>
        {yaSolicitado ? (
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.55, margin: 0 }}>
            Ya tienes una solicitud de retiro en revisión. Te avisamos en cuanto se resuelva y
            entonces podrás pedir la siguiente.
          </p>
        ) : (
          <>
            <WithdrawBreakdown desglose={desglose} />

            {error && (
              <p style={{ fontSize: 12.5, color: "#f87171", lineHeight: 1.5, margin: 0 }}>{error}</p>
            )}

            {/* 💸 La misma caja que el botón de «Retirar» de Finanzas: degradado animado de
                la marca, 40 de alto, esquinas de 10, 260 de ancho máximo y centrado.

                Es el mismo gesto en dos pasos —pedir el dinero— y era un texto morado suelto
                del mismo peso visual que el «Ver desglose» que ahora tiene encima. Copiar la
                caja canónica y no inventar otra es lo que hace que el segundo paso se sienta
                la continuación del primero. Ver `.vbBrandFlowBtn` en globals.css. */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <button
                type="button"
                className="vbBrandFlowBtn"
                onClick={solicitar}
                disabled={enviando}
                style={{
                  flex: "1 1 140px",
                  maxWidth: 260,
                  minWidth: 120,
                  minHeight: 40,
                  borderRadius: 10,
                  border: "none",
                  /* El degradado lo pone `.vbBrandFlowBtn`, que además lo anima. Ponerlo
                     también aquí lo pisaría: un estilo inline gana a la clase. */
                  color: "#fff",
                  fontFamily: "inherit",
                  fontWeight: 600,
                  fontSize: 14,
                  letterSpacing: "-0.01em",
                  padding: "0 14px",
                  WebkitTapHighlightColor: "transparent",
                  transition: "opacity 150ms ease",
                  cursor: enviando ? "default" : "pointer",
                  opacity: enviando ? 0.55 : 1,
                }}
              >
                {enviando ? "Enviando tu solicitud…" : `Confirmar y recibir ${desglose.neto}`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
