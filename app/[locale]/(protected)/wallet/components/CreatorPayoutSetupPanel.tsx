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
//
// Presentación: primitivo canónico `Modal` (= VibraResponsivePanel, vibra_style.md). En
// celular es la PESTAÑA deslizable desde abajo, con arrastre para cerrar; en laptop el panel
// centrado. Antes esto era un portal a mano con sus propios keyframes y su desmontado
// diferido, y en celular salía como panel centrado igual que en escritorio.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import { useCreatorTaxProfile } from "@/lib/facturacion/creatorFiscal";
import {
  createPayoutAccountLink,
  refreshPayoutAccountStatus,
  createPayoutAccountQuestionnaire,
} from "@/lib/wallet/payoutAccount";
import { Modal, TextButton } from "@/components/ui";

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
   * Didit está revisando su identidad A MANO. Puede tardar hasta 48 horas.
   *
   * ⚠️ Distinto de `kycBloqueado`, que también se pone al arrancar la sesión o mientras
   * carga. Solo esto merece decírselo: sin ello el paso enseñaba su botón apagado y nada
   * que explicara por qué no responde.
   */
  kycEnRevision?: boolean;
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
export type EstadoPaso = "listo" | "pendiente" | "bloqueado";

export default function CreatorPayoutSetupPanel({
  open,
  onClose,
  onOpenSello,
  onIniciarKyc,
  kycBloqueado,
  kycEnRevision,
  volviendoDeStripe,
}: Props) {
  const t = useTranslations("wallet");
  const { user } = useAuth();
  const {
    esMexicano,
    csdReady,
    csdVencido,
    csdRechazado,
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

  // El ciclo de vida de la animación, el backdrop, el bloqueo de scroll y el gesto de
  // arrastre los resuelve el primitivo `Modal`.
  /**
   * Qué paso tiene una llamada en vuelo. `null` = ninguno.
   *
   * ⚠️ Antes esto era un `guardando` booleano y SE CONTAGIABA: al tocar «Confirmar mi
   *    cuenta» se ponían en «Abriendo…» todos los botones del panel a la vez, como si
   *    hubieran arrancado tres cosas. Con el paso concreto solo se mueve el que se tocó.
   */
  const [ocupado, setOcupado] = useState<null | "cuenta" | "cobro">(null);
  const [error, setError] = useState<string | null>(null);
  const [refrescando, setRefrescando] = useState(false);

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
    setOcupado("cuenta");
    setError(null);
    try {
      const { url } = await createPayoutAccountQuestionnaire();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setOcupado(null);
    }
  }

  async function abrirAltaDeCobro() {
    setOcupado("cobro");
    setError(null);
    try {
      const { url } = await createPayoutAccountLink();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setOcupado(null);
    }
  }


  /**
   * ¿Cobra por Wallbit?
   *
   * Sus 12 países no tienen ruta de Stripe, o solo tienen wire a 25 USD por envío. A ese
   * creador NO se le pide alta de Stripe: no le serviría de nada y sería mandarlo a un
   * formulario que va a rechazar su país.
   */
  const porWallbit = payoutRoute === "wallbit";

  // Se lee antes que los estados de paso, que lo necesitan para des-completar el 3.
  const cobroRestringidoRaw = stripeAccountStatus === "restricted";

  /**
   * 🚨 UN RECHAZO DEVUELVE EL PASO A PENDIENTE.
   *
   * Sin esto el paso seguía en verde con su «Cuenta confirmada» mientras el aviso de
   * abajo le pedía corregirla — y su botón estaba ESCONDIDO, porque los pasos listos no
   * lo enseñan. El creador leía qué hacer y no tenía con qué hacerlo.
   */
  const pasoIdentidad: EstadoPaso = identityReady ? "listo" : "pendiente";
  const pasoCuenta: EstadoPaso =
    cuentaDeclarada && !cuentaNoCoincide ? "listo" : "pendiente";
  const pasoCobro: EstadoPaso =
    payoutAccountReady && !cobroRestringidoRaw ? "listo" : "pendiente";
  const pasoSello: EstadoPaso = csdReady && !csdVencido ? "listo" : "pendiente";

  // Dado de alta pero sin capacidad activa todavía: Stripe lo está revisando.
  const cobroEnRevision = stripeAccountStatus === "pending";
  const cobroRestringido = cobroRestringidoRaw;

  return (
    <Modal
      open={open}
      /* Mientras guarda no se cierra: hay una llamada en vuelo —abrir el formulario de
         Stripe, o el cuestionario— y cerrar dejaría al creador sin saber si ocurrió. */
      onClose={() => {
        if (!ocupado) onClose();
      }}
      title={t("payoutSetupTitle")}
      closeAriaLabel={t("payoutSetupClose")}
      contentPadding="20px 20px calc(20px + var(--vb-safe-bottom, 0px))"
    >
      <style>{`@keyframes vbPasoSpin{to{transform:rotate(360deg)}}`}</style>

      {loading ? (
        <div style={{ display: "grid", gap: 10 }}>
          <Esqueleto alto={64} />
          <Esqueleto alto={64} />
          <Esqueleto alto={64} />
        </div>
      ) : (
        /* 32 y no 14: sin caja que los delimite, el hueco es lo único que separa un
           paso del siguiente, así que tiene que ser generoso. */
        <div style={{ display: "grid", gap: 32 }}>
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
            /* En revisión manual el paso no pide nada, informa: su botón está apagado y
               sin esto no había forma de saber por qué. */
            descripcion={
              kycEnRevision
                ? t("payoutSetupStepIdentityReviewing")
                : t("payoutSetupStepIdentityHint")
            }
            hecho={t("payoutSetupStepIdentityDone")}
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
            estado={pasoCuenta}
            titulo={t(porWallbit ? "payoutSetupStepWallbit" : "payoutSetupStepDeclare")}
            descripcion={t(
              porWallbit ? "payoutSetupStepWallbitHint" : "payoutSetupStepDeclareHint"
            )}
            hecho={t(
              porWallbit ? "payoutSetupStepWallbitDone" : "payoutSetupStepDeclareDone"
            )}
            /* Si la cuenta no cuadra, el botón deja de invitar a declarar y pasa a
               invitar a corregir. Es la misma llamada, otra intención. */
            accion={
              cuentaNoCoincide
                ? t("payoutSetupStepDeclareFix")
                : t(porWallbit ? "payoutSetupStepWallbitCta" : "payoutSetupStepDeclareCta")
            }
            aviso={
              cuentaNoCoincide
                ? { tono: "alerta", texto: t("payoutSetupAccountMismatch") }
                : payoutTerms?.soloDolares && porWallbit
                  ? { tono: "aviso", texto: t("payoutSetupWallbitUsdOnly") }
                  : null
            }
            cargando={ocupado === "cuenta"}
            onAccion={ocupado ? undefined : abrirCuestionarioDeCuenta}
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
              hecho={t("payoutSetupStepPayoutDone")}
              accion={
                cobroEnRevision || cobroRestringido
                  ? t("payoutSetupStepPayoutResume")
                  : t("payoutSetupStepPayoutCta")
              }
              aviso={
                cobroRestringido
                  ? { tono: "alerta", texto: t("payoutSetupPayoutRestricted") }
                  : cobraFueraDeMexico
                    ? { tono: "aviso", texto: t("payoutSetupForeignAccountWarning") }
                    : null
              }
              /* `refrescando` también cuenta: al volver de Stripe se relee la cuenta y
                 ese sí es trabajo de ESTE paso. */
              cargando={ocupado === "cobro" || refrescando}
              onAccion={
                // Sin declarar antes, no se abre: es lo que impone el orden.
                !cuentaDeclarada || ocupado || refrescando ? undefined : abrirAltaDeCobro
              }
            />
          )}

          {/* 🔴 Su país vende pero no cobra.

              Se le dice aquí, en el alta, y no el día que pulse retirar: tiene derecho a
              decidir si le compensa seguir acumulando, y esa decisión no se toma cuando
              ya lo hizo. */}
          {payoutCountryUnpayable && (
            <Aviso tono="alerta" texto={t("payoutNoRouteWarning")} />
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
              hecho={t("payoutSetupStepSealDone")}
              /* Vencido no es lo mismo que no tenerlo ni que reemplazarlo por gusto: el
                 botón lo dice, porque es lo único que le indica que corre prisa. */
              accion={
                csdVencido || csdRechazado
                  ? t("payoutSetupStepSealFix")
                  : csdReady
                    ? t("payoutSetupStepSealReplace")
                    : t("payoutSetupStepSealCta")
              }
              aviso={
                csdVencido
                  ? { tono: "alerta", texto: t("payoutSetupSealExpired") }
                  : csdRechazado
                    ? { tono: "alerta", texto: t("payoutSetupSealRejected") }
                    : null
              }
              onAccion={() => {
                onClose();
                onOpenSello();
              }}
            />
          )}

        </div>
      )}

      {error && (
        <p style={{ fontSize: 12.5, color: "#f87171", marginTop: 14, marginBottom: 0 }}>{error}</p>
      )}
    </Modal>
  );
}

