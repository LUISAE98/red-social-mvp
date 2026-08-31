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
import { Modal, TextButton } from "@/components/ui";
import WithdrawBreakdown, { type DesgloseRetiro } from "./WithdrawBreakdown";
import { requestWithdrawal } from "@/lib/wallet/withdrawals";

type Props = {
  open: boolean;
  onClose: () => void;
  /** El desglose ya formateado. El mismo que enseña la pestaña de Retiros. */
  desglose: DesgloseRetiro;
  /** Por dónde le va a llegar. Cambia lo que se le promete. */
  ruta: "stripe" | "wallbit";
  /** Ya tiene una solicitud esperando revisión. */
  yaSolicitado: boolean;
  onSolicitado: () => void;
};

export default function WithdrawConfirmPanel({
  open,
  onClose,
  desglose,
  ruta,
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

            {/* Lo que pasa DESPUÉS de pulsar. Sin esto el creador espera el dinero hoy. */}
            <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.55, margin: 0 }}>
              Al confirmar, tu solicitud pasa a revisión y este dinero se aparta de tu saldo.
              Si la rechazamos te lo devolvemos completo y te decimos por qué.
              {ruta === "wallbit"
                ? " Cuando se apruebe, te llega en dólares a tu cuenta de Wallbit."
                : " Cuando se apruebe, te llega a la cuenta bancaria que registraste."}
            </p>

            {error && (
              <p style={{ fontSize: 12.5, color: "#f87171", lineHeight: 1.5, margin: 0 }}>{error}</p>
            )}

            <TextButton
              tone="brand"
              size="md"
              style={{ margin: 0, justifySelf: "start", fontFamily: "inherit" }}
              onClick={solicitar}
              disabled={enviando}
            >
              {enviando ? "Enviando tu solicitud…" : `Confirmar y recibir ${desglose.neto}`}
            </TextButton>
          </>
        )}
      </div>
    </Modal>
  );
}
