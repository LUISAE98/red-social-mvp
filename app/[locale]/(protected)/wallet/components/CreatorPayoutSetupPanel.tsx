"use client";

// Alta de cobro del creador: lo que tiene que completar antes de poder retirar.
//
// Se abre desde el aviso morado de Finanzas y bifurca por RESIDENCIA FISCAL, porque los dos
// caminos no piden lo mismo:
//
//   · Creador MEXICANO   → identidad + sello digital. Los DOS con palomita verde o no retira.
//     Sin sello, Vibra no puede emitir sus facturas de venta, y dejarlo cobrar sería dejarlo
//     vender sin poder facturar.
//   · Creador EXTRANJERO → solo identidad. No emite CFDI, así que no hay sello que pedirle.
//
// Por eso lo primero es preguntar dónde tributa: sin ese dato no se sabe qué pedirle. Se
// pregunta, no se infiere por IP — la IP dice dónde está hoy, no dónde declara.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import {
  useCreatorTaxProfile,
  setCreatorResidency,
  type CreatorResidency,
} from "@/lib/facturacion/creatorFiscal";
import { IconButton, TextButton } from "@/components/ui";

const DIVIDER = "1px solid rgba(255,255,255,0.08)";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Abre el panel fiscal existente, donde el creador sube su sello. */
  onOpenSello: () => void;
};

/** Estado visual de cada paso. */
type EstadoPaso = "listo" | "pendiente" | "bloqueado";

