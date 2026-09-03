"use client";

// Pasarela de pago de Vibra — STRIPE (Elements por CDN).
//
// MISMO diseño que la de Mercado Pago (`ServicePaymentModal`), motor Stripe:
//   Izquierda → "¿Cómo quieres pagar?": acordeón (crédito/débito nuevos + guardadas).
//   Derecha   → creador + servicio + total (Subtotal/IVA/Total) + "Pagar" + éxito verde.
// Tarjeta NUEVA → Card Elements (número/exp/CVC, iframes PCI). Guardada → un clic sin
// CVV (Stripe off-session; el cobro de guardadas se conecta en S3c).

import { createPortal } from "react-dom";
import { useExchangeRates } from "@/lib/currency/rates";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { intlLocale } from "@/i18n/locales";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useCallback } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { doc, getDoc, collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { repriceStripeIntentForCard } from "@/lib/stripe/stripePayments";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { emailHasAccount } from "@/lib/guest/guestAccount";
import { isPasswordAcceptable } from "@/lib/auth/passwordPolicy";
import { taxRateForCountry } from "@/lib/tax/config";
import { formatCurrency, convertToAnchor } from "@/lib/currency/format";
import type { DisplayCurrency } from "@/lib/currency/catalog";
import { useBuyerCredit } from "@/lib/wallet/useBuyerCredit";
import { FIXED_SERVICE_FEE_USD } from "@/lib/currency/catalog";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { isChargeableCountry } from "@/lib/tax/config";
import { loadStripe, type StripeLike, type StripeElement } from "@/lib/stripe/loadStripe";
import VibraPayBrand from "./VibraPayBrand";
import PaymentSuccessCard from "./PaymentSuccessCard";
import { getGuestNickname, setGuestNickname, GUEST_NICKNAME_MAX } from "@/lib/guest/guestNickname";

export type SavedCard = { id: string; brand?: string; brandName?: string; lastFour?: string; stripePaymentMethodId?: string };

type Props = {
  open: boolean;
  amount: number | null; // monto base (sin IVA), en la moneda `amountCurrency`
  /** Moneda del `amount`. Default: la de liquidación (USD). "MXN" queda para leer datos previos al corte. */
  amountCurrency?: "USD" | "MXN";

  /**
   * Referencia del pago (`greetingRequest__{id}`, `exclusiveSessionRequest__{id}`, …).
   *
   * Con ella, al leer la tarjeta se le PIDE AL SERVIDOR el precio autoritativo en vez de
   * recalcularlo aquí. Importa porque el espejo del cliente sabe cambiar el impuesto según
   * el país de la tarjeta, pero NO la moneda: con IP de EE. UU. y tarjeta mexicana enseñaba
   * dólares con IVA del 16%, mientras el backend cobraba en pesos. Sin moneda correcta no
   * hay forma de que lo mostrado sea lo cobrado.
   *
   * Solo la tienen los servicios que crean el pago ANTES de cobrar (saludo, consejo, sesión,
   * tiempo contigo). En el resto no existe todavía el documento del pago y se sigue con el
   * cálculo local.
   */
  externalReference?: string | null;
  /** Crea el PaymentIntent y devuelve su client_secret. `taxCountry` = país fiscal del comprador (por IP).
   *  Si `savedPaymentMethodId` viene, el cobro es "un clic" off-session (sin CVV): se confirma
   *  server-side y la respuesta trae `status` ("succeeded" = cobrado). */
  createIntent: (args: { amount: number; saveCard: boolean; taxCountry: string | null; savedPaymentMethodId?: string; nickname?: string | null; paymentMethodId?: string; applyCredit?: boolean; exactTotalLocal?: number | null; account?: { email: string; password: string; exists: boolean } | null }) => Promise<{ clientSecret?: string; status?: string }>;
  /** Invitado (sin login): en el saludo "Bienvenido" muestra un input de APODO editable
   *  (placeholder), cacheado por dispositivo y enviado en `createIntent`. */
  collectNickname?: boolean;
  /**
   * Pide correo y contrasena debajo de los metodos de pago.
   *
   * Solo lo usan el saludo y el consejo sin cuenta: son encargos que llegan
   * dias despues, asi que sin una identidad recuperable la compra se pierde.
   * Lo que se usa al instante —un boleto de live, una donacion— se sigue
   * cobrando sin pedir nada.
   *
   * Lo escrito aqui llega a `createIntent` en `account`, y es ESE quien
   * decide que hacer con ello. Esta pantalla solo recoge.
   */
  collectAccount?: boolean;
  /**
   * Correo de la cuenta con la que se está comprando, cuando ya hay una y por
   * tanto no se pide nada. Solo se usa para DECIRLO; quien lo pasa decide si
   * tiene sentido enseñarlo (en Vibra Express sí, en la app no hace falta).
   */
  accountEmail?: string | null;
  /** Volver a empezar con otro correo. Sin esto, el bloque solo informa. */
  onUseAnotherAccount?: () => void | Promise<void>;
  amountEditable?: boolean;
  /** Montos sugeridos de DONACIÓN (base MXN). Si no se pasan, usa los defaults. */
  donationPresets?: number[];
  /** Si true, el monto CUSTOM que teclea el donante ya es el TOTAL (incluye el cargo fijo y el
   *  impuesto); se despeja la base = total/(1+impuesto) − cargo fijo. Los presets siguen siendo
   *  base. Para live donation. */
  donationCustomInclusive?: boolean;
  /** Mínimo de la BASE (monto del creador) en donación editable. El modal comunica el
   *  total mínimo (base + cargo fijo + impuesto del país) y deshabilita pagar por debajo. 0 = sin mínimo. */
  minBaseAmount?: number;
  priceLabel?: string;
  pricePeriodLabel?: string;
  productType?: string;
  providerName?: string;
  avatarUrl?: string | null;
  description?: string | null;
  successMessage?: string | null;
  /**
   * Algo que ofrecer JUNTO a la pantalla de compra hecha, sin taparla.
   * En escritorio va como segunda columna; en celular, debajo. Recibe cómo va
   * colocado, porque esa diferencia cambia su forma.
   */
  successAside?: ((opts: { stacked: boolean }) => React.ReactNode) | null;
  /** Mensaje de éxito cuando el pago quedó como HOLD (retención, `requires_capture`) — las 4
   *  experiencias: aclara que se cobra al entregar/agendar. Si el pago se captura de una
   *  (crédito cubre todo, o servicio inmediato), se usa `successMessage`. */
  holdSuccessMessage?: string | null;
  durationMinutes?: number | null;
  locale?: string;
  presentation?: "dialog" | "sheet";
  container?: HTMLElement | null;
  /** Fuerza el layout apilado (vista celular) aunque la ventana sea ancha. Para el simulador. */
  forceStacked?: boolean;
  hideBuyerGreeting?: boolean;
  paymentHeading?: string;
  payButtonLabel?: string;
  savedCards?: SavedCard[];
  /** Si se pasa (>0), el panel de éxito se cierra solo tras estos ms (p. ej. 4000). */
  autoCloseMs?: number;
  /** Reintento de una experiencia ("intentar otra vez"): si hay tarjeta guardada, cobra
   *  automáticamente en un clic al abrir (sin que el usuario toque la pasarela) y muestra
   *  el panel verde. Si NO hay tarjeta guardada, cae al flujo manual normal. Solo cuenta
   *  real (no invitado). Default false → comportamiento normal. */
  autoConfirm?: boolean;
  /** Permite pagar con SALDO A FAVOR (crédito). Default true. La SUSCRIPCIÓN recurrente lo
   *  pasa en false (el crédito no aplica a un cobro mensual). */
  allowCredit?: boolean;
  onClose: () => void;
  onPaid: () => void;
};

/**
 * Nombre del país en español a partir del ISO-2, para la leyenda "Tu tarjeta es de …".
 * Usa `Intl.DisplayNames`, que ya viene en el navegador — sin tabla que mantener.
 * Si el ISO no se reconoce, devuelve el propio código.
 */
function countryName(iso: string | null | undefined, locale: string, unknownLabel: string): string {
  const code = (iso ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return code || unknownLabel;
  try {
    return new Intl.DisplayNames([intlLocale(locale)], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const ID_NUMBER = "vibra-stripe-card-number";
const ID_EXP = "vibra-stripe-card-exp";
const ID_CVC = "vibra-stripe-card-cvc";

const BLUE = "#009ee3";
// 💵 USD. Respaldo para cuando el creador no configuró sus propios montos sugeridos.
/**
 * Montos sugeridos cuando quien invoca el modal no trae los suyos.
 *
 * La donación de PERFIL pasa los que el creador configuró; la de LIVE usa estos. ⚠️ El
 * live los tenía repetidos a mano con estos mismos valores, así que cambiar aquí no le
 * habría llegado. Si algún día el live debe respetar también los del creador, el cambio
 * es pasarle `donationPresets`, no volver a escribir la lista.
 */
const DEFAULT_DONATION_PRESETS_USD = [3, 7, 15, 30];

const STRIPE_STYLE = {
  base: { fontSize: "15px", color: "#3a3f4a", fontFamily: "inherit", "::placeholder": { color: "#9aa0a8" } },
  invalid: { color: "#c0392b" },
};

export default function StripePaymentModal({
  open,
  amount,
  amountCurrency = "USD",
  externalReference = null,
  createIntent,
  amountEditable = false,
  donationPresets,
  donationCustomInclusive = false,
  minBaseAmount = 0,
  priceLabel,
  pricePeriodLabel,
  productType,
  providerName,
  avatarUrl,
  description,
  successMessage,
  successAside = null,
  holdSuccessMessage,
  durationMinutes,
  locale = "en",
  presentation = "dialog",
  container,
  forceStacked = false,
  hideBuyerGreeting = false,
  collectNickname = false,
  collectAccount = false,
  accountEmail = null,
  onUseAnotherAccount,
  paymentHeading,
  payButtonLabel,
  savedCards = [],
  autoCloseMs,
  autoConfirm = false,
  allowCredit = true,
  onClose,
  onPaid,
}: Props) {
  const tWallet = useTranslations("wallet");
  const tReg = useTranslations("auth.register");
  const tExpress = useTranslations("auth.express");
  const tShared = useTranslations("auth.shared");
  const tServicesPay = useTranslations("services");
  const tCommon = useTranslations("common");
  const isSheet = presentation === "sheet";
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (error) showToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  // El pago quedó como HOLD (retención): el panel de éxito usa el copy "se cobra al entregar".
  const [wasHold, setWasHold] = useState(false);
  const [chosenAmount, setChosenAmount] = useState<number | null>(null);
  /** Total EXACTO que tecleó el donante, en SU moneda. Null si eligió un monto sugerido. */
  const [totalTecleado, setTotalTecleado] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [cardName, setCardName] = useState("");
  const [saveCard, setSaveCard] = useState(true);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [renderedMethod, setRenderedMethod] = useState<string | null>(null);
  const [cardValid, setCardValid] = useState({ number: false, exp: false, cvc: false });

  // ── País de la TARJETA ───────────────────────────────────────────────────────
  // Al abrir la pasarela el precio se calcula con la IP. En cuanto el comprador termina de
  // escribir la tarjeta se crea el PaymentMethod (SIN cobrar) y Stripe devuelve el país
  // emisor: si difiere del de la IP, el precio se recalcula solo.
  //
  // El `pm_...` se reutiliza al confirmar, así que la tarjeta se materializa una sola vez.
  // Y se manda al backend para que él lea el país de Stripe — el cliente nunca envía un país,
  // envía un identificador verificable. Ver backend/src/payments/stripe/cardCountry.ts.
  const [cardPm, setCardPm] = useState<{ id: string; country: string | null } | null>(null);
  /** true mientras se lee el BIN: el precio se muestra como skeleton. */
  const [readingCard, setReadingCard] = useState(false);
  // Espejo en ref: `handlePay` se define fuera del render y necesita el valor vigente.
  const cardPmRef = useRef<{ id: string; country: string | null } | null>(null);
  useEffect(() => { cardPmRef.current = cardPm; }, [cardPm]);
  const [isNarrow, setIsNarrow] = useState(false);
  const stacked = isNarrow || isSheet || forceStacked;
  // En celular (y no ya en modo sheet embebido), la pasarela se presenta como
  // bottom-sheet: sube al abrir y baja al cerrar. En laptop queda como diálogo centrado.
  const mobileSheet = stacked && !isSheet;
  const [buyer, setBuyer] = useState<{ name: string; photo: string | null } | null>(null);
  // Apodo del invitado (se pre-llena de la caché del dispositivo y es editable).
  const [nickname, setNickname] = useState("");
  // Invitado = sesión anónima. Para un invitado, una tarjeta guardada NO cobra un-clic:
  // re-pide el CVV (se recolecta con un Element solo-CVC y se confirma on-session).
  const [isGuest, setIsGuest] = useState(false);
  const [savedCvcValid, setSavedCvcValid] = useState(false);
  const savedCvcElRef = useRef<StripeElement | null>(null);
  const [render, setRender] = useState(false);
  const [entered, setEntered] = useState(false);
  // Tarjetas guardadas del comprador (Stripe). Se suscribe internamente para que CUALQUIER
  // pasarela las ofrezca, aunque el servicio no las pase como prop. Una tarjeta guardada en
  // un servicio queda disponible en todos (cobro "un clic" off-session, sin CVV).
  const [subscribedCards, setSubscribedCards] = useState<SavedCard[]>([]);
  const effectiveSavedCards = savedCards.length ? savedCards : subscribedCards;

  const pf = usePriceFormat();

  // Saldo a favor del comprador (MXN). Solo cuentas reales (un invitado no tiene crédito).
  const credit = useBuyerCredit(isGuest ? null : (auth.currentUser?.uid ?? null));
  const tasas = useExchangeRates();
  const creditBalance = isGuest ? 0 : credit.balance;
  const [useCredit, setUseCredit] = useState(false);

  const isNewCard = selectedMethod === "credit" || selectedMethod === "debit";
  const savedCardId = selectedMethod?.startsWith("saved:") ? selectedMethod.slice(6) : null;

  // ── Alta dentro del cobro (solo saludo y consejo sin cuenta) ──────────────
  const [acctEmail, setAcctEmail] = useState("");
  const [acctPassword, setAcctPassword] = useState("");
  const [acctConfirm, setAcctConfirm] = useState("");
  // null = todavia no se ha comprobado ese correo.
  const [acctExists, setAcctExists] = useState<boolean | null>(null);
  // Algo@algo.algo, sin espacios. Basta para no dejar pasar un correo escrito a
  // medias; el que decide de verdad si existe es el servidor.
  const acctEmailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acctEmail.trim());
  // Con cuenta previa NO se pide repetir: la contrasena se escribe de memoria
  // y repetirla no aporta nada.
  // ⚠️ La MISMA regla que Firebase Auth va a aplicar, no una inventada aqui.
  //
  // Antes bastaban 6 caracteres, que es el minimo del SDK pero NO la politica
  // configurada en el proyecto. El campo dejaba pasar la contrasena, se cobraba
  // el intento y Firebase la rechazaba al final con un codigo cripitico. Que la
  // pantalla acepte algo que el servidor rechaza es la peor forma de validar.
  //
  // Con cuenta previa no se comprueba la fortaleza: esa contrasena ya existe y
  // lo unico que importa es que sea la correcta.
  const acctPasswordOk =
    acctExists === true ? acctPassword.length > 0 : isPasswordAcceptable(acctPassword);
  const acctOk =
    !collectAccount ||
    (acctEmailOk && acctPasswordOk && (acctExists === true || acctPassword === acctConfirm));
  const mxnAmount = amountEditable ? chosenAmount : (amount ?? null);

  // Total estimado en MXN (base + cargo fijo en donación + impuesto del país) para calcular cuánto crédito se
  // aplica y si cubre el 100%. El monto EXACTO lo decide el backend; esto es para la UI.
  const creditChargedBaseMxn =
    mxnAmount != null ? mxnAmount + (amountEditable ? FIXED_SERVICE_FEE_USD : 0) : null;
  const estTotalMxn =
    creditChargedBaseMxn != null
      ? Math.round((creditChargedBaseMxn * (1 + pf.taxRate) + Number.EPSILON) * 100) / 100
      : null;
  const creditEnabled = allowCredit && !isGuest && creditBalance > 0;

  // 💱 El saldo vive en la MONEDA DEL COMPRADOR y el total de arriba en la de liquidación.
  // Para restar hay que ponerlos en la misma: se pasa el saldo a la de liquidación con la
  // conversión SIMPLE, sin el 2% ni redondeo comercial —no es un precio, es dinero que ya
  // tiene—. El backend hace la resta definitiva en la moneda del comprador; esto es la
  // estimación para pintar el desglose.
  const saldoEnLiquidacion =
    credit.currency && credit.currency !== SETTLEMENT_CURRENCY
      ? (convertToAnchor(creditBalance, credit.currency as DisplayCurrency, tasas.rates) ?? 0)
      : creditBalance;
  const creditApplied =
    useCredit && creditEnabled && estTotalMxn != null
      ? Math.min(saldoEnLiquidacion, estTotalMxn)
      : 0;
  const remainderAfterCredit =
    estTotalMxn != null ? Math.round((estTotalMxn - creditApplied + Number.EPSILON) * 100) / 100 : null;
  // El saldo cubre el 100% → no hace falta tarjeta.
  const creditCoversAll = useCredit && creditEnabled && remainderAfterCredit != null && remainderAfterCredit <= 0;

  // Donación editable: la base elegida debe alcanzar el mínimo (si el servicio lo exige).
  const belowMin = amountEditable && minBaseAmount > 0 && chosenAmount != null && chosenAmount < minBaseAmount;
  const amountOk = !amountEditable || (chosenAmount != null && chosenAmount > 0 && !belowMin);
  const canPay =
    amountOk &&
    acctOk &&
    // Si el saldo a favor cubre el 100%, no hace falta tarjeta.
    (creditCoversAll ||
      (isNewCard
        ? cardValid.number && cardValid.exp && cardValid.cvc && cardName.trim().length > 0
        : savedCardId
          ? (isGuest ? savedCvcValid : true) // invitado re-pide CVV; cuenta real = un-clic off-session
          : false));

  /**
   * Hay un cobro en marcha (o ya hecho) en esta apertura.
   *
   * Mientras valga `true`, la pantalla no se reinicia aunque cambien el importe
   * o la moneda que le pasan. Se limpia al cerrar.
   */
  const cobroEnCursoRef = useRef(false);
  /**
   * El bloque de correo y contraseña, para poder llevar la vista hasta él.
   *
   * Aparece a mitad de la pasarela cuando alguien pulsa «usar otro correo», y
   * nace DEBAJO de todos los métodos de pago. Sin acercarlo, la pantalla se
   * queda donde estaba y parece que el botón no hizo nada.
   */
  const cuentaRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<StripeLike | null>(null);
  const numberElRef = useRef<StripeElement | null>(null);
  const onPaidRef = useRef(onPaid);
  const createIntentRef = useRef(createIntent);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onPaidRef.current = onPaid;
    createIntentRef.current = createIntent;
    onCloseRef.current = onClose;
  }, [onPaid, createIntent, onClose]);

  // Al aparecer el alta a mitad de la pasarela, se baja hasta ella.
  //
  // Solo cuando APARECE, no al abrir con ella ya puesta: ahí lo correcto es
  // empezar por arriba, donde están los métodos de pago.
  const habiaCuentaRef = useRef(collectAccount);
  useEffect(() => {
    const aparece = collectAccount && !habiaCuentaRef.current;
    habiaCuentaRef.current = collectAccount;
    if (!aparece) return;
    // Un fotograma de margen: el bloque acaba de entrar en el árbol y todavía no
    // tiene sitio en la página.
    const raf = requestAnimationFrame(() => {
      cuentaRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [collectAccount]);

  // Cierre automático del panel de éxito cuando se pide (supercomentario / donación).
  useEffect(() => {
    if (showSuccess && autoCloseMs && autoCloseMs > 0) {
      const t = window.setTimeout(() => onCloseRef.current(), autoCloseMs);
      return () => window.clearTimeout(t);
    }
  }, [showSuccess, autoCloseMs]);

  // Lee el país EMISOR en cuanto los tres campos de la tarjeta están completos.
  //
  // Crea el PaymentMethod, que NO cobra nada — solo materializa la tarjeta para poder
  // consultarle a Stripe de qué país es. El mismo `pm_...` se reutiliza al confirmar el pago,
  // así que la tarjeta se tokeniza una sola vez.
  //
  // Si falla, no se rompe nada: el precio se queda con el de la IP y el cobro sigue su curso.
  const cardComplete = cardValid.number && cardValid.exp && cardValid.cvc;
  useEffect(() => {
    if (!cardComplete || cardPm || readingCard) return;
    const stripe = stripeRef.current;
    const numberEl = numberElRef.current;
    if (!stripe || !numberEl) return;

    let cancelled = false;
    setReadingCard(true);
    (async () => {
      try {
        const res = await stripe.createPaymentMethod({
          type: "card",
          card: numberEl,
          billing_details: { name: cardName.trim() || undefined },
        });
        if (cancelled) return;
        const pm = res?.paymentMethod;
        if (pm?.id) {
          setCardPm({ id: pm.id, country: pm.card?.country?.toUpperCase() ?? null });
        }
      } catch {
        // Sin país de tarjeta se sigue con el de la IP. No se muestra error al comprador.
      } finally {
        // ⚠️ SIEMPRE, aunque se haya cancelado. Atarlo a `cancelled` dejaba el precio
        // en skeleton para siempre: al cancelarse nadie volvía a apagar la bandera.
        setReadingCard(false);
      }
    })();

    return () => { cancelled = true; };
    // ⚠️ `readingCard` NO va aquí: es la guarda de "ya hay una lectura en vuelo", y
    // ponerlo como dependencia hacía que el efecto se cancelara a sí mismo —
    // setReadingCard(true) lo re-disparaba, el cleanup marcaba `cancelled` y la
    // respuesta de Stripe se descartaba entera (ni país de tarjeta, ni fin del skeleton).
    // `cardName` tampoco: solo viaja en billing_details y re-tokenizaba en cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardComplete, cardPm]);

  // ── Precio AUTORITATIVO: lo dice el servidor, no se adivina aquí ──────────
  //
  // Se pide en cuanto hay `pm_...`, que es cuando el servidor puede leer el país emisor.
  // Devuelve moneda, subtotal, impuesto y total ya compuestos: exactamente lo que se va a
  // cobrar. Mientras viaja, los skeletons ya están puestos (`readingCard`).
  //
  // Si falla NO se rompe el pago: se queda el cálculo local y el cobro sigue su curso. Es
  // una mejora de exactitud, no una dependencia.
  const [precioServidor, setPrecioServidor] = useState<{
    currency: string; base: number; tax: number; total: number; taxName: string; rate: number;
  } | null>(null);
  const [pidiendoPrecio, setPidiendoPrecio] = useState(false);

  useEffect(() => {
    if (!open) { setPrecioServidor(null); return; }
  }, [open]);

  useEffect(() => {
    const pmId = cardPm?.id;
    if (!externalReference || !pmId) return;
    let cancelado = false;
    setPidiendoPrecio(true);
    (async () => {
      try {
        const r = await repriceStripeIntentForCard({ externalReference, paymentMethodId: pmId });
        if (cancelado || !r) return;
        setPrecioServidor({
          currency: r.display.currency,
          base: r.display.subtotal,
          tax: r.display.tax,
          total: r.display.total,
          taxName: r.display.taxName,
          rate: r.display.taxRate,
        });
      } catch {
        // Se queda el cálculo local. No se le enseña un error al comprador por esto.
      } finally {
        if (!cancelado) setPidiendoPrecio(false);
      }
    })();
    return () => { cancelado = true; };
  }, [externalReference, cardPm]);

  // País que MANDA para el precio mostrado. Espeja la regla del backend
  // (backend/src/tax/resolveCountry.ts): gana la tarjeta, salvo que la IP sea de México
  // —ahí el servicio se aprovecha en México y paga IVA mexicano aunque la tarjeta sea de fuera.
  const ipCountry = pf.buyerCountry;
  const effectiveCountry =
    ipCountry === "MX" ? "MX" : (cardPm?.country ?? ipCountry);
  /** true cuando la tarjeta cambió el país respecto a lo que dijo la IP. */
  const countryFromCard = !!cardPm?.country && effectiveCountry === cardPm.country && cardPm.country !== ipCountry;

  // Tasa del país que MANDA (la de la tarjeta si ya se leyó, si no la de la IP). Usar
  // `pf.taxRate`, que va siempre por IP, desglosaba con una tasa y cobraba con otra.
  const tasaImpuestoVigente = taxRateForCountry(effectiveCountry);

  /**
   * El donante teclea el TOTAL en SU moneda. Aquí se deshace todo para llegar a la base en
   * USD, que es lo único que el backend entiende.
   *
   * ⚠️ El campo estaba en USD con la etiqueta "MXN" fija: quien escribía 149 pensando en
   * pesos acababa pagando 149 dólares —2.592 MXN—. Y al pulsar un botón sugerido se metía
   * en el campo el importe en USD mientras el botón enseñaba el convertido, así que los dos
   * números nunca coincidían.
   */
  const baseUsdDesdeTotalLocal = useCallback((totalLocal: number): number | null => {
    if (!Number.isFinite(totalLocal) || totalLocal <= 0) return null;
    const sinImpuesto = totalLocal / (1 + (tasaImpuestoVigente));
    const usd = pf.currency === SETTLEMENT_CURRENCY ? sinImpuesto : pf.buyerLocalToUsd(sinImpuesto);
    if (usd == null) return null;
    const base = usd - FIXED_SERVICE_FEE_USD;
    return base > 0 ? Math.round(base * 100) / 100 : null;
  }, [pf, tasaImpuestoVigente]);

  /** El TOTAL en moneda local de una base en USD. Es lo que enseña el botón sugerido. */
  const totalLocalDesdeBaseUsd = useCallback((baseUsd: number): number =>
    pf.formatWithTax(baseUsd + FIXED_SERVICE_FEE_USD, {
      baseCurrency: SETTLEMENT_CURRENCY,
      taxCountryOverride: effectiveCountry,
    }).totalLocal,
  [pf, effectiveCountry]);

  const amountInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && entered && amountEditable && !showSuccess && !isSheet) {
      const t = window.setTimeout(() => amountInputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open, entered, amountEditable, showSuccess, isSheet]);

  // Contenedor scrolleable del modal: al pasar al panel de éxito lo llevamos al TOPE
  // para que la X de cerrar sea visible (si venía scrolleado desde el formulario).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showSuccess) scrollRef.current?.scrollTo({ top: 0 });
  }, [showSuccess]);

  useEffect(() => {
    setMounted(true);
    const check = () => setIsNarrow(window.innerWidth <= 720);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Entrada/salida animada.
  useEffect(() => {
    if (open) {
      setRender(true);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setEntered(true)); });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setEntered(false);
    const t = window.setTimeout(() => setRender(false), 240);
    return () => window.clearTimeout(t);
  }, [open]);

  useBodyScrollLock(open && !isSheet);

  // Invitado: pre-llena el apodo desde la caché del dispositivo al abrir.
  useEffect(() => {
    if (open && collectNickname) setNickname(getGuestNickname());
  }, [open, collectNickname]);

  // ¿La sesión es un invitado (anónima)? Determina si una tarjeta guardada re-pide CVV.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsGuest(!!auth.currentUser?.isAnonymous);
    const unsub = auth.onAuthStateChanged((u) => setIsGuest(!!u?.isAnonymous));
    return () => unsub();
  }, [open]);

  // Perfil del comprador (saludo).
  useEffect(() => {
    if (!open) return;
    const uid = auth.currentUser?.uid;
    if (!uid) { setBuyer(null); return; }
    let cancelled = false;
    getDoc(doc(db, "users", uid))
      .then((snap) => {
        if (cancelled) return;
        const d = snap.data();
        setBuyer({
          name: (typeof d?.displayName === "string" && d.displayName) || (typeof d?.firstName === "string" && d.firstName) || "",
          photo: typeof d?.photoURL === "string" ? d.photoURL : null,
        });
      })
      .catch(() => { if (!cancelled) setBuyer(null); });
    return () => { cancelled = true; };
  }, [open]);

  // Suscripción a las tarjetas guardadas de Stripe del comprador (solo docs con
  // `stripePaymentMethodId`; descarta legacy de MP). Habilita el cobro "un clic".
  useEffect(() => {
    if (!open) { setSubscribedCards([]); return; }
    const uid = auth.currentUser?.uid;
    if (!uid) { setSubscribedCards([]); return; }
    const unsub = onSnapshot(
      collection(db, "users", uid, "paymentMethods"),
      (snap) => setSubscribedCards(
        snap.docs
          .filter((d) => typeof d.data().stripePaymentMethodId === "string")
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              brand: typeof data.brand === "string" ? data.brand : undefined,
              brandName: typeof data.brandName === "string" ? data.brandName : undefined,
              lastFour: typeof data.lastFour === "string" ? data.lastFour : undefined,
              stripePaymentMethodId: typeof data.stripePaymentMethodId === "string" ? data.stripePaymentMethodId : undefined,
            };
          })
      ),
      () => setSubscribedCards([])
    );
    return () => unsub();
  }, [open]);

  // (B2) Invitado + tarjeta guardada seleccionada → monta un Element solo-CVC para
  // recolectar el CVV y confirmar on-session (no off-session). Espeja el montaje de la
  // tarjeta nueva pero solo con el campo CVC.
  useEffect(() => {
    if (!open || !sdkReady || !isGuest || !savedCardId) return;
    const stripe = stripeRef.current;
    if (!stripe) return;
    setSavedCvcValid(false);
    const elements = stripe.elements();
    const cvcEl = elements.create("cardCvc", { style: STRIPE_STYLE });
    savedCvcElRef.current = cvcEl;
    cvcEl.on("change", (e) => setSavedCvcValid((e as { complete?: boolean } | null)?.complete === true));
    const raf = requestAnimationFrame(() => {
      try { cvcEl.mount(`#vibra-saved-cvc-${savedCardId}`); } catch { /* no-op */ }
    });
    return () => {
      cancelAnimationFrame(raf);
      try { cvcEl.destroy(); } catch { /* no-op */ }
      if (savedCvcElRef.current === cvcEl) savedCvcElRef.current = null;
    };
  }, [open, sdkReady, isGuest, savedCardId]);

  // (A) Al abrir: carga Stripe.js.
  //
  // ⚠️ Este efecto BORRA el estado de la pantalla —incluida la verde de "listo"—
  // y depende de `amount`. Eso es correcto al abrir y catastrofico a mitad del
  // cobro, que es justo cuando el importe puede cambiar: en Vibra Express, al
  // entrar con un correo que ya tenia cuenta, el encargo se crea DENTRO del
  // cobro y con el llega el importe definitivo. La pasarela se reiniciaba
  // entera un instante despues de pagar, asi que la compra se hacia, al creador
  // le llegaba la solicitud, y quien pagaba veia desaparecer todo sin mas.
  //
  // Con un cobro en marcha, esta pantalla ya no se reinicia por nada.
  useEffect(() => {
    if (!open) {
      // Cerrada, vuelve a estar disponible para el siguiente cobro.
      cobroEnCursoRef.current = false;
      return;
    }
    if (cobroEnCursoRef.current) return;
    // En donación (amountEditable) el monto es dinámico (se elige adentro) → NO exigir `amount`.
    if (!amountEditable && (!amount || amount <= 0)) { setError(tWallet("payErrorNoPrice")); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSdkReady(false);
    setSelectedMethod(null);
    setPaid(false);
    setShowSuccess(false);
    setWasHold(false);
    setChosenAmount(amountEditable ? null : amount ?? null);
    setCustomAmount("");
    setSelectedPreset(null);

    loadStripe()
      .then((s) => { if (cancelled) return; stripeRef.current = s; setSdkReady(true); setLoading(false); })
      .catch(() => { if (cancelled) return; setError(tWallet("payErrorLoad")); setLoading(false); });

    return () => { cancelled = true; };
  }, [open, amount, amountEditable]);

  // (B) Monta los Card Elements de la tarjeta nueva.
  useEffect(() => {
    if (!open || !sdkReady || !isNewCard) return;
    const stripe = stripeRef.current;
    if (!stripe) return;
    setCardValid({ number: false, exp: false, cvc: false });
    const elements = stripe.elements();
    const numberEl = elements.create("cardNumber", { style: STRIPE_STYLE, placeholder: "1234 1234 1234 1234", showIcon: true });
    const expEl = elements.create("cardExpiry", { style: STRIPE_STYLE });
    const cvcEl = elements.create("cardCvc", { style: STRIPE_STYLE });
    numberElRef.current = numberEl;

    const complete = (e: unknown) => (e as { complete?: boolean } | null)?.complete === true;
    // Si el comprador corrige la tarjeta, el país leído deja de valer: se descarta para que
    // el precio vuelva al de la IP hasta que la nueva tarjeta esté completa.
    const invalidateCard = () => setCardPm(null);
    numberEl.on("change", (e) => {
      setCardValid((v) => ({ ...v, number: complete(e) }));
      invalidateCard();
    });
    expEl.on("change", (e) => {
      setCardValid((v) => ({ ...v, exp: complete(e) }));
      invalidateCard();
    });
    cvcEl.on("change", (e) => {
      setCardValid((v) => ({ ...v, cvc: complete(e) }));
      invalidateCard();
    });

    // rAF: espera a que el contenedor esté en el DOM (dentro del acordeón).
    const raf = requestAnimationFrame(() => {
      try {
        // IDs únicos por método: se monta SIEMPRE en el contenedor del método activo
        // (evita montar en un contenedor duplicado que se va a colapsar → campos muertos).
        numberEl.mount(`#${ID_NUMBER}-${selectedMethod}`);
        expEl.mount(`#${ID_EXP}-${selectedMethod}`);
        cvcEl.mount(`#${ID_CVC}-${selectedMethod}`);
      } catch {
        setError(tWallet("payErrorLoad"));
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      for (const el of [numberEl, expEl, cvcEl]) { try { el.destroy(); } catch { /* no-op */ } }
      if (numberElRef.current === numberEl) numberElRef.current = null;
    };
    // selectedMethod: al cambiar entre crédito/débito re-monta en el contenedor nuevo.
  }, [open, sdkReady, isNewCard, selectedMethod]);

  // Mantiene el cuerpo del acordeón ~320ms al cerrar (para animar la altura).
  useEffect(() => {
    if (selectedMethod) { setRenderedMethod(selectedMethod); return; }
    const t = window.setTimeout(() => setRenderedMethod(null), 320);
    return () => window.clearTimeout(t);
  }, [selectedMethod]);

  function toggleMethod(id: string) {
    setSelectedMethod((prev) => (prev === id ? null : id));
    setError(null);
  }

  async function handlePay() {
    if (submitting) return;
    if (!selectedMethod && !creditCoversAll) { setError(tWallet("payErrorNoMethod")); return; }
    const stripe = stripeRef.current;
    if (!stripe) return;
    const payAmount = (amountEditable ? chosenAmount : amount) ?? null;
    if (payAmount == null || payAmount <= 0) { setError(tWallet("payErrorInvalidAmount")); return; }

    setSubmitting(true);
    setError(null);
    // Desde aquí, esta pantalla NO se reinicia por mucho que cambien sus datos
    // de entrada. Ver el efecto (A): el cobro puede cambiar el importe y la
    // moneda por debajo, y reiniciar en mitad del cobro borra la pantalla verde.
    cobroEnCursoRef.current = true;
    // Marca el pago como exitoso (pantalla verde o cierre, según successMessage).
    //
    // ⚠️ La pantalla verde se pone en el MISMO tick que `onPaid`, no 300 ms después.
    // Antes había un hueco: `onPaid` ya había cambiado el contenido de debajo —el candado
    // se abría, el precio desaparecía— mientras el formulario seguía desvaneciéndose, así
    // que durante ese tercio de segundo se veía asomar otro panel bajo el que se iba.
    //
    // No se retrasa `onPaid` para cerrar el hueco por el otro lado: si el modal se
    // desmontara dentro de esos 300 ms, el aviso del pago no llegaría nunca y el padre se
    // quedaría sin enterarse de una compra ya cobrada. La transición no se pierde: la
    // tarjeta verde entra con su propia animación de aparición.
    const markPaid = (resultStatus?: string) => {
      setWasHold(resultStatus === "requires_capture");
      if (successMessage || holdSuccessMessage) {
        setPaid(true);
        setShowSuccess(true);
      }
      onPaidRef.current();
    };
    try {
      // El SALDO A FAVOR cubre el 100%: sin tarjeta. El backend materializa la compra
      // (remainder 0) y devuelve status "succeeded".
      if (creditCoversAll) {
        const res = await createIntentRef.current({ account: collectAccount ? { email: acctEmail.trim().toLowerCase(), password: acctPassword, exists: acctExists === true } : null, amount: payAmount, exactTotalLocal: totalTecleado, saveCard: false, taxCountry: pf.buyerCountry ?? null, nickname: collectNickname ? (nickname.trim() || null) : null, applyCredit: true });
        if (res.status === "succeeded" || res.status === "processing" || res.status === "requires_capture") { markPaid(res.status); return; }
        throw new Error("rejected");
      }
      if (savedCardId) {
        const res = await createIntentRef.current({ account: collectAccount ? { email: acctEmail.trim().toLowerCase(), password: acctPassword, exists: acctExists === true } : null, amount: payAmount, exactTotalLocal: totalTecleado, saveCard: false, taxCountry: pf.buyerCountry ?? null, savedPaymentMethodId: savedCardId, nickname: collectNickname ? (nickname.trim() || null) : null, applyCredit: useCredit });
        if (isGuest) {
          // Invitado: NO hay un-clic. El callable devolvió un clientSecret y aquí se confirma
          // ON-SESSION con la PM guardada + el CVV recolectado (Element solo-CVC). Así, en un
          // dispositivo compartido, sin la tarjeta física no se puede cobrar.
          const cvcEl = savedCvcElRef.current;
          const pmId = effectiveSavedCards.find((c) => c.id === savedCardId)?.stripePaymentMethodId;
          if (!res.clientSecret || !cvcEl || !pmId) throw new Error("no_secret");
          const result = await stripe.confirmCardPayment(res.clientSecret, {
            payment_method: pmId,
            payment_method_options: { card: { cvc: cvcEl } },
          });
          if (result.error) { setError(result.error.message || tWallet("payErrorRetry")); setSubmitting(false); return; }
          if (result.paymentIntent?.status === "succeeded" || result.paymentIntent?.status === "processing" || result.paymentIntent?.status === "requires_capture") { markPaid(result.paymentIntent?.status); return; }
          throw new Error("rejected");
        }
        // Cuenta real: cobro "un clic" off-session (sin CVV); el callable confirma server-side.
        if (res.status === "succeeded" || res.status === "processing" || res.status === "requires_capture") { markPaid(res.status); return; }
        // Requiere autenticación adicional (SCA): completa el 3DS con el client_secret.
        if (res.clientSecret) {
          const result = await stripe.confirmCardPayment(res.clientSecret);
          if (result.error) { setError(result.error.message || tWallet("payErrorRetry")); setSubmitting(false); return; }
          if (result.paymentIntent?.status === "succeeded" || result.paymentIntent?.status === "processing" || result.paymentIntent?.status === "requires_capture") { markPaid(result.paymentIntent?.status); return; }
        }
        throw new Error("rejected");
      }
      // Tarjeta nueva.
      if (!cardName.trim()) throw new Error("no_name");
      const numberEl = numberElRef.current;
      if (!numberEl) throw new Error("no_element");

      // Se manda el `pm_...` ya creado al leer la tarjeta: el backend consulta a Stripe de qué
      // país es y resuelve el impuesto con ese dato, no con el que diga el navegador.
      const res = await createIntentRef.current({ account: collectAccount ? { email: acctEmail.trim().toLowerCase(), password: acctPassword, exists: acctExists === true } : null, amount: payAmount, exactTotalLocal: totalTecleado, saveCard, taxCountry: pf.buyerCountry ?? null, nickname: collectNickname ? (nickname.trim() || null) : null, paymentMethodId: cardPmRef.current?.id, applyCredit: useCredit });
      // Sin factura que confirmar (p. ej. REACTIVAR una suscripción con cancelación
      // pendiente: no se cobra de nuevo). El backend ya dejó todo listo → éxito directo.
      if (res.status === "succeeded" || res.status === "processing" || res.status === "requires_capture") { markPaid(res.status); return; }
      const clientSecret = res.clientSecret;
      if (!clientSecret) throw new Error("no_secret");
      // Si ya se materializó la tarjeta al leer su país, se confirma con ESE método —
      // así no se tokeniza dos veces. Si no (lectura fallida), se crea al confirmar.
      const existingPm = cardPmRef.current?.id;
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: existingPm ?? { card: numberEl, billing_details: { name: cardName.trim() } },
      });
      if (result.error) {
        setError(result.error.message || tWallet("payErrorRetry"));
        setSubmitting(false);
        return;
      }
      if (result.paymentIntent?.status === "succeeded" || result.paymentIntent?.status === "processing" || result.paymentIntent?.status === "requires_capture") {
        markPaid(result.paymentIntent?.status);
        return;
      }
      throw new Error("rejected");
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      // Errores del callable (HttpsError) traen su propio mensaje útil y en español
      // (ej. "En vivo no encontrado."); lo mostramos en vez del genérico.
      const fbCode = (err as { code?: unknown })?.code;
      const isCallableError = typeof fbCode === "string" && fbCode.includes("/");
      setError(
        code === "no_name" ? tWallet("payErrorNoName")
          : code === "no_element" ? tWallet("payErrorReloadForm")
          : isCallableError && code ? code
          : tWallet("payErrorRetry")
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ── Reintento "un clic" (autoConfirm) ─────────────────────────────────────
  // En modo reintento, si el comprador tiene tarjeta guardada (cuenta real), se
  // selecciona esa tarjeta y se dispara el cobro AUTOMÁTICAMENTE al abrir, sin que toque
  // la pasarela → directo al panel verde. Sin tarjeta guardada (o invitado) cae al flujo
  // manual normal. Idempotente por `autoPayTriggeredRef` (una sola vez por apertura).
  const autoPayTriggeredRef = useRef(false);
  const autoPayFiredRef = useRef(false);
  const firstUsableSavedCardId = effectiveSavedCards.find((c) => c.stripePaymentMethodId)?.id ?? null;
  const autoPaying = autoConfirm && !isGuest && !!firstUsableSavedCardId && !error && !showSuccess;

  useEffect(() => {
    if (!open) { autoPayTriggeredRef.current = false; autoPayFiredRef.current = false; return; }
    if (!autoConfirm || autoPayTriggeredRef.current) return;
    if (isGuest || !sdkReady || paid || submitting || !firstUsableSavedCardId) return;
    autoPayTriggeredRef.current = true;
    setSelectedMethod(`saved:${firstUsableSavedCardId}`);
  }, [open, autoConfirm, isGuest, sdkReady, paid, submitting, firstUsableSavedCardId]);

  useEffect(() => {
    if (!autoConfirm || !autoPayTriggeredRef.current || autoPayFiredRef.current) return;
    if (!savedCardId || submitting || paid) return;
    autoPayFiredRef.current = true; // una sola vez por apertura
    void handlePay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCardId, autoConfirm]);

  if (!mounted || !render) return null;

  // ── Estilos (panel claro) ──
  const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#5b616e", marginBottom: 6, display: "block" };
  const box: React.CSSProperties = { height: 40, borderRadius: 10, border: "1px solid #e3e6ea", background: "#fff", padding: "0 12px", display: "flex", alignItems: "center", boxSizing: "border-box" };
  // Contenedor de los Card Elements de Stripe: bloque simple (SIN flex/alto fijo), el
  // iframe de Stripe lo llena; el padding vertical le da la altura (~40px).
  const stripeBox: React.CSSProperties = { borderRadius: 10, border: "1px solid #e3e6ea", background: "#fff", padding: "12px 12px", boxSizing: "border-box" };
  const textInput: React.CSSProperties = { ...box, width: "100%", color: "#3a3f4a", fontSize: 15, outline: "none", fontFamily: "inherit" };
  const cardIcon = (active: boolean) => (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={active ? BLUE : "#8a8f99"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" />
    </svg>
  );
  const radio = (active: boolean) => (
    <span style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${active ? BLUE : "#b8bcc4"}`, display: "grid", placeItems: "center", flexShrink: 0 }}>
      {active && <span style={{ width: 9, height: 9, borderRadius: "50%", background: BLUE }} />}
    </span>
  );

  const cardFields = (kind: "credit" | "debit") => (
    <div style={{ display: "grid", gap: 14, padding: "6px 2px 18px" }}>
      <div>
        <label style={label}>{tWallet("payCardNumberLabel")}</label>
        <div id={`${ID_NUMBER}-${kind}`} style={stripeBox} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label style={label}>{tWallet("payCardExpiryLabel")}</label><div id={`${ID_EXP}-${kind}`} style={stripeBox} /></div>
        <div><label style={label}>CVC</label><div id={`${ID_CVC}-${kind}`} style={stripeBox} /></div>
      </div>
      <div>
        <label style={label}>{tWallet("payCardNameLabel")}</label>
        <style>{`.vibra-pay-input::placeholder{color:#9aa0a8;opacity:1}`}</style>
        <input className="vibra-pay-input" value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder={tWallet("payCardNamePlaceholder")} autoComplete="cc-name" disabled={submitting} style={textInput} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
        <span style={{ fontSize: 13, color: "#8a8f99", fontWeight: 500 }}>{tWallet("paySaveCard")}</span>
        <button type="button" role="switch" aria-checked={saveCard} aria-label={tWallet("paySaveCardToggle")} onClick={() => setSaveCard((v) => !v)} disabled={submitting}
          style={{ position: "relative", width: 40, height: 22, borderRadius: 999, border: "none", padding: 0, flexShrink: 0, cursor: submitting ? "not-allowed" : "pointer", background: saveCard ? BLUE : "#d4d7dc", transition: "background 180ms ease" }}>
          <span style={{ position: "absolute", top: 2, insetInlineStart: saveCard ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 180ms ease", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
        </button>
      </div>
    </div>
  );

  const rowButton: React.CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "15px 2px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" };
  const rowDivider: React.CSSProperties = { borderBottom: "1px solid #eceef1" };

  function newCardRow(kind: "credit" | "debit", title: string) {
    const active = selectedMethod === kind;
    return (
      <div key={kind} style={rowDivider}>
        <button type="button" onClick={() => toggleMethod(kind)} style={rowButton}>
          {cardIcon(active)}
          <span style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", flex: 1, textAlign: "start" }}>{title}</span>
          {radio(active)}
        </button>
        <div style={{ display: "grid", gridTemplateRows: active ? "1fr" : "0fr", transition: "grid-template-rows 300ms cubic-bezier(0.4,0,0.2,1)" }}>
          <div style={{ overflow: "hidden", opacity: active ? 1 : 0, transition: "opacity 260ms ease" }}>
            {(active || renderedMethod === kind) && cardFields(kind)}
          </div>
        </div>
      </div>
    );
  }

  function savedCardRow(card: SavedCard) {
    const id = `saved:${card.id}`;
    const active = selectedMethod === id;
    const brandLabel = card.brandName ? card.brandName : card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : "Tarjeta";
    return (
      <div key={id} style={rowDivider}>
        <button type="button" onClick={() => toggleMethod(id)} style={rowButton}>
          {cardIcon(active)}
          <span style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", flex: 1, textAlign: "start" }}>{brandLabel} ···· {card.lastFour ?? "••••"}</span>
          {radio(active)}
        </button>
        {/* Invitado: re-pide el CVV de la tarjeta guardada (sin volver a teclear el número). */}
        {isGuest && (
          <div style={{ display: "grid", gridTemplateRows: active ? "1fr" : "0fr", transition: "grid-template-rows 300ms cubic-bezier(0.4,0,0.2,1)" }}>
            <div style={{ overflow: "hidden", opacity: active ? 1 : 0, transition: "opacity 260ms ease" }}>
              <div style={{ display: "grid", gap: 6, padding: "2px 2px 16px", maxWidth: 170 }}>
                <label style={label}>CVV</label>
                <div id={`vibra-saved-cvc-${card.id}`} style={stripeBox} />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // País del comprador sin habilitar para venta: se avisa ANTES de que teclee la tarjeta.
  // Sin esto el formulario se ve normal, el comprador captura todo y el backend rechaza al
  // final con un error genérico — la peor manera de enterarse.
  // `null` = todavía no se resolvió la cookie de país; no se bloquea nada mientras tanto.
  const countryBlocked = pf.buyerCountry != null && !isChargeableCountry(pf.buyerCountry);

  const blockedNotice = (
    <div style={{ position: "relative", padding: stacked ? "24px 18px 24px" : "28px 24px 24px", minWidth: 0 }}>
      <button type="button" onClick={onClose} aria-label={tCommon("close")}
        style={{ position: "absolute", top: 8, insetInlineEnd: 10, zIndex: 2, border: "none", background: "none", color: "#9aa0a8", cursor: "pointer", fontSize: 26, lineHeight: 1, padding: 4 }}>×</button>

      {stacked && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <VibraPayBrand />
        </div>
      )}

      <div style={{ display: "grid", gap: 10, padding: "28px 4px", textAlign: "center" }}>
        <div style={{ fontSize: 34, lineHeight: 1 }} aria-hidden="true">🌎</div>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 650, color: "#1f2430" }}>
          {tWallet("blockedCountryTitle")}
        </h3>
        <p style={{ margin: 0, fontSize: 13.5, color: "#5b616e", lineHeight: 1.55 }}>
          {tWallet("blockedCountryBody")}
        </p>
      </div>
    </div>
  );

  const leftColumn = (
    <div style={{ position: "relative", padding: stacked ? "24px 18px 4px" : "28px 24px 24px", minWidth: 0 }}>
      <button type="button" onClick={() => { if (!submitting) onClose(); }} aria-label={tCommon("close")}
        style={{ position: "absolute", top: 8, insetInlineEnd: 10, zIndex: 2, border: "none", background: "none", color: "#9aa0a8", cursor: submitting ? "not-allowed" : "pointer", fontSize: 26, lineHeight: 1, padding: 4 }}>×</button>

      {stacked && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <VibraPayBrand />
        </div>
      )}

      {!hideBuyerGreeting && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 42, height: 42, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "#e6e8ec", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {buyer?.photo ? (
              <img src={buyer.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              // Sin foto (invitado): ícono de persona genérica.
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#9aa0a8" aria-hidden="true">
                <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5z" />
              </svg>
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, color: "#9aa0a8" }}>{tWallet("payWelcome")}</div>
            {collectNickname ? (
              <input
                type="text"
                value={nickname}
                onChange={(e) => { const v = e.target.value.slice(0, GUEST_NICKNAME_MAX); setNickname(v); setGuestNickname(v); }}
                placeholder={tWallet("payNicknamePlaceholder")}
                maxLength={GUEST_NICKNAME_MAX}
                aria-label={tWallet("payNicknameLabel")}
                style={{ width: "100%", border: "none", borderBottom: "1px solid #e0e3e8", outline: "none", fontSize: 15, fontWeight: 600, color: "#3a3f4a", fontFamily: "inherit", padding: "2px 0", background: "transparent" }}
              />
            ) : (
              buyer?.name && <div style={{ fontSize: 15, fontWeight: 600, color: "#3a3f4a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{buyer.name}</div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#3a3f4a" }}>{paymentHeading ?? tWallet("payHeading")}</h4>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#9aa0a8", fontWeight: 400 }}>{tWallet("payChooseMethod")}</p>
      </div>

      {loading ? (
        <p style={{ color: "#8a8f99", fontSize: 14 }}>{tWallet("payLoadingSecure")}</p>
      ) : (
        <div style={{ display: "grid" }}>
          {/* Crédito disponible: método MEZCLABLE, con la MISMA estética que las tarjetas.
              Va PRIMERO. Si cubre el total, se ocultan los demás métodos (no deja elegir otro);
              si no alcanza, se piden además para el restante. */}
          {creditEnabled && (
            <div style={rowDivider}>
              <button type="button" onClick={() => { setUseCredit((v) => !v); setError(null); }} style={rowButton}>
                {/* Icono de billetera, mismo trazo que el de tarjeta. */}
                <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={useCredit ? BLUE : "#8a8f99"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2" /><rect x="3" y="7" width="18" height="12" rx="2.5" /><path d="M16 12.5h3" />
                </svg>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", flex: 1, textAlign: "start" }}>
                  {tWallet("creditAvailable")} <span style={{ color: "#8a8f99", fontWeight: 500 }}>· {formatCurrency(creditBalance, credit.currency || SETTLEMENT_CURRENCY, pf.locale, { code: true })}</span>
                </span>
                {radio(useCredit)}
              </button>
              <div style={{ display: "grid", gridTemplateRows: useCredit ? "1fr" : "0fr", transition: "grid-template-rows 300ms cubic-bezier(0.4,0,0.2,1)" }}>
                <div style={{ overflow: "hidden", opacity: useCredit ? 1 : 0, transition: "opacity 240ms ease" }}>
                  <p style={{ margin: "6px 2px 12px 36px", fontSize: 12, color: creditCoversAll ? "#16a34a" : "#8a8f99" }}>
                    {creditCoversAll
                      ? tWallet("payCreditCoversAll")
                      : tWallet("creditMissingAmount", {
                          amount: remainderAfterCredit != null ? pf.format(remainderAfterCredit, { baseCurrency: SETTLEMENT_CURRENCY, code: true }) : "",
                        })}
                  </p>
                </div>
              </div>
            </div>
          )}
          {/* Con el crédito cubriendo el total, no deja elegir otro método: se ocultan
              SUAVEMENTE (colapso de alto + fundido), igual que el acordeón de tarjeta. */}
          <div style={{ display: "grid", gridTemplateRows: creditCoversAll ? "0fr" : "1fr", transition: "grid-template-rows 340ms cubic-bezier(0.4,0,0.2,1)" }}>
            <div style={{ overflow: "hidden", opacity: creditCoversAll ? 0 : 1, transition: "opacity 240ms ease" }}>
              {newCardRow("credit", tWallet("payCardCredit"))}
              {newCardRow("debit", tWallet("payCardDebit"))}
              {effectiveSavedCards.map((c) => savedCardRow(c))}
            </div>
          </div>

          {/* El alta, DEBAJO de los metodos de pago. No es un paso aparte: se
              llena de corrido con la tarjeta y se resuelve al pagar. */}
          {collectAccount && (
            // ⚠️ SIN linea propia arriba: la ultima fila de metodos de pago ya
            // trae la suya por abajo, y poner otra dibujaba dos seguidas.
            <div ref={cuentaRef} style={{ display: "grid", gap: 8, paddingTop: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#3a3f4a" }}>
                {tExpress("title")}
              </span>
              <span style={{ fontSize: 12.5, color: "#8a8f99", lineHeight: 1.45 }}>
                {tExpress("subtitle")}
              </span>
              <input
                className="vibra-pay-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={acctEmail}
                onChange={(e) => {
                  setAcctEmail(e.target.value);
                  // Cambio el correo: lo que se sabia del anterior ya no vale.
                  setAcctExists(null);
                }}
                onBlur={() => {
                  if (!acctEmailOk) return;
                  // Se pregunta ANTES de cobrar: decide si se enlaza sobre la
                  // sesion de invitado o se entra a una cuenta que ya existia.
                  void emailHasAccount(acctEmail).then(setAcctExists);
                }}
                placeholder={tReg("emailPlaceholder")}
                aria-label={tReg("emailLabel")}
                disabled={submitting}
                style={textInput}
              />
              {acctEmail.trim().length > 0 && !acctEmailOk && (
                <span style={{ fontSize: 12.5, color: "#dc2626" }}>{tShared("errInvalidEmail")}</span>
              )}
              {acctExists === true && (
                <span style={{ fontSize: 12.5, color: "#b45309", lineHeight: 1.45 }}>
                  {tExpress("emailHasAccount")}
                </span>
              )}
              <input
                className="vibra-pay-input"
                type="password"
                autoComplete={acctExists ? "current-password" : "new-password"}
                value={acctPassword}
                onChange={(e) => setAcctPassword(e.target.value)}
                onFocus={() => {
                  // Segunda oportunidad para saber si ese correo ya tiene cuenta.
                  //
                  // La pregunta se lanza al salir del campo del correo, y si
                  // aquella vez falló se queda sin saberse. Eso importa: sin
                  // saberlo se exige contraseña FUERTE, y alguien con una cuenta
                  // vieja no puede escribir la suya ni habilitar el botón. Aquí
                  // no cuesta nada volver a preguntar.
                  if (acctExists !== null || !acctEmailOk) return;
                  void emailHasAccount(acctEmail).then(setAcctExists);
                }}
                // ⚠️ NO el marcador de siempre, que dice "Minimo 6 caracteres" y
                // no es verdad: la politica del proyecto pide bastante mas. Los
                // requisitos completos van debajo, donde caben enteros.
                placeholder={tReg("passwordLabel")}
                aria-label={tReg("passwordLabel")}
                disabled={submitting}
                style={textInput}
              />
              {/* Los requisitos se dicen ANTES de fallar, no despues.
                  Se ensenan en gris desde el principio y se ponen en rojo solo
                  cuando ya hay algo escrito que no los cumple: asi son una guia
                  mientras se escribe y un aviso cuando hace falta. */}
              {acctExists !== true && (
                <span
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.45,
                    color: acctPassword.length > 0 && !acctPasswordOk ? "#dc2626" : "#8a8f99",
                  }}
                >
                  {tReg("errPasswordWeak")}
                </span>
              )}
              {acctExists !== true && (
                <input
                  className="vibra-pay-input"
                  type="password"
                  autoComplete="new-password"
                  value={acctConfirm}
                  onChange={(e) => setAcctConfirm(e.target.value)}
                  placeholder={tReg("confirmPasswordPlaceholder")}
                  aria-label={tReg("confirmPasswordLabel")}
                  disabled={submitting}
                  style={textInput}
                />
              )}
              {acctExists !== true && acctConfirm.length > 0 && acctPassword !== acctConfirm && (
                <span style={{ fontSize: 12.5, color: "#dc2626" }}>{tReg("passwordMismatch")}</span>
              )}
            </div>
          )}

          {/* Ya hay cuenta en esta sesion, asi que no se pide nada. Pero SI se
              dice a nombre de quien va a quedar la compra, y se deja cambiarlo.
              Sin esto, la segunda compra se cobraba en silencio al correo de la
              primera y no habia forma de usar otro. */}
          {!collectAccount && accountEmail && (
            <div
              style={{
                borderTop: "1px solid rgba(0,0,0,0.08)",
                marginTop: 14,
                paddingTop: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 13, color: "#4b5563", minWidth: 0, wordBreak: "break-all" }}>
                {tServicesPay("payingAs", { email: accountEmail })}
              </span>
              {onUseAnotherAccount && (
                <button
                  type="button"
                  onClick={() => void onUseAnotherAccount()}
                  disabled={submitting}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#2563eb",
                    cursor: submitting ? "default" : "pointer",
                    textDecoration: "underline",
                  }}
                >
                  {tServicesPay("payUseAnotherEmail")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const effectiveAmount = amountEditable ? chosenAmount : amount;
  const isNonAnchor = pf.currency !== "USD";
  // En donación (amountEditable) el monto elegido es la BASE; el cargo fijo se suma en el
  // DISPLAY (el backend lo suma al cobrar). Los servicios ya reciben base + cargo fijo en `amount`.
  const chargedBase = effectiveAmount != null ? effectiveAmount + (amountEditable ? FIXED_SERVICE_FEE_USD : 0) : null;
  const totalLabel = chargedBase != null ? pf.format(chargedBase, { baseCurrency: amountCurrency, code: true }) : priceLabel ?? "";
  // El desglose se calcula con el país EFECTIVO: la IP al abrir, y el de la tarjeta en cuanto
  // se lee. Así el precio en pantalla coincide con lo que el backend va a cobrar.
  // Se formatea con la moneda que dijo el SERVIDOR. Usar la del visor aquí sería el mismo
  // fallo de antes: cifras de una moneda con la etiqueta de otra.
  const fmtServidor = (n: number) =>
    formatCurrency(n, (precioServidor?.currency ?? pf.currency) as DisplayCurrency, pf.locale, { code: true });

  const taxedLocal = chargedBase != null
    ? pf.formatWithTax(chargedBase, { baseCurrency: amountCurrency, taxCountryOverride: effectiveCountry })
    : null;

  // ⚠️ MANDA EL SERVIDOR. El cálculo local es una estimación mientras no hay tarjeta; en
  // cuanto la hay, lo que se pinta es lo que el backend va a cobrar —incluida la MONEDA,
  // que el espejo local no sabe cambiar. Si la llamada falla, `precioServidor` se queda en
  // null y se sigue con la estimación: nunca se bloquea el pago por esto.
  const taxed = precioServidor
    ? {
        applies: precioServidor.rate > 0,
        rate: precioServidor.rate,
        taxName: precioServidor.taxName,
        currency: precioServidor.currency,
        base: fmtServidor(precioServidor.base),
        tax: fmtServidor(precioServidor.tax),
        total: fmtServidor(precioServidor.total),
      }
    : taxedLocal;

  // ⚠️ El total SIEMPRE sale de `taxed.total`, que es el redondeado comercial — el MISMO
  // cálculo que la tarjeta del servicio y que el backend al cobrar. Antes, cuando el país
  // no llevaba impuesto (EE. UU.), esta pasarela caía a `totalLabel`, que es el importe
  // CRUDO: la tarjeta decía 40.99, la pasarela 40.40 y el cargo era 40.99. Tres números
  // para un solo precio.
  const totalMostrado = taxed ? `${taxed.total} ${taxed.currency}` : totalLabel;

  /** Barra gris del skeleton mientras se lee el BIN de la tarjeta. */
  const priceSkeleton = (w: number) => (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block", width: w, height: "1em", borderRadius: 4, verticalAlign: "middle",
        background: "linear-gradient(90deg,#eceef1 25%,#f5f6f8 50%,#eceef1 75%)",
        backgroundSize: "200% 100%", animation: "vibraSkeleton 1.1s ease-in-out infinite",
      }}
    />
  );

  const rightColumn = (
    <div style={{ position: "relative", padding: stacked ? "16px 18px 20px" : "48px 24px 24px", background: "#fff", borderInlineStart: stacked ? "none" : "1px solid #eaecef", display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 12, minWidth: 0 }}>
      {!stacked && <VibraPayBrand style={{ position: "absolute", top: 22, insetInlineEnd: 24 }} />}
      {/* Creador */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "#e6e8ec" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {avatarUrl ? <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
        </div>
        <div style={{ minWidth: 0 }}>
          {providerName && <div style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{providerName}</div>}
          {productType && <div style={{ fontSize: 12.5, color: "#6b7280" }}>{productType}</div>}
        </div>
      </div>

      {durationMinutes ? (
        <div style={{ display: "grid", gap: 10, marginTop: 2 }}>
          <div style={{ height: 1, background: "#e6e8ec" }} />
          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.4 }}>
              {tWallet.rich("payDurationLine", {
                b: (c) => <strong style={{ fontWeight: 600, color: "#3a3f4a" }}>{c}</strong>,
                minutes: durationMinutes,
              })}
            </span>
            <span style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.4 }}>
              {tWallet.rich("payModalityLine", {
                b: (c) => <strong style={{ fontWeight: 600, color: "#3a3f4a" }}>{c}</strong>,
              })}
            </span>
          </div>
        </div>
      ) : description ? (
        <div style={{ display: "grid", gap: 10, marginTop: 2 }}>
          <div style={{ height: 1, background: "#e6e8ec" }} />
          <p style={{ margin: 0, fontSize: 12.5, color: "#5b616e", lineHeight: 1.5 }}>{description}</p>
        </div>
      ) : null}

      {amountEditable ? (
        <>
          <div style={{ height: 1, background: "#e6e8ec" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {(donationPresets && donationPresets.length ? donationPresets : DEFAULT_DONATION_PRESETS_USD).map((base) => {
              const selected = selectedPreset === base;
              return (
                <button key={base} type="button"
                  onClick={() => {
                    setSelectedPreset(base); setChosenAmount(base); setTotalTecleado(null);
                    // El campo recibe EXACTAMENTE el número que enseña el botón: mismo total,
                    // misma moneda. Antes se metía el importe en USD mientras el botón
                    // mostraba el convertido, y no cuadraban.
                    setCustomAmount(String(totalLocalDesdeBaseUsd(base)));
                  }}
                  style={{ padding: "9px 2px", borderRadius: 10, border: "none", background: selected ? "#eaf6fd" : "transparent", color: selected ? BLUE : "#3a3f4a", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>
                  {/* Todo-incluido desde el inicio: (base + cargo fijo) + impuesto del país. */}
                  {pf.formatWithTax(base + FIXED_SERVICE_FEE_USD, { baseCurrency: SETTLEMENT_CURRENCY }).total}
                </button>
              );
            })}
          </div>
          <div style={{ display: "grid", gap: 6, justifyItems: "center", marginTop: 2 }}>
            <span style={{ fontSize: 12.5, color: "#6b7280", fontWeight: 600 }}>{tWallet("payOtherAmount")}</span>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: "#3a3f4a" }}>$</span>
              <input ref={amountInputRef} type="number" inputMode="decimal" min={1} className="vibra-amount-input" value={customAmount}
                onChange={(e) => {
                  const v = e.target.value; setCustomAmount(v); setSelectedPreset(null);
                  const typed = Number(v);
                  if (!Number.isFinite(typed) || typed <= 0) { setChosenAmount(null); return; }
                  // Lo tecleado es el TOTAL en la moneda del donante: lo que va a pagar.
                  // Se guarda TAL CUAL para mandárselo al servidor: es la única forma de que
                  // 100.00 se cobre como 100.00 y no se redondee al escalón comercial.
                  setTotalTecleado(typed);
                  setChosenAmount(baseUsdDesdeTotalLocal(typed));
                }}
                placeholder="0" style={{ width: 120, border: "none", borderBottom: "1px solid #eceef1", background: "transparent", fontSize: 22, fontWeight: 700, color: "#3a3f4a", textAlign: "center", outline: "none", fontFamily: "inherit", padding: "0 2px 4px" }} />
              <span style={{ fontSize: 13, color: "#9aa0a8", fontWeight: 600 }}>{pf.currency}</span>
            </div>
          </div>
          {minBaseAmount > 0 && (
            <div style={{ textAlign: "center", fontSize: 11.5, fontWeight: 600, color: belowMin ? "#c0392b" : "#9aa0a8" }}>
              {tWallet("minimumAmount", {
                amount: pf.formatWithTax(minBaseAmount + FIXED_SERVICE_FEE_USD, { baseCurrency: SETTLEMENT_CURRENCY, code: true }).total,
              })}
            </div>
          )}
          {/* Sin impuesto (p. ej. EE. UU.) también se enseña el total: es donde entra el cargo
              fijo y el redondeo comercial, y sin esta línea el donante no veía cuánto paga. */}
          {taxed != null && chosenAmount != null && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e6e8ec", display: "grid", gap: 5 }}>
              {taxed.applies && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#8a8f99" }}><span>{tWallet("paySubtotal")}</span><span>{(readingCard || pidiendoPrecio) ? priceSkeleton(58) : <>{taxed.base} {taxed.currency}</>}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#8a8f99" }}><span>{taxed.taxName} ({Math.round(taxed.rate * 100)}%)</span><span>{(readingCard || pidiendoPrecio) ? priceSkeleton(46) : <>{taxed.tax} {taxed.currency}</>}</span></div>
                </>
              )}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}><span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>{tWallet("payTotalDue")}</span><span style={{ fontSize: 16, fontWeight: 600, color: "#3a3f4a" }}>{taxed.total} {taxed.currency}</span></div>
              <div style={{ display: "grid", gridTemplateRows: useCredit && creditApplied > 0 ? "1fr" : "0fr", transition: "grid-template-rows 300ms cubic-bezier(0.4,0,0.2,1)" }}>
                <div style={{ overflow: "hidden", opacity: useCredit && creditApplied > 0 ? 1 : 0, transition: "opacity 240ms ease" }}>
                  <div style={{ display: "grid", gap: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: BLUE }}><span>{tWallet("creditAvailable")}</span><span>−{pf.formatPlain(creditApplied, { baseCurrency: SETTLEMENT_CURRENCY, code: true })}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#3a3f4a" }}><span>{creditCoversAll ? tWallet("creditPayWithBalance") : tWallet("creditRemainderOnCard")}</span><span>{pf.format(remainderAfterCredit ?? 0, { baseCurrency: SETTLEMENT_CURRENCY, code: true })}</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ height: 1, background: "#e6e8ec" }} />
          {taxed?.applies ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#8a8f99" }}><span>{tWallet("paySubtotal")}</span><span>{(readingCard || pidiendoPrecio) ? priceSkeleton(58) : <>{taxed.base} {taxed.currency}</>}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#8a8f99" }}><span>{taxed.taxName} ({Math.round(taxed.rate * 100)}%)</span><span>{(readingCard || pidiendoPrecio) ? priceSkeleton(46) : <>{taxed.tax} {taxed.currency}</>}</span></div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>{pricePeriodLabel ? "Cobro mensual" : "Total a pagar"}</span>
                <span style={{ fontSize: 17, fontWeight: 600, color: "#3a3f4a" }}>{(readingCard || pidiendoPrecio) ? priceSkeleton(78) : <>{taxed.total} {taxed.currency}{pricePeriodLabel ? ` / ${pricePeriodLabel}` : ""}</>}</span>
              </div>
              <div style={{ display: "grid", gridTemplateRows: useCredit && creditApplied > 0 ? "1fr" : "0fr", transition: "grid-template-rows 300ms cubic-bezier(0.4,0,0.2,1)" }}>
                <div style={{ overflow: "hidden", opacity: useCredit && creditApplied > 0 ? 1 : 0, transition: "opacity 240ms ease" }}>
                  <div style={{ display: "grid", gap: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: BLUE }}><span>{tWallet("creditAvailable")}</span><span>−{pf.formatPlain(creditApplied, { baseCurrency: SETTLEMENT_CURRENCY, code: true })}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#3a3f4a" }}><span>{creditCoversAll ? tWallet("creditPayWithBalance") : tWallet("creditRemainderOnCard")}</span><span>{pf.format(remainderAfterCredit ?? 0, { baseCurrency: SETTLEMENT_CURRENCY, code: true })}</span></div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>{pricePeriodLabel ? "Cobro mensual" : "Total a pagar"}</span>
              <span style={{ fontSize: 17, fontWeight: 600, color: "#3a3f4a" }}>{(readingCard || pidiendoPrecio) ? priceSkeleton(78) : <>{totalMostrado}{pricePeriodLabel ? ` / ${pricePeriodLabel}` : ""}</>}</span>
            </div>
          )}
        </>
      )}


      {/* Aviso sutil cuando la tarjeta cambió el país respecto al que dijo la IP: le explica
          al comprador por qué el precio se movió, sin agregarle un paso ni pedirle confirmar. */}
      {countryFromCard && !readingCard && (
        <p style={{ margin: "-2px 0 0", fontSize: 11, color: "#8a8f99", textAlign: "center", lineHeight: 1.35 }}>
          {tWallet.rich("payCardIssuedIn", {
            b: (c) => <strong style={{ fontWeight: 600, color: "#6b7280" }}>{c}</strong>,
            country: countryName(cardPm?.country, locale, tWallet("payCountryUnknown")),
          })}
        </p>
      )}

      <button type="button" onClick={handlePay} disabled={submitting || loading || !canPay || readingCard}
        style={{ position: "relative", overflow: "hidden", height: 40, borderRadius: 10, border: "none", background: loading || (!canPay && !submitting) ? "#9fd8f2" : BLUE, color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: submitting || loading || !canPay ? "not-allowed" : "pointer" }}>
        {submitting && <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.28)", transformOrigin: "left center", animation: "vibraBtnFill 2400ms ease-out forwards" }} />}
        <span style={{ position: "relative" }}>{submitting ? tCommon("processing") : (payButtonLabel ?? tWallet("payButton"))}</span>
      </button>


      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11, color: "#8a8f99", marginTop: -6 }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={BLUE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" />
        </svg>
        <span>
          {tWallet.rich("payProtectedBy", {
            b: (c) => <span style={{ color: BLUE, fontWeight: 600 }}>{c}</span>,
            brand: "Stripe",
          })}
        </span>
      </div>
    </div>
  );

  const successView = (
    <PaymentSuccessCard
      avatarUrl={avatarUrl}
      providerName={providerName}
      productType={productType}
      successMessage={wasHold && holdSuccessMessage ? holdSuccessMessage : successMessage}
      onClose={onClose}
      locale={locale}
      stacked={stacked}
      aside={successAside}
    />
  );

  // Vista "procesando" del reintento un-clic: mientras se cobra con la tarjeta guardada
  // NO se muestra la pasarela (solo un spinner), para saltar directo al panel verde.
  const processingView = (
    <div style={{ display: "grid", placeItems: "center", gap: 14, padding: "56px 24px", minHeight: 220 }}>
      <div style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid #e3e6ea", borderTopColor: BLUE, animation: "vibraSpin 0.8s linear infinite" }} />
      <p style={{ margin: 0, fontSize: 14, color: "#5b616e", fontWeight: 600 }}>{tWallet("payProcessingPayment")}</p>
    </div>
  );

  const keyframes = `
    @keyframes vibraSpin { to { transform: rotate(360deg); } }
    @keyframes vibraSkeleton { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @keyframes vibraPop { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
    @keyframes vibraFade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes vibraFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes vibraBtnFill { 0% { transform: scaleX(0); } 100% { transform: scaleX(1); } }
    .vibra-amount-input::-webkit-outer-spin-button, .vibra-amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .vibra-amount-input { -moz-appearance: textfield; appearance: textfield; }
  `;

  return createPortal(
    <div role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
      style={isSheet
        ? { position: "absolute", inset: 0, zIndex: 60, display: "flex", alignItems: "stretch", justifyContent: "stretch", background: "transparent" }
        : mobileSheet
          ? { position: "fixed", inset: 0, zIndex: 2147483647, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,0.55)", opacity: entered ? 1 : 0, transition: "opacity 220ms ease", willChange: "opacity" }
          : { position: "fixed", inset: 0, zIndex: 2147483647, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(0,0,0,0.55)", opacity: entered ? 1 : 0, transition: "opacity 220ms ease", willChange: "opacity" }}>
      <div ref={scrollRef} onClick={(e) => e.stopPropagation()}
        style={isSheet
          ? { position: "absolute", inset: 0, boxSizing: "border-box", overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", touchAction: "pan-y", background: "#fff", color: "#3a3f4a", paddingBottom: "var(--vb-safe-bottom, 0px)", transform: entered ? "translateY(0)" : "translateY(100%)", transition: "transform 240ms cubic-bezier(0.2,0.8,0.2,1)", willChange: "transform" }
          : mobileSheet
            ? { position: "relative", width: "100%", maxHeight: "92vh", boxSizing: "border-box", overflowY: "auto", background: "#fff", borderRadius: "16px 16px 0 0", boxShadow: "0 -12px 48px rgba(0,0,0,0.4)", color: "#3a3f4a", paddingBottom: "var(--vb-safe-bottom, 0px)", transform: entered ? "translateY(0)" : "translateY(100%)", transition: "transform 240ms cubic-bezier(0.2,0.8,0.2,1)", willChange: "transform" }
            : { position: "relative", width: isNarrow || forceStacked ? "min(100%, 440px)" : "min(100%, 660px)", maxHeight: "min(92vh, 760px)", overflowY: "auto", background: "#fff", borderRadius: 16, boxShadow: "0 24px 72px rgba(0,0,0,0.4)", color: "#3a3f4a", opacity: entered ? 1 : 0, transform: entered ? "translateY(0) scale(1)" : "translateY(10px) scale(0.985)", transition: "opacity 220ms ease, transform 240ms cubic-bezier(0.2,0.8,0.2,1)", willChange: "opacity, transform" }}>
        <style>{keyframes}</style>
        {showSuccess ? successView : autoPaying ? processingView : countryBlocked ? blockedNotice : (
          <div>
            {/* Sin desvanecido: al cobrar, `paid` y `showSuccess` se ponen en el mismo
                tick, así que esta rama ya no llega a pintarse con el pago hecho. Una
                opacidad atada a `paid` haría creer que hay una transición que no ocurre. */}
            <div style={{ display: "grid", gridTemplateColumns: stacked ? "1fr" : "1.05fr 1fr", alignItems: "stretch" }}>
              {leftColumn}
              {rightColumn}
            </div>
          </div>
        )}
      </div>
      <VibraToast toast={toast} />
    </div>,
    (isSheet ? container : null) ?? document.body
  );
}