/**
 * Aviso corto dentro del panel. `alerta` bloquea algo; `aviso` solo advierte.
 *
 * Se EXPORTA para el catálogo de estados de `/admin/paneles`, que los pinta todos a la
 * vez. Importar el componente de verdad es lo que impide que el catálogo enseñe una cosa
 * y el panel otra.
 */
export function Aviso({ tono, texto }: { tono: "alerta" | "aviso"; texto: string }) {
  /**
   * ⚠️ Sin contorno y sin color, por decisión de Luis (2026-08-30): el panel entero va en
   *    gris. El tono sigue existiendo en el tipo y solo mueve el brillo del texto, para que
   *    una alerta se lea algo más fuerte que un aviso sin volver a pintar el panel.
   *
   *    El precio de esto está aceptado y conviene tenerlo presente: un KYC rechazado ya no
   *    salta a la vista, se lee como una nota más. Si algún día un creador se queda
   *    atascado sin enterarse de por qué, empieza por aquí.
   */
  const rojo = tono === "alerta";
  return (
    <div
      style={{
        padding: "11px 14px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.05)",
        color: rojo ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.7)",
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

export function Paso({
  numero,
  estado,
  titulo,
  descripcion,
  hecho,
  cargando,
  aviso,
  accion,
  onAccion,
}: {
  numero: number;
  estado: EstadoPaso;
  titulo: string;
  descripcion: string;
  /**
   * Qué quedó resuelto, en verde, cuando el paso está listo.
   *
   * Es lo único que distingue un paso hecho de uno pendiente desde que la caja y la
   * palomita se fueron, así que un paso sin esto se ve idéntico a uno sin empezar.
   */
  hecho?: string;
  /**
   * Este paso —y solo este— tiene una llamada en vuelo.
   *
   * Enseña el spinner junto al título y apaga su botón. Lo lleva cada paso por separado
   * a propósito: con un booleano común se ponían los tres a cargar de golpe.
   */
  cargando?: boolean;
  /**
   * El aviso de ESTE paso, dentro de su bloque.
   *
   * ⚠️ Antes los seis avisos se pintaban sueltos, todos después del paso 3. El de «tu
   *    cuenta no coincide» hablaba del paso 2 y salía debajo del 3; el de Wallbit quedaba
   *    huérfano porque en esa ruta el 3 ni se pinta. Cada uno junto a lo que explica.
   */
  aviso?: { tono: "alerta" | "aviso"; texto: string } | null;
  accion: string;
  onAccion?: () => void;
}) {
  const listo = estado === "listo";
  return (
    <div
      style={{
        /* Sin caja: ni fondo, ni contorno, ni relleno (decisión de Luis, 2026-08-30).
           El texto flota y lo único que separa un paso del siguiente es el hueco de la
           rejilla de arriba. Lo que dice que un paso está hecho es la línea verde de
           abajo, que sustituyó al fondo y a la palomita. */
        display: "grid",
        gridTemplateColumns: "38px minmax(0, 1fr)",
        gap: "0 14px",
        /* El número va centrado contra el alto del paso, no pegado arriba. Manda el
           bloque de texto, que es el alto; el número se alinea a su centro. */
        alignItems: "center",
      }}
    >
      {/* El número, suelto: ni círculo, ni fondo, ni palomita al completarse.

          Siempre en blanco y siempre el número, hecho o no. Quien dice si está hecho es la
          línea verde de abajo. */}
      <div
        aria-hidden="true"
        style={{
          display: "grid",
          placeItems: "center",
          color: "#fff",
          fontSize: 34,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {numero}
      </div>

      <div style={{ display: "grid", gap: 5, minWidth: 0 }}>
        {/* Título y, si el paso está hecho, la palomita blanca en su círculo verde.

            Va pegada al título y no al número, que es blanco y siempre dice lo mismo. La
            línea verde de abajo explica QUÉ quedó resuelto; esto se ve de un vistazo
            recorriendo la lista, sin leer. */}
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 14.5,
            fontWeight: 600,
            lineHeight: 1.3,
            minWidth: 0,
          }}
        >
          <span style={{ minWidth: 0 }}>{titulo}</span>

          {/* Cargando: el spinner ocupa EL MISMO sitio que la palomita, para que el
              estado del paso se lea siempre en el mismo punto y el título no se mueva. */}
          {cargando && (
            <span
              aria-hidden="true"
              style={{
                flexShrink: 0,
                width: 18,
                height: 18,
                borderRadius: "50%",
                border: "2px solid rgba(168,85,247,0.25)",
                borderTopColor: "#a855f7",
                animation: "vbPasoSpin 700ms linear infinite",
              }}
            />
          )}

          {!cargando && listo && (
            <span
              aria-hidden="true"
              style={{
                flexShrink: 0,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#22c55e",
                display: "grid",
                placeItems: "center",
              }}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth={3.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          )}
        </span>
        <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.62)", lineHeight: 1.5 }}>
          {descripcion}
        </span>
        {/* El aviso del paso, entre la descripción y el botón: primero qué pasa y
            luego con qué se arregla, que es el orden en que se lee. */}
        {aviso && (
          <div style={{ marginTop: 3 }}>
            <Aviso tono={aviso.tono} texto={aviso.texto} />
          </div>
        )}

        {/* Hecho: la confirmación en verde, en el hueco que deja el botón.

            Sustituye a la palomita y al fondo verde que llevaba la caja. Cada paso trae la
            suya —«Identidad verificada», «Cuenta confirmada»— porque un «Listo» genérico
            repetido tres veces no le dice al creador QUÉ quedó resuelto. */}
        {listo && hecho && (
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "#22c55e",
              lineHeight: 1.5,
              marginTop: 1,
            }}
          >
            {hecho}
          </span>
        )}

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