export default function CreatorPayoutSetupPanel({ open, onClose, onOpenSello }: Props) {
  const t = useTranslations("wallet");
  const { user } = useAuth();
  const { residency, csdReady, identityReady, loading } = useCreatorTaxProfile(user?.uid);

  // Desmontado diferido para animar la salida (vibra_style.md).
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  useBodyScrollLock(rendered);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (!rendered) return;
    setClosing(true);
    const t = setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, 180);
    return () => clearTimeout(t);
  }, [open, rendered]);

  async function elegirResidencia(valor: CreatorResidency) {
    setGuardando(true);
    setError(null);
    try {
      await setCreatorResidency(valor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }

  if (!rendered || typeof document === "undefined") return null;

  const esMexicano = residency === "MX";
  const pasoIdentidad: EstadoPaso = identityReady ? "listo" : "pendiente";
  const pasoSello: EstadoPaso = csdReady ? "listo" : "pendiente";

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !guardando) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(0,0,0,0.88)",
        animation: closing
          ? "vbPayoutSetupBackdropOut 180ms ease-in forwards"
          : "vbPayoutSetupBackdropIn 180ms ease-out",
      }}
    >
      <style>{`
        @keyframes vbPayoutSetupIn{from{opacity:0;transform:scale(0.94) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes vbPayoutSetupOut{from{opacity:1;transform:scale(1) translateY(0)}to{opacity:0;transform:scale(0.94) translateY(10px)}}
        @keyframes vbPayoutSetupBackdropIn{from{background:rgba(0,0,0,0)}to{background:rgba(0,0,0,0.88)}}
        @keyframes vbPayoutSetupBackdropOut{from{background:rgba(0,0,0,0.88)}to{background:rgba(0,0,0,0)}}
      `}</style>

      <section
        style={{
          width: "min(100%, 520px)",
          maxHeight: "min(88vh, 660px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: 18,
          background: "#0a0a0a",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
          color: "#fff",
          overflow: "hidden",
          animation: closing
            ? "vbPayoutSetupOut 180ms ease-in forwards"
            : "vbPayoutSetupIn 180ms ease-out",
        }}
      >
        <div
          style={{
            height: 56,
            display: "grid",
            gridTemplateColumns: "48px 1fr 48px",
            alignItems: "center",
            padding: "0 12px",
            borderBottom: DIVIDER,
            flexShrink: 0,
          }}
        >
          <div aria-hidden="true" />
          <span
            style={{
              fontSize: 17,
              fontWeight: 500,
              textAlign: "center",
              letterSpacing: "-0.02em",
            }}
          >
            {t("payoutSetupTitle")}
          </span>
          <IconButton
            label={t("payoutSetupClose")}
            size="sm"
            tone="bare"
            shape="square"
            style={{ placeItems: "center", justifySelf: "end" }}
            onClick={() => {
              if (!guardando) onClose();
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </IconButton>
        </div>

        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "20px" }}>
          {loading ? (
            <div style={{ display: "grid", gap: 10 }}>
              <Esqueleto alto={64} />
              <Esqueleto alto={64} />
            </div>
          ) : residency == null ? (
            /* Sin residencia declarada no se sabe qué pedirle. Es la primera pregunta. */
            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 6 }}>
                  {t("payoutSetupResidencyTitle")}
                </div>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.55, margin: 0 }}>
                  {t("payoutSetupResidencyHint")}
                </p>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <OpcionResidencia
                  label={t("payoutSetupResidencyMx")}
                  hint={t("payoutSetupResidencyMxHint")}
                  disabled={guardando}
                  onClick={() => elegirResidencia("MX")}
                />
                <OpcionResidencia
                  label={t("payoutSetupResidencyForeign")}
                  hint={t("payoutSetupResidencyForeignHint")}
                  disabled={guardando}
                  onClick={() => elegirResidencia("FOREIGN")}
                />
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.55, margin: 0 }}>
                {esMexicano ? t("payoutSetupIntroMx") : t("payoutSetupIntroForeign")}
              </p>

              <Paso
                numero={1}
                estado={pasoIdentidad}
                titulo={t("payoutSetupStepIdentity")}
                descripcion={
                  esMexicano
                    ? t("payoutSetupStepIdentityHint")
                    : t("payoutSetupStepIdentityHintForeign")
                }
                accion={t("payoutSetupStepIdentityCta")}
                /* 🚧 SIN CONECTAR: el alta de cuenta de Stripe todavía no existe. */
                onAccion={undefined}
              />

              {esMexicano && (
                <Paso
                  numero={2}
                  estado={pasoSello}
                  titulo={t("payoutSetupStepSeal")}
                  descripcion={t("payoutSetupStepSealHint")}
                  accion={csdReady ? t("payoutSetupStepSealReplace") : t("payoutSetupStepSealCta")}
                  onAccion={() => {
                    onClose();
                    onOpenSello();
                  }}
                />
              )}

              <div
                style={{
                  marginTop: 4,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.05)",
                  border: DIVIDER,
                  fontSize: 12.5,
                  color: "rgba(255,255,255,0.7)",
                  lineHeight: 1.55,
                }}
              >
                {esMexicano ? t("payoutSetupGateMx") : t("payoutSetupGateForeign")}
              </div>
            </div>
          )}

          {error && (
            <p style={{ fontSize: 12.5, color: "#f87171", marginTop: 14, marginBottom: 0 }}>{error}</p>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

function Esqueleto({ alto }: { alto: number }) {
  return (
    <div
      style={{
        height: alto,
        borderRadius: 12,
        background: "rgba(255,255,255,0.06)",
      }}
    />
  );
}

function OpcionResidencia({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: "start",
        border: DIVIDER,
        borderRadius: 12,
        background: "rgba(255,255,255,0.05)",
        color: "#fff",
        padding: "13px 15px",
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
        display: "grid",
        gap: 3,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{ fontSize: 14.5, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>{hint}</span>
    </button>
  );
}

function Paso({
  numero,
  estado,
  titulo,
  descripcion,
  accion,
  onAccion,
}: {
  numero: number;
  estado: EstadoPaso;
  titulo: string;
  descripcion: string;
  accion: string;
  onAccion?: () => void;
}) {
  const listo = estado === "listo";
  return (
    <div
      style={{
        border: listo ? "1px solid rgba(34,197,94,0.35)" : DIVIDER,
        background: listo ? "rgba(34,197,94,0.07)" : "rgba(255,255,255,0.04)",
        borderRadius: 14,
        padding: "14px 16px",
        display: "grid",
        gridTemplateColumns: "26px minmax(0, 1fr)",
        gap: "0 12px",
        alignItems: "start",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: listo ? "#16a34a" : "rgba(255,255,255,0.1)",
          color: listo ? "#fff" : "rgba(255,255,255,0.65)",
          fontSize: 12.5,
          fontWeight: 700,
          marginTop: 1,
        }}
      >
        {listo ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          numero
        )}
      </div>

      <div style={{ display: "grid", gap: 5, minWidth: 0 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>{titulo}</span>
        <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.62)", lineHeight: 1.5 }}>
          {descripcion}
        </span>
        {!listo && (
          <TextButton
            tone="brand"
            size="sm"
            style={{ margin: "3px 0 0", justifySelf: "start", fontFamily: "inherit" }}
            onClick={onAccion}
            disabled={!onAccion}
          >
            {accion}
          </TextButton>
        )}
      </div>
    </div>
  );
}
