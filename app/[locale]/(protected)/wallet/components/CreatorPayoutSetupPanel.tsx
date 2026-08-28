"use client";

// Alta de cobro del creador: lo que tiene que completar antes de poder retirar.
//
// Se abre desde el aviso morado de Finanzas y enseña DOS pasos, que son de todos:
//
//   1. Verificación de identidad (Didit)
//   2. Registro de cuenta de cobro (Stripe Global Payouts)
//
// Y aparece un TERCERO —datos fiscales y sello— solo cuando alguno de los dos detecta que el
// creador es de México.
//
// ⚠️ **YA NO SE PREGUNTA LA RESIDENCIA (2026-08-27).** Antes lo primero era «¿dónde declaras
// impuestos?», y sobraba: una respuesta se puede equivocar, un pasaporte no. El país sale del
// documento del KYC y del país de la cuenta bancaria, que son datos duros. Ver `esMexicano`
// en `useCreatorTaxProfile`.
//
// El tercer paso son dos cosas por dentro —datos fiscales primero, sello después— porque el
// proveedor valida el sello contra el RFC declarado y lo rechaza si no está antes.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useCreatorTaxProfile } from "@/lib/facturacion/creatorFiscal";
import {
  createPayoutAccountLink,
  refreshPayoutAccountStatus,
  createPayoutAccountQuestionnaire,
} from "@/lib/wallet/payoutAccount";
import { IconButton, TextButton } from "@/components/ui";

const DIVIDER = "1px solid rgba(255,255,255,0.08)";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Abre el panel fiscal existente, donde el creador sube su sello. */
  onOpenSello: () => void;
  /** Lanza la verificación de identidad en Didit. */
  onIniciarKyc: () => void;
  /** Deshabilita el paso de identidad: ya en curso, o en revisión manual. */
  kycBloqueado?: boolean;
  /**
   * El creador acaba de volver del formulario de Stripe.
   *
   * Cuando llega en `true` se relee la cuenta nada más abrir, porque Stripe avisa por
   * webhook pero son «thin events» que todavía no se procesan, y sin releer el paso se
   * quedaría en amarillo con la cuenta ya dada de alta.
   */
  volviendoDeStripe?: boolean;
};

/** Estado visual de cada paso. */
type EstadoPaso = "listo" | "pendiente" | "bloqueado";

export default function CreatorPayoutSetupPanel({
  open,
  onClose,
  onOpenSello,
  onIniciarKyc,
  kycBloqueado,
  volviendoDeStripe,
}: Props) {
  const t = useTranslations("wallet");
  const { user } = useAuth();
  const {
    esMexicano,
    csdReady,
    csdVencido,
    cobraFueraDeMexico,
    identityReady,
    payoutAccountReady,
    stripeAccountStatus,
    /**
     * 💰 Su comisión y su mínimo reales. `null` mientras no hay cuenta de cobro.
     *
     * Solo se le enseñan cuando ya son SUYOS. Antes de dar de alta la cuenta no se sabe a
     * qué país va a cobrar, y adelantar un 25% que luego resulte 30% es peor que callar.
     */
    payoutTerms,
    payoutCountryUnpayable,
    /** Por dónde cobra. Decide si el paso 2 es el alta de Stripe o los datos de Wallbit. */
    payoutRoute,
    /** ¿Ya declaró su cuenta en el cuestionario de Didit? */
    payoutAccountDeclared: cuentaDeclarada,
    /** Declaró una y en Stripe metió otra. Hay que resolverlo antes de cobrar. */
    declaredAccountMismatch: cuentaNoCoincide,
    loading,
  } = useCreatorTaxProfile(user?.uid);

  // Desmontado diferido para animar la salida (vibra_style.md).
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  useBodyScrollLock(rendered);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refrescando, setRefrescando] = useState(false);

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

  // Al volver del formulario, releer la cuenta una vez.
  useEffect(() => {
    if (!open || !volviendoDeStripe || !user?.uid) return;
    let vivo = true;
    let terminado = false;

    // El «Abriendo…» se pinta en el fotograma siguiente, no en el cuerpo del efecto, para
    // no encadenar un render de más. Y si la lectura ya volvió para entonces, no se pinta:
    // un parpadeo de estado que nace ya caducado es peor que no verlo.
    const raf = requestAnimationFrame(() => {
      if (vivo && !terminado) setRefrescando(true);
    });

    refreshPayoutAccountStatus()
      // El estado se pinta desde Firestore, que el hook ya escucha en vivo. Aquí solo se
      // provoca la relectura, por eso no se hace nada con el resultado.
      .catch(() => {})
      .finally(() => {
        terminado = true;
        if (vivo) setRefrescando(false);
      });

    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
    };
  }, [open, volviendoDeStripe, user?.uid]);

  /**
   * Abre el formulario alojado de Stripe donde el creador mete su cuenta bancaria.
   *
   * El enlace se pide al pulsar, no antes: caduca a los 10 minutos y solo sirve una vez, así
   * que uno generado al abrir el panel llegaría muerto.
   */
  /**
   * Abre el cuestionario donde declara su cuenta.
   *
   * Para el creador de Wallbit ES su registro de cobro. Para el de Stripe es la declaración
   * de titularidad, que se compara luego contra lo que Stripe reporte.
   */
  async function abrirCuestionarioDeCuenta() {
    setGuardando(true);
    setError(null);
    try {
      const { url } = await createPayoutAccountQuestionnaire();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGuardando(false);
    }
  }

  async function abrirAltaDeCobro() {
    setGuardando(true);
    setError(null);
    try {
      const { url } = await createPayoutAccountLink();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGuardando(false);
    }
  }

  if (!rendered || typeof document === "undefined") return null;

  /**
   * ¿Cobra por Wallbit?
   *
   * Sus 12 países no tienen ruta de Stripe, o solo tienen wire a 25 USD por envío. A ese
   * creador NO se le pide alta de Stripe: no le serviría de nada y sería mandarlo a un
   * formulario que va a rechazar su país.
   */
  const porWallbit = payoutRoute === "wallbit";

  const pasoIdentidad: EstadoPaso = identityReady ? "listo" : "pendiente";
  const pasoCobro: EstadoPaso = payoutAccountReady ? "listo" : "pendiente";
  const pasoSello: EstadoPaso = csdReady ? "listo" : "pendiente";

  // Dado de alta pero sin capacidad activa todavía: Stripe lo está revisando.
  const cobroEnRevision = stripeAccountStatus === "pending";
  const cobroRestringido = stripeAccountStatus === "restricted";

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
              <Esqueleto alto={64} />
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.55, margin: 0 }}>
                {esMexicano ? t("payoutSetupIntroMx") : t("payoutSetupIntroForeign")}
              </p>

              {/* 1. IDENTIDAD — el KYC de Didit. Es de todos, mexicanos y extranjeros, y va
                  primero: sin saber quién es alguien no tiene sentido pedirle datos fiscales
                  ni de cobro.

                  Además es una de las dos señales que deciden si aparece el tercer paso, el
                  país del DOCUMENTO con el que se verificó. Ver `esMexicano` en
                  `useCreatorTaxProfile`. */}
              <Paso
                numero={1}
                estado={pasoIdentidad}
                titulo={t("payoutSetupStepIdentity")}
                descripcion={t("payoutSetupStepIdentityHint")}
                accion={t("payoutSetupStepIdentityCta")}
                onAccion={
                  pasoIdentidad === "listo" || kycBloqueado
                    ? undefined
                    : () => {
                        onClose();
                        onIniciarKyc();
                      }
                }
              />

              {/* 2. CUENTA DE COBRO — dos caminos según su país.

                  **Stripe Global Payouts** para los 77 países donde llega. El creador sale a
                  un formulario alojado por Stripe y vuelve a Finanzas con `?alta=ok`. Los
                  datos bancarios NUNCA pasan por aquí, y de ahí sale el PAÍS DE LA CUENTA,
                  que es dato fiscal por partida doble: a un creador mexicano, cobrar fuera de
                  México le sube la retención de IVA del 50% al 100%
                  (`fiscal-iva-isr-plataforma.md` §0.6), y además decide su comisión y su
                  mínimo (`docs/payout-tiers.md`).

                  **Wallbit** para los 12 donde Stripe no llega o solo llega por wire. Ahí no
                  hay alta de Stripe que hacer —mandarlo a ese formulario sería mandarlo a que
                  le rechacen el país—, así que su cuestionario ES su registro de cobro. */}
              <Paso
                numero={2}
                estado={cuentaDeclarada ? "listo" : "pendiente"}
                titulo={t(porWallbit ? "payoutSetupStepWallbit" : "payoutSetupStepDeclare")}
                descripcion={t(
                  porWallbit ? "payoutSetupStepWallbitHint" : "payoutSetupStepDeclareHint"
                )}
                accion={
                  guardando
                    ? t("payoutSetupStepPayoutOpening")
                    : t(porWallbit ? "payoutSetupStepWallbitCta" : "payoutSetupStepDeclareCta")
                }
                onAccion={guardando ? undefined : abrirCuestionarioDeCuenta}
              />

              {/* 3. REGISTRAR LA CUENTA EN STRIPE — solo la ruta de Stripe.

                  Va DESPUÉS de declararla, y el orden importa: si declarase al final se
                  limitaría a copiar lo que acaba de escribir y la declaración no probaría
                  nada. Declarando antes se compromete sin saber todavía si va a cuadrar, y
                  ahí la comparación empieza a significar algo.

                  Se enseña bloqueado hasta que declare, para que el orden se entienda solo. */}
              {!porWallbit && (
                <Paso
                  numero={3}
                  estado={pasoCobro}
                  titulo={t("payoutSetupStepPayout")}
                  descripcion={
                    cobroEnRevision
                      ? t("payoutSetupStepPayoutReviewing")
                      : t("payoutSetupStepPayoutHint")
                  }
                  accion={
                    guardando || refrescando
                      ? t("payoutSetupStepPayoutOpening")
                      : cobroEnRevision || cobroRestringido
                        ? t("payoutSetupStepPayoutResume")
                        : t("payoutSetupStepPayoutCta")
                  }
                  onAccion={
                    // Sin declarar antes, no se abre: es lo que impone el orden.
                    !cuentaDeclarada || guardando || refrescando ? undefined : abrirAltaDeCobro
                  }
                />
              )}

              {!porWallbit && cobroRestringido && (
                <Aviso tono="alerta" texto={t("payoutSetupPayoutRestricted")} />
              )}

              {/* 🔴 Declaró una cuenta y en Stripe metió otra.

                  Puede ser un error de tecleo o algo peor. En cualquier caso el creador tiene
                  que resolverlo antes de cobrar, y alguien de Vibra ya lo tiene en los logs. */}
              {cuentaNoCoincide && (
                <Aviso tono="alerta" texto={t("payoutSetupAccountMismatch")} />
              )}

              {/* ⚠️ Cobra en dólares pero no puede pasarlos a su banco.

                  Chile, Uruguay, Paraguay y Honduras. Su única salida documentada es cripto,
                  y eso hay que decírselo AQUÍ, antes de que acumule, no el día que quiera
                  sacar el dinero. Se entra igual porque la alternativa era no pagarles. */}
              {payoutTerms?.soloDolares && (
                <Aviso tono="aviso" texto={t("payoutSetupWallbitUsdOnly")} />
              )}

              {/* 🔴 Su país vende pero no cobra.

                  Se le dice aquí, en el alta, y no el día que pulse retirar: tiene derecho a
                  decidir si le compensa seguir acumulando, y esa decisión no se toma cuando
                  ya lo hizo. */}
              {payoutCountryUnpayable && (
                <Aviso tono="alerta" texto={t("payoutNoRouteWarning")} />
              )}

              {/* 💰 Su comisión y su mínimo, con el MOTIVO.

                  Al del grupo caro hay que explicarle por qué le toca 30% y 500, o lo lee
                  como un castigo arbitrario. No lo es: la transferencia a su país cuesta 25
                  USD por envío frente a 1.50 en los demás, y a 300 se le comería el 8%.

                  Solo aparece cuando ya tiene cuenta: antes no se sabe su país. */}
              {payoutTerms && (
                <div
                  style={{
                    padding: "11px 14px",
                    borderRadius: 12,
                    background: "rgba(168,85,247,0.09)",
                    border: "1px solid rgba(168,85,247,0.28)",
                    color: "#d8b4fe",
                    fontSize: 12.5,
                    lineHeight: 1.55,
                  }}
                >
                  {t(
                    payoutTerms.tier === "expensive"
                      ? "payoutTermsExpensive"
                      : "payoutTermsStandard",
                    {
                      pct: Math.round(payoutTerms.commissionRate * 100),
                      min: payoutTerms.minWithdrawalUsd,
                    }
                  )}
                </div>
              )}

              {/* 3. DATOS FISCALES Y SELLO — solo si alguna de las dos señales dice México.

                  No se pregunta, se deduce: el país del documento del KYC o el de la cuenta
                  bancaria. Un creador extranjero no emite CFDI, así que no hay sello que
                  pedirle y este paso ni se le enseña. */}
              {esMexicano && (
                <Paso
                  numero={4}
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

              {csdVencido && (
                <Aviso tono="alerta" texto={t("payoutSetupSealExpired")} />
              )}

              {cobraFueraDeMexico && (
                <Aviso tono="aviso" texto={t("payoutSetupForeignAccountWarning")} />
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

/** Aviso corto dentro del panel. `alerta` bloquea algo; `aviso` solo advierte. */
function Aviso({ tono, texto }: { tono: "alerta" | "aviso"; texto: string }) {
  const rojo = tono === "alerta";
  return (
    <div
      style={{
        padding: "11px 14px",
        borderRadius: 12,
        background: rojo ? "rgba(248,113,113,0.09)" : "rgba(234,179,8,0.09)",
        border: rojo ? "1px solid rgba(248,113,113,0.28)" : "1px solid rgba(234,179,8,0.28)",
        color: rojo ? "#fca5a5" : "#eab308",
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
      {texto}
    </div>
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
