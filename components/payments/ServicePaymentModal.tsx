"use client";

// Panel de pago de Vibra — Mercado Pago "Secure Fields".
//
// Diseño LAPTOP estilo Mercado Libre: panel blanco, dos columnas.
//   Izquierda  → "Método de pago": contenedores APILADOS tipo acordeón.
//                  · Tarjeta de crédito (nueva) → expande con campos.
//                  · Tarjeta de débito (nueva)  → expande con campos.
//                  · Tarjetas guardadas         → se apilan abajo, seleccionables
//                    (un clic, sin CVV — Bloque 3).
//                Clic en el seleccionado lo CIERRA (toggle).
//   Derecha    → avatar + servicio + tipo de producto + total + botón "Pagar" (azul MP).
//
// MP entrega SOLO los campos sensibles como iframes PCI; el resto es NUESTRO.
// Tarjeta NUEVA pide CVV (MP lo exige para tokenizar); guardada = un clic.

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { loadMercadoPago } from "@mercadopago/sdk-js";
import VibraPayBrand from "./VibraPayBrand";
import { doc, getDoc, collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { MP_PUBLIC_KEY } from "@/lib/payments/mpConfig";
import { captureError } from "@/lib/observability/captureError";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";

// ── Tipado mínimo del SDK (no trae tipos) ────────────────────────────────────
type MpField = {
  mount: (containerId: string) => void;
  unmount: () => void;
  on: (event: string, cb: (data: unknown) => void) => void;
};
type MpFields = {
  create: (type: string, options?: unknown) => MpField;
  createCardToken: (data: {
    cardholderName?: string;
    cardId?: string;
  }) => Promise<{ id?: string }>;
};
type MpInstance = {
  fields: MpFields;
  getPaymentMethods: (args: { bin: string }) => Promise<{
    results?: Array<{
      id?: string;
      payment_type_id?: string;
      thumbnail?: string;
      secure_thumbnail?: string;
    }>;
  }>;
};
type MercadoPagoCtor = new (
  publicKey: string,
  options?: { locale?: string }
) => MpInstance;

export type PaymentCardData = {
  token: string;
  paymentMethodId?: string;
  paymentType: string;
  installments?: number;
  payerEmail?: string;
  /** Segundo token para guardar la tarjeta nueva. */
  saveToken?: string;
  /** Id de la tarjeta guardada, si se paga con una. */
  savedCardId?: string;
  /**
   * 🧾 IVA — País fiscal del comprador (ISO-2, ej. "MX"), detectado por IP. Se manda
   * al backend, que SUMA el IVA al cobro. No es dato de tarjeta; viaja aquí para que
   * los call sites que hacen `{...card}` lo reenvíen sin cambios. Ver lib/tax.
   */
  taxCountry?: string | null;
};
export type PaymentResult = { status: string };

/** Tarjeta guardada (Bloque 3). Referencias no sensibles de Firestore. */
export type SavedCard = { id: string; brand?: string; lastFour?: string; brandName?: string };

const ID_NUMBER = "vibra-mp-card-number";
const ID_EXP = "vibra-mp-card-exp";
const ID_CVV = "vibra-mp-card-cvv";
const ID_SAVED_CVV = "vibra-mp-saved-cvv";

const MP_BLUE = "#009ee3";
const MP_GREEN = "#00a650";
// Montos sugeridos de donación: anclas en USD; se muestran/convierten a la moneda del usuario.
const DONATION_PRESETS_USD = [2, 5, 10, 20];

// Placeholder sutil (mismo gris del panel), como el campo de mensaje al creador.
// backgroundColor transparente: el iframe de MP trae fondo blanco por defecto;
// transparente deja ver el gris del contenedor (evita la "franja blanca").
const FIELD_STYLE = {
  height: "100%",
  fontSize: "15px",
  color: "#3a3f4a",
  placeholderColor: "#9aa0a8",
  backgroundColor: "transparent",
};

type Props = {
  open: boolean;
  amount: number | null;
  /** El segundo argumento es el monto efectivo (útil en modo `amountEditable`). */
  pay: (card: PaymentCardData, amount?: number) => Promise<PaymentResult>;
  /** Modo donación: el comprador escribe el monto dentro del panel (el total se
   *  vuelve un input). `amount` es solo un valor inicial válido para abrir. */
  amountEditable?: boolean;
  priceLabel?: string;
  /** Si se pasa (p.ej. "mes"), el total se muestra como "$X / mes" y el rótulo
   *  cambia a "Cobro mensual" (suscripciones recurrentes). */
  pricePeriodLabel?: string;
  productType?: string;
  providerName?: string;
  avatarUrl?: string | null;
  payerEmail?: string;
  /** Descripción del servicio (bajo el avatar). Para servicios sin agenda (saludo/consejo). */
  description?: string | null;
  /** Mensaje de la pantalla de éxito. Si se pasa, al aprobarse el pago el panel
   *  NO se cierra: muestra la confirmación (verde + avatar + paloma + este texto). */
  successMessage?: string | null;
  /** Duración en minutos (servicios agendados: sesión exclusiva / tiempo contigo). */
  durationMinutes?: number | null;
  locale?: string;
  /** Presentación: "dialog" (default, diálogo centrado a pantalla completa) o
   *  "sheet" (panel contenido que se desliza desde abajo dentro de `container`). */
  presentation?: "dialog" | "sheet";
  /** Contenedor del portal en modo "sheet". Si se omite, usa document.body. */
  container?: HTMLElement | null;
  /** Oculta el saludo al comprador (avatar + "Bienvenido" + nombre). Ej: donación en vivo. */
  hideBuyerGreeting?: boolean;
  /** Encabezado de métodos de pago. Default "¿Cómo quieres pagar?". */
  paymentHeading?: string;
  /** Texto del botón de pago. Default "Pagar". */
  payButtonLabel?: string;
  /** Alinea el logo de Mercado Pago a la izquierda (en móvil). Default centrado. */
  logoLeft?: boolean;
  onClose: () => void;
  onPaid: () => void;
};

export default function ServicePaymentModal({
  open,
  amount,
  pay,
  amountEditable = false,
  priceLabel,
  pricePeriodLabel,
  productType,
  providerName,
  avatarUrl,
  payerEmail,
  description,
  successMessage,
  durationMinutes,
  locale = "es-MX",
  presentation = "dialog",
  container,
  hideBuyerGreeting = false,
  paymentHeading = "¿Cómo quieres pagar?",
  payButtonLabel = "Pagar",
  logoLeft = false,
  onClose,
  onPaid,
}: Props) {
  const isSheet = presentation === "sheet";
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Pago aprobado → arranca la secuencia de éxito (fade del formulario + pantalla verde).
  const [paid, setPaid] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  // Modo donación: monto elegido por el comprador dentro del panel.
  const [chosenAmount, setChosenAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  // Preset de donación elegido (monto MXN), o null si el usuario escribió un monto libre.
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [cardName, setCardName] = useState("");
  // Guardar tarjeta para futuras compras (activo por defecto). El guardado real
  // se conecta en el Bloque 3 (MP Customers & Cards).
  const [saveCard, setSaveCard] = useState(true);
  // Logo de la marca detectada por el BIN (lo entrega Mercado Pago).
  const [cardBrandThumb, setCardBrandThumb] = useState<string | null>(null);
  // Tarjetas guardadas del comprador (Firestore).
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  // "credit" | "debit" (tarjeta nueva) | "saved:<id>" | null
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  // Sigue a selectedMethod, pero al CERRAR se queda ~320ms para animar la salida.
  const [renderedMethod, setRenderedMethod] = useState<string | null>(null);
  // Validez de cada Secure Field (evento validityChange de MP). El botón "Pagar"
  // solo se habilita cuando los datos requeridos están completos y válidos.
  const [cardValid, setCardValid] = useState({
    number: false,
    exp: false,
    cvv: false,
    savedCvv: false,
  });
  // Si un cobro de tarjeta guardada SIN CVV falla (rechazo/3DS), forzamos re-pedirlo.
  const [forceSavedCvv, setForceSavedCvv] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  // Layout apilado (una columna): en móvil por ancho, o SIEMPRE en modo "sheet"
  // (el panel del live vive en un contenedor angosto → nunca dos columnas).
  const stacked = isNarrow || isSheet;
  // En celular (no ya en modo sheet embebido), la pasarela se presenta como
  // bottom-sheet: sube al abrir y baja al cerrar. En laptop queda como diálogo centrado.
  const mobileSheet = stacked && !isSheet;
  const [buyer, setBuyer] = useState<{ name: string; photo: string | null } | null>(null);
  // Animación de entrada/salida (no de golpe).
  const [render, setRender] = useState(false);
  const [entered, setEntered] = useState(false);

  // Formateo de moneda: MXN es lo que se cobra; la local es solo referencia (≈).
  const pf = usePriceFormat();

  const isNewCard = selectedMethod === "credit" || selectedMethod === "debit";
  const savedCardId = selectedMethod?.startsWith("saved:")
    ? selectedMethod.slice(6)
    : null;

  // Monto efectivo en MXN (lo que se cobra): en donación es el elegido; si no, el fijo.
  const mxnAmount = amountEditable ? chosenAmount : (amount ?? null);
  // Un clic sin CVV para tarjeta guardada hasta este umbral (MXN). Arriba del umbral
  // —o si un intento sin CVV falló (forceSavedCvv)— se vuelve a pedir el CVV.
  const CVV_LESS_MAX_MXN = 800;
  const savedCvvRequired = forceSavedCvv || mxnAmount == null || mxnAmount > CVV_LESS_MAX_MXN;
  // Solo dispara re-montaje de campos cuando hay tarjeta guardada seleccionada, para
  // NO remontar (y borrar) los campos de tarjeta nueva al cambiar el monto de donación.
  const savedCvvMount = !!savedCardId && savedCvvRequired;

  // El botón "Pagar" se habilita solo con los datos completos y válidos:
  //   · Tarjeta nueva  → número + vencimiento + CVV válidos + nombre escrito.
  //   · Tarjeta guardada → un clic si el monto ≤ umbral; si no, el CVV re-capturado.
  // En modo donación el monto elegido debe ser válido para poder pagar.
  const amountOk = !amountEditable || (chosenAmount != null && chosenAmount > 0);
  const canPay =
    amountOk &&
    (isNewCard
      ? cardValid.number && cardValid.exp && cardValid.cvv && cardName.trim().length > 0
      : savedCardId
        ? (savedCvvRequired ? cardValid.savedCvv : true)
        : false);

  const mpRef = useRef<MpInstance | null>(null);
  const fieldsRef = useRef<MpField[]>([]);
  const paymentMethodIdRef = useRef<string | null>(null);
  const paymentTypeRef = useRef<string>("credit_card");

  const onPaidRef = useRef(onPaid);
  const payRef = useRef(pay);
  useEffect(() => {
    onPaidRef.current = onPaid;
    payRef.current = pay;
  }, [onPaid, pay]);

  // Donación: al abrir, enfoca el input del monto (cursor listo; en móvil abre el
  // teclado). Se dispara al terminar la animación de entrada.
  const amountInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // En modo "sheet" (dentro del live) NO enfocamos: abrir el teclado de golpe
    // reflowea el layout de iOS y se revuelve todo. El usuario toca el monto cuando quiere.
    if (open && entered && amountEditable && !showSuccess && !isSheet) {
      const t = window.setTimeout(() => amountInputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open, entered, amountEditable, showSuccess, isSheet]);

  useEffect(() => {
    setMounted(true);
    const check = () => setIsNarrow(window.innerWidth <= 720);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Monta al abrir y anima; al cerrar, anima la salida y luego desmonta.
  useEffect(() => {
    if (open) {
      setRender(true);
      // Doble rAF: garantiza que el navegador PINTE el estado inicial
      // (translateY(100%)) antes de pasar a translateY(0); con un solo rAF la
      // 1ª apertura salta de golpe (no hay estado "desde" que transicionar).
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setEntered(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setEntered(false);
    const t = window.setTimeout(() => setRender(false), 240);
    return () => window.clearTimeout(t);
  }, [open]);

  // Bloquea el scroll del fondo mientras el panel está abierto. En modo "sheet"
  // el panel vive dentro de otro modal (que ya maneja su scroll) → no lo tocamos.
  useBodyScrollLock(open && !isSheet);

  // Carga el perfil del comprador (nombre + avatar) para el saludo.
  useEffect(() => {
    if (!open) return;
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setBuyer(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, "users", uid))
      .then((snap) => {
        if (cancelled) return;
        const d = snap.data();
        setBuyer({
          name:
            (typeof d?.displayName === "string" && d.displayName) ||
            (typeof d?.firstName === "string" && d.firstName) ||
            "",
          photo: typeof d?.photoURL === "string" ? d.photoURL : null,
        });
      })
      .catch(() => {
        if (!cancelled) setBuyer(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Suscribe a las tarjetas guardadas del comprador.
  useEffect(() => {
    if (!open) return;
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setSavedCards([]);
      return;
    }
    const unsub = onSnapshot(
      collection(db, "users", uid, "paymentMethods"),
      (snap) => {
        setSavedCards(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              brand: typeof data.brand === "string" ? data.brand : undefined,
              brandName: typeof data.brandName === "string" ? data.brandName : undefined,
              lastFour: typeof data.lastFour === "string" ? data.lastFour : undefined,
            };
          })
        );
      },
      () => setSavedCards([])
    );
    return () => unsub();
  }, [open]);

  // (A) Al abrir: carga el SDK y crea la instancia. Aún NO monta los campos.
  useEffect(() => {
    if (!open) return;
    if (!amount || amount <= 0) {
      setError("No se pudo determinar el precio de este servicio.");
      setLoading(false);
      return;
    }
    if (!MP_PUBLIC_KEY) {
      setError("Pagos no configurados. Falta la Public Key de Mercado Pago.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSdkReady(false);
    setSelectedMethod(null);
    setCardBrandThumb(null);
    setForceSavedCvv(false);
    setPaid(false);
    setShowSuccess(false);
    // En donación arranca vacío (placeholder listo para escribir); en el resto,
    // el monto viene fijo por prop.
    setChosenAmount(amountEditable ? null : amount ?? null);
    setCustomAmount("");
    setSelectedPreset(null);
    paymentMethodIdRef.current = null;

    (async () => {
      try {
        await loadMercadoPago();
        if (cancelled) return;
        const Ctor = (window as unknown as { MercadoPago?: MercadoPagoCtor })
          .MercadoPago;
        if (!Ctor) throw new Error("SDK de Mercado Pago no disponible.");
        mpRef.current = new Ctor(MP_PUBLIC_KEY, { locale });
        if (!cancelled) {
          setSdkReady(true);
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        setError("No se pudo cargar el pago. Intenta de nuevo.");
        setLoading(false);
        console.error("ServicePaymentModal init failed", err);
      }
    })();

    return () => {
      cancelled = true;
      mpRef.current = null;
    };
  }, [open, amount, locale]);

  // (B) Monta los Secure Fields del método seleccionado:
  //   · Tarjeta nueva  → número + vencimiento + CVV.
  //   · Tarjeta guardada → CVV SOLO si el monto supera el umbral (o tras un fallo);
  //     hasta el umbral se paga de un clic sin montar CVV.
  useEffect(() => {
    if (!open || !sdkReady || (!isNewCard && !savedCardId)) return;
    const mp = mpRef.current;
    if (!mp) return;

    let localFields: MpField[] = [];
    // Campos recién montados arrancan vacíos → inválidos.
    setCardValid({ number: false, exp: false, cvv: false, savedCvv: false });
    const isValid = (d: unknown) => {
      const errs = (d as { errorMessages?: unknown[] } | null)?.errorMessages;
      return Array.isArray(errs) && errs.length === 0;
    };
    try {
      if (isNewCard) {
        const numberField = mp.fields.create("cardNumber", {
          placeholder: "1234 1234 1234 1234",
          style: FIELD_STYLE,
        });
        const expField = mp.fields.create("expirationDate", {
          placeholder: "MM/AA",
          style: FIELD_STYLE,
        });
        const cvvField = mp.fields.create("securityCode", {
          placeholder: "CVV",
          style: FIELD_STYLE,
        });

        numberField.on("binChange", async (data) => {
          const bin = (data as { bin?: string } | null)?.bin;
          if (!bin) {
            paymentMethodIdRef.current = null;
            setCardBrandThumb(null);
            return;
          }
          try {
            const res = await mp.getPaymentMethods({ bin });
            const pm = res?.results?.[0];
            paymentMethodIdRef.current = pm?.id ?? null;
            paymentTypeRef.current =
              pm?.payment_type_id === "debit_card" ? "debit_card" : "credit_card";
            setCardBrandThumb(pm?.secure_thumbnail ?? pm?.thumbnail ?? null);
          } catch {
            paymentMethodIdRef.current = null;
            setCardBrandThumb(null);
          }
        });

        numberField.on("validityChange", (d) => setCardValid((v) => ({ ...v, number: isValid(d) })));
        expField.on("validityChange", (d) => setCardValid((v) => ({ ...v, exp: isValid(d) })));
        cvvField.on("validityChange", (d) => setCardValid((v) => ({ ...v, cvv: isValid(d) })));

        // IDs únicos por método → se monta en el contenedor del método ACTIVO.
        numberField.mount(`${ID_NUMBER}-${selectedMethod}`);
        expField.mount(`${ID_EXP}-${selectedMethod}`);
        cvvField.mount(`${ID_CVV}-${selectedMethod}`);
        localFields = [numberField, expField, cvvField];
      } else if (savedCvvMount) {
        // Tarjeta guardada arriba del umbral (o tras un intento sin CVV fallido): re-pedir CVV.
        const cvvField = mp.fields.create("securityCode", {
          placeholder: "CVV",
          style: FIELD_STYLE,
        });
        cvvField.on("validityChange", (d) => setCardValid((v) => ({ ...v, savedCvv: isValid(d) })));
        cvvField.mount(`${ID_SAVED_CVV}-${savedCardId}`);
        localFields = [cvvField];
      }
      fieldsRef.current = localFields;
    } catch (err) {
      setError("No se pudo cargar el formulario. Intenta de nuevo.");
      console.error("mount fields failed", err);
    }

    return () => {
      for (const f of localFields) {
        try {
          f.unmount();
        } catch {
          // no-op
        }
      }
      if (fieldsRef.current === localFields) fieldsRef.current = [];
    };
    // selectedMethod: al cambiar entre crédito/débito (isNewCard sigue true) el efecto
    // DEBE re-ejecutarse para re-montar los campos en el contenedor del método activo.
  }, [open, sdkReady, isNewCard, savedCardId, savedCvvMount, selectedMethod]);

  // (B.2) Al CERRAR (selectedMethod → null) mantiene el cuerpo del acordeón
  // montado ~320ms, para que la animación de altura (0fr) tenga contenido y no
  // colapse "de golpe". Al abrir/cambiar se actualiza al instante.
  useEffect(() => {
    if (selectedMethod) {
      setRenderedMethod(selectedMethod);
      return;
    }
    const t = window.setTimeout(() => setRenderedMethod(null), 320);
    return () => window.clearTimeout(t);
  }, [selectedMethod]);

  function toggleMethod(id: string) {
    setSelectedMethod((prev) => (prev === id ? null : id));
    setError(null);
    // Al cambiar de método, un nuevo intento arranca como un-clic (sin CVV forzado).
    setForceSavedCvv(false);
  }

  async function handlePay() {
    if (submitting) return;
    if (!selectedMethod) {
      setError("Elige un método de pago.");
      return;
    }
    const mp = mpRef.current;
    if (!mp) return;

    setSubmitting(true);
    setError(null);
    try {
      let card: PaymentCardData;

      if (savedCardId) {
        // Tarjeta guardada: token desde el cardId. Con monto ≤ umbral va SIN CVV
        // (un clic); arriba del umbral el SDK lee el CVV re-capturado.
        let token: { id?: string } | null = null;
        try {
          token = await mp.fields.createCardToken({ cardId: savedCardId });
        } catch {
          token = null;
        }
        if (!token?.id) {
          // Sin CVV no se pudo tokenizar → pedimos CVV y que reintente.
          if (!savedCvvRequired) {
            setForceSavedCvv(true);
            setError("Confirma tu compra escribiendo el CVV de tu tarjeta.");
            setSubmitting(false);
            return;
          }
          throw new Error("no_cvv");
        }
        card = {
          token: token.id,
          savedCardId,
          paymentType: "credit_card",
          installments: 1,
          taxCountry: pf.buyerCountry ?? null,
        };
      } else {
        // Tarjeta nueva.
        if (!cardName.trim()) throw new Error("no_name");
        const token = await mp.fields.createCardToken({ cardholderName: cardName.trim() });
        if (!token?.id) throw new Error("no_token");
        if (!paymentMethodIdRef.current) throw new Error("no_payment_method");

        // Segundo token para GUARDAR la tarjeta (best-effort) si el switch está on.
        let saveToken: string | undefined;
        if (saveCard) {
          try {
            const t2 = await mp.fields.createCardToken({ cardholderName: cardName.trim() });
            saveToken = t2?.id ?? undefined;
          } catch {
            // si no se puede generar el 2º token, simplemente no se guarda
          }
        }

        card = {
          token: token.id,
          paymentMethodId: paymentMethodIdRef.current,
          paymentType: paymentTypeRef.current,
          installments: 1,
          payerEmail: payerEmail || undefined,
          saveToken,
          taxCountry: pf.buyerCountry ?? null,
        };
      }

      // 🧾 IVA — Se manda la BASE (sin impuesto). El BACKEND suma el IVA al cobro
      // según `card.taxCountry` (ver backend/src/payments/serviceCharge.ts), para que
      // el dinero autoritativo lo determine el servidor, no el cliente. El desglose que
      // se MUESTRA (Subtotal / IVA / Total) se calcula aparte con pf.formatWithTax.
      const payAmount = (amountEditable ? chosenAmount : amount) ?? undefined;
      const res = await payRef.current(card, payAmount);
      if (res.status === "approved" || res.status === "pending") {
        if (successMessage) {
          // Servicios con pantalla de éxito (saludo/consejo): NO cerrar el panel.
          // Se desvanece el formulario y luego entra la confirmación verde.
          setPaid(true);
          onPaidRef.current(); // efectos colaterales (geo). El caller NO debe cerrar.
          window.setTimeout(() => setShowSuccess(true), 300);
        } else {
          onPaidRef.current(); // flujo legacy: el caller cierra el panel.
        }
        return;
      }
      // Rechazado: si fue un clic sin CVV, MP pudo exigirlo (o 3DS). Pedimos CVV y reintento.
      if (savedCardId && !savedCvvRequired) {
        setForceSavedCvv(true);
        setError("No pudimos procesar el pago. Confirma con el CVV de tu tarjeta e intenta de nuevo.");
        setSubmitting(false);
        return;
      }
      throw new Error("rejected");
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setError(
        code === "no_name"
          ? "Escribe el nombre como aparece en la tarjeta."
          : code === "no_cvv"
            ? "Escribe el código de seguridad (CVV)."
            : code === "no_payment_method"
              ? "Revisa el número de tarjeta."
              : "No se pudo procesar el pago. Revisa los datos e intenta de nuevo."
      );
      // Reportar solo fallos reales (SDK/tokenización/cobro), no las validaciones
      // de input del usuario ni un rechazo esperado de la tarjeta.
      if (!["no_name", "no_cvv", "no_payment_method", "rejected"].includes(code)) {
        captureError(err, { scope: "payments", extra: { where: "handlePay" } });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted || !render) return null;

  // ── Estilos (panel claro) ────────────────────────────────────────────────
  const label: React.CSSProperties = {
    fontSize: 12.5,
    fontWeight: 600,
    color: "#5b616e",
    marginBottom: 6,
    display: "block",
  };
  // Fondo blanco (los Secure Fields de MP son blancos por dentro y no se pueden
  // volver grises); un borde sutil los define sobre el panel, sin franja interna.
  const box: React.CSSProperties = {
    height: 40,
    borderRadius: 10,
    border: "1px solid #e3e6ea",
    background: "#fff",
    padding: "0 12px",
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
  };
  const textInput: React.CSSProperties = {
    ...box,
    width: "100%",
    color: "#3a3f4a",
    fontSize: 15,
    outline: "none",
    fontFamily: "inherit",
  };
  const cardIcon = (active: boolean) => (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? MP_BLUE : "#8a8f99"}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M2 10h20" />
    </svg>
  );
  const radio = (active: boolean) => (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        border: `2px solid ${active ? MP_BLUE : "#b8bcc4"}`,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      {active && <span style={{ width: 9, height: 9, borderRadius: "50%", background: MP_BLUE }} />}
    </span>
  );

  // Campos de tarjeta nueva (se renderizan DENTRO del método activo).
  const cardFields = (kind: "credit" | "debit") => (
    <div style={{ display: "grid", gap: 14, padding: "6px 2px 18px" }}>
      <div>
        <label style={label}>Número de tarjeta</label>
        <div style={{ position: "relative" }}>
          <div id={`${ID_NUMBER}-${kind}`} style={{ ...box, paddingRight: 58 }} />
          {cardBrandThumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cardBrandThumb}
              alt=""
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                width: 44,
                height: 28,
                objectFit: "contain",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={label}>Vencimiento</label>
          <div id={`${ID_EXP}-${kind}`} style={box} />
        </div>
        <div>
          <label style={label}>CVV</label>
          <div id={`${ID_CVV}-${kind}`} style={box} />
        </div>
      </div>
      <div>
        <label style={label}>Nombre en la tarjeta</label>
        <style>{`.vibra-pay-input::placeholder{color:#9aa0a8;opacity:1}`}</style>
        <input
          className="vibra-pay-input"
          value={cardName}
          onChange={(e) => setCardName(e.target.value)}
          placeholder="Como aparece en la tarjeta"
          autoComplete="cc-name"
          disabled={submitting}
          style={textInput}
        />
      </div>

      {/* Guardar tarjeta para futuras compras (activo por defecto) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 2,
        }}
      >
        <span style={{ fontSize: 13, color: "#8a8f99", fontWeight: 500 }}>
          Guardar tarjeta para futuras compras
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={saveCard}
          aria-label="Guardar tarjeta para futuras compras"
          onClick={() => setSaveCard((v) => !v)}
          disabled={submitting}
          style={{
            position: "relative",
            width: 40,
            height: 22,
            borderRadius: 999,
            border: "none",
            padding: 0,
            flexShrink: 0,
            cursor: submitting ? "not-allowed" : "pointer",
            background: saveCard ? MP_BLUE : "#d4d7dc",
            transition: "background 180ms ease",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: saveCard ? 20 : 2,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 180ms ease",
              boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
            }}
          />
        </button>
      </div>
    </div>
  );

  // Estilo de fila (sin caja; solo una línea sutil separa cada forma de pago).
  const rowButton: React.CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "15px 2px",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
  };
  // Divisor debajo de cada opción → separa opciones consecutivas y cierra la
  // lista con una línea bajo el último método (NO hay línea sobre el contenedor
  // ni en la columna derecha, así no aparece la doble línea hacia el avatar).
  const rowDivider: React.CSSProperties = { borderBottom: "1px solid #eceef1" };

  // Fila-acordeón de tarjeta NUEVA (crédito/débito). Radio a la derecha.
  function newCardRow(kind: "credit" | "debit", title: string) {
    const active = selectedMethod === kind;
    return (
      <div key={kind} style={rowDivider}>
        <button type="button" onClick={() => toggleMethod(kind)} style={rowButton}>
          {cardIcon(active)}
          <span style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", flex: 1, textAlign: "left" }}>
            {title}
          </span>
          {radio(active)}
        </button>

        {/* Cuerpo colapsable — abre/cierra suave. */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: active ? "1fr" : "0fr",
            transition: "grid-template-rows 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div
            style={{ overflow: "hidden", opacity: active ? 1 : 0, transition: "opacity 260ms ease" }}
          >
            {(active || renderedMethod === kind) && cardFields(kind)}
          </div>
        </div>
      </div>
    );
  }

  // Fila de tarjeta GUARDADA. Al seleccionar, expande el CVV (MP lo re-pide).
  function savedCardRow(card: SavedCard) {
    const id = `saved:${card.id}`;
    const active = selectedMethod === id;
    const brandLabel = card.brandName
      ? card.brandName
      : card.brand
        ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1)
        : "Tarjeta";
    return (
      <div key={id} style={rowDivider}>
        <button type="button" onClick={() => toggleMethod(id)} style={rowButton}>
          {cardIcon(active)}
          <span style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", flex: 1, textAlign: "left" }}>
            {brandLabel} ···· {card.lastFour ?? "••••"}
          </span>
          {radio(active)}
        </button>

        {/* Cuerpo colapsable — solo CVV. */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: active ? "1fr" : "0fr",
            transition: "grid-template-rows 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div
            style={{ overflow: "hidden", opacity: active ? 1 : 0, transition: "opacity 260ms ease" }}
          >
            {savedCvvRequired && (
              <div style={{ display: "grid", gap: 6, padding: "6px 2px 18px", maxWidth: 140 }}>
                <label style={label}>Código de seguridad</label>
                {(active || renderedMethod === id) && <div id={`${ID_SAVED_CVV}-${id}`} style={box} />}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const leftColumn = (
    <div
      style={{
        position: "relative",
        padding: stacked ? "24px 18px 4px" : "28px 24px 24px",
        minWidth: 0,
      }}
    >
      {/* Cerrar (arriba a la derecha de la columna 1) */}
      <button
        type="button"
        onClick={() => { if (!submitting) onClose(); }}
        aria-label="Cerrar"
        style={{
          position: "absolute",
          top: 8,
          right: 10,
          zIndex: 2,
          border: "none",
          background: "none",
          color: "#9aa0a8",
          cursor: submitting ? "not-allowed" : "pointer",
          fontSize: 26,
          lineHeight: 1,
          padding: 4,
        }}
      >
        ×
      </button>

      {/* En móvil/sheet, Mercado Pago va arriba (centrado, o a la izquierda si logoLeft). */}
      {stacked && (
        <div style={{ marginBottom: 16, display: "flex", justifyContent: logoLeft ? "flex-start" : "center" }}>
          <VibraPayBrand />
        </div>
      )}

      {/* Saludo al comprador (se oculta en contextos como la donación en vivo) */}
      {!hideBuyerGreeting && (
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            overflow: "hidden",
            flexShrink: 0,
            background: "#e6e8ec",
          }}
        >
          {buyer?.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={buyer.photo}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "#9aa0a8" }}>Bienvenido</div>
          {buyer?.name && (
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "#3a3f4a",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {buyer.name}
            </div>
          )}
        </div>
      </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#3a3f4a" }}>
          {paymentHeading}
        </h4>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#9aa0a8", fontWeight: 400 }}>
          Elige tu forma de pago
        </p>
      </div>

      {loading ? (
        <p style={{ color: "#8a8f99", fontSize: 14 }}>Cargando pago seguro…</p>
      ) : (
        <div style={{ display: "grid" }}>
          {newCardRow("credit", "Tarjeta de crédito")}
          {newCardRow("debit", "Tarjeta de débito")}
          {savedCards.map((c) => savedCardRow(c))}
        </div>
      )}
    </div>
  );

  // Con dLocal el comprador paga en SU moneda local. El total se muestra ya en su
  // moneda (con margen FX + redondeo, vía pf.format); no hay "cobro en MXN" ni
  // "aproximado". Monto efectivo: en donación el elegido, si no el precio fijo (USD ancla).
  const effectiveAmount = amountEditable ? chosenAmount : amount;
  const isNonAnchor = pf.currency !== "USD";
  // Pegamos el código ISO a mano (el "$" lo comparten USD, MXN, ARS…).
  const totalLabel =
    effectiveAmount != null ? `${pf.format(effectiveAmount)} ${pf.currency}` : priceLabel ?? "";

  // 🧾 IVA — Desglose de impuesto. El impuesto se SUMA sobre la base según el país
  // del comprador (hoy solo MX = 16%). Aplica TAMBIÉN a donaciones/propinas: son
  // contraprestación gravada, no donativos (decisión de producto 2026-07-27, ver doc
  // fiscal §6.1). En donación la base es el monto que elige el fan. Ver el cobro más
  // abajo, donde el monto enviado a la pasarela se multiplica por (1+tasa).
  const taxed = effectiveAmount != null ? pf.formatWithTax(effectiveAmount) : null;

  const rightColumn = (
    <div
      style={{
        position: "relative",
        // Deja arriba el espacio que ocupaba el logo (ahora absoluto), para que el
        // contenido quede donde estaba y el logo se pueda bajar sin empujarlo.
        padding: stacked ? "16px 18px 20px" : "48px 24px 24px",
        // Panel todo blanco (sin fondo gris): la línea divisoria separa las
        // columnas en desktop, o el resumen del formulario al apilarse en móvil.
        background: "#fff",
        // Separación entre columnas: línea vertical en desktop; al apilarse en
        // móvil, la separación es por espacio (sin línea entre métodos y avatar).
        borderLeft: stacked ? "none" : "1px solid #eaecef",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        gap: 12,
        minWidth: 0,
      }}
    >
      {/* Mercado Pago — absoluto arriba-der (no empuja el contenido). Solo laptop (dos columnas). */}
      {!stacked && (
        <VibraPayBrand style={{ position: "absolute", top: 22, right: 24 }} />
      )}

      {/* Creador */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 0 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            overflow: "hidden",
            flexShrink: 0,
            background: "#e6e8ec",
          }}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
        </div>
        <div style={{ minWidth: 0 }}>
          {providerName && (
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#3a3f4a",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {providerName}
            </div>
          )}
          {productType && (
            <div style={{ fontSize: 12.5, color: "#6b7280" }}>{productType}</div>
          )}
        </div>
      </div>

      {durationMinutes ? (
        <div style={{ display: "grid", gap: 10, marginTop: 2 }}>
          <div style={{ height: 1, background: "#e6e8ec" }} />
          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.4 }}>
              <strong style={{ fontWeight: 600, color: "#3a3f4a" }}>Duración:</strong>{" "}
              {durationMinutes} minutos
            </span>
            <span style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.4 }}>
              <strong style={{ fontWeight: 600, color: "#3a3f4a" }}>Modalidad:</strong> En línea,
              desde cualquier parte del mundo
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
          {/* 4 montos sugeridos (anclas MXN → moneda del usuario). Al elegir uno se pone en "Otro monto". */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {DONATION_PRESETS_USD.map((usd) => {
              const selected = selectedPreset === usd;
              return (
                <button
                  key={usd}
                  type="button"
                  onClick={() => {
                    setSelectedPreset(usd);
                    setChosenAmount(usd);
                    setCustomAmount(String(Math.round(pf.toDisplayForInput(usd, "USD"))));
                  }}
                  style={{ padding: "9px 2px", borderRadius: 10, border: "none", background: selected ? "#eaf6fd" : "transparent", color: selected ? MP_BLUE : "#3a3f4a", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {pf.format(usd, { code: true })}
                </button>
              );
            })}
          </div>
          <div style={{ display: "grid", gap: 6, justifyItems: "center", marginTop: 2 }}>
            <span style={{ fontSize: 12.5, color: "#6b7280", fontWeight: 600 }}>
              Otro monto
            </span>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: "#3a3f4a" }}>$</span>
              <input
                ref={amountInputRef}
                autoFocus={!isSheet}
                type="number"
                inputMode="decimal"
                min={1}
                className="vibra-amount-input"
                value={customAmount}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomAmount(v);
                  setSelectedPreset(null);
                  const n = Math.floor(Number(v));
                  if (Number.isFinite(n) && n > 0) {
                    // Escribe en su moneda → convertimos a MXN (lo que se cobra).
                    const mxn = isNonAnchor ? pf.toAnchor(n) : n;
                    setChosenAmount(mxn != null ? Math.round(mxn) : null);
                  } else {
                    setChosenAmount(null);
                  }
                }}
                placeholder="0"
                style={{
                  width: 120,
                  border: "none",
                  borderBottom: "1px solid #eceef1",
                  background: "transparent",
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#3a3f4a",
                  textAlign: "center",
                  outline: "none",
                  fontFamily: "inherit",
                  padding: "0 2px 4px",
                }}
              />
              <span style={{ fontSize: 13, color: "#9aa0a8", fontWeight: 600 }}>{pf.currency}</span>
            </div>
          </div>
          {/* 🧾 IVA — Donación: desglose sobre el monto elegido (el impuesto va SUMADO). */}
          {taxed?.applies && chosenAmount != null && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e6e8ec", display: "grid", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#8a8f99" }}>
                <span>Subtotal</span>
                <span>{taxed.base} {taxed.currency}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#8a8f99" }}>
                <span>{taxed.taxName} ({Math.round(taxed.rate * 100)}%)</span>
                <span>{taxed.tax} {taxed.currency}</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Total a pagar</span>
                <span style={{ fontSize: 16, fontWeight: 600, color: "#3a3f4a" }}>{taxed.total} {taxed.currency}</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ height: 1, background: "#e6e8ec" }} />
          {taxed?.applies ? (
            // 🧾 IVA — Desglose Subtotal / impuesto / Total (el impuesto va SUMADO).
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#8a8f99" }}>
                <span>Subtotal</span>
                <span>{taxed.base} {taxed.currency}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#8a8f99" }}>
                <span>{taxed.taxName} ({Math.round(taxed.rate * 100)}%)</span>
                <span>{taxed.tax} {taxed.currency}</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>
                  {pricePeriodLabel ? "Cobro mensual" : "Total a pagar"}
                </span>
                <span style={{ fontSize: 17, fontWeight: 600, color: "#3a3f4a" }}>
                  {taxed.total} {taxed.currency}{pricePeriodLabel ? ` / ${pricePeriodLabel}` : ""}
                </span>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>
                {pricePeriodLabel ? "Cobro mensual" : "Total a pagar"}
              </span>
              <span style={{ fontSize: 17, fontWeight: 600, color: "#3a3f4a" }}>
                {totalLabel}{pricePeriodLabel ? ` / ${pricePeriodLabel}` : ""}
              </span>
            </div>
          )}
        </>
      )}

      {error && (
        <p
          style={{
            margin: 0,
            color: "#c0392b",
            fontSize: 11,
            textAlign: "center",
          }}
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handlePay}
        disabled={submitting || loading || !canPay}
        style={{
          position: "relative",
          overflow: "hidden",
          height: 40,
          borderRadius: 10,
          border: "none",
          // Al procesar se mantiene azul (la barra clara de progreso "llena" encima).
          background: loading || (!canPay && !submitting) ? "#9fd8f2" : MP_BLUE,
          color: "#fff",
          fontSize: 15,
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: submitting || loading || !canPay ? "not-allowed" : "pointer",
        }}
      >
        {submitting && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.28)",
              transformOrigin: "left center",
              animation: "vibraBtnFill 2400ms ease-out forwards",
            }}
          />
        )}
        <span style={{ position: "relative" }}>{submitting ? "Procesando…" : payButtonLabel}</span>
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          fontSize: 11,
          color: "#8a8f99",
          marginTop: -6,
        }}
      >
        <svg
          width={13}
          height={13}
          viewBox="0 0 24 24"
          fill="none"
          stroke={MP_BLUE}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <span>
          Tu pago está protegido por{" "}
          <span style={{ color: MP_BLUE, fontWeight: 700 }}>Mercado Pago</span>
        </span>
      </div>

    </div>
  );

  // ── Pantalla de éxito (verde 2/3 + avatar + paloma + mensaje) ────────────────
  // Fecha de compra = ahora (la pantalla se muestra justo al aprobarse el pago).
  const purchaseDate = new Date().toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const successView = (
    <div style={{ height: stacked ? 480 : 440, display: "flex", flexDirection: "column", position: "relative" }}>
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        style={{
          position: "absolute",
          top: 10,
          right: 16,
          zIndex: 2,
          border: "none",
          background: "transparent",
          color: "#fff",
          fontSize: 32,
          lineHeight: 1,
          padding: 2,
          cursor: "pointer",
        }}
      >
        ×
      </button>

      {/* Fecha de compra — arriba, centrada */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 0,
          right: 0,
          zIndex: 2,
          textAlign: "center",
          color: "rgba(255,255,255,0.85)",
          fontSize: 13,
          fontWeight: 500,
          pointerEvents: "none",
          animation: "vibraFade 300ms ease both",
        }}
      >
        {purchaseDate}
      </div>

      {/* Verde — dos tercios superiores */}
      <div
        style={{
          flex: 2,
          background: MP_GREEN,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: 7,
          padding: "88px 24px 14px",
          animation: "vibraFade 300ms ease both",
        }}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={providerName ?? ""}
            style={{
              width: 128,
              height: 128,
              borderRadius: "50%",
              objectFit: "cover",
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
              animation: "vibraPop 460ms cubic-bezier(0.2,0.9,0.2,1.2) both",
              animationDelay: "120ms",
            }}
          />
        ) : null}
        {providerName ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span
              style={{
                color: "#fff",
                fontSize: 20,
                fontWeight: 600,
                textAlign: "center",
                animation: "vibraFade 360ms ease both",
                animationDelay: "260ms",
              }}
            >
              {providerName}
            </span>
            {productType ? (
              <span
                style={{
                  color: "rgba(255,255,255,0.75)",
                  fontSize: 15,
                  fontWeight: 500,
                  textAlign: "center",
                  animation: "vibraFade 360ms ease both",
                  animationDelay: "340ms",
                }}
              >
                {productType}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Blanco — tercio inferior */}
      <div
        style={{
          flex: 1,
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: "18px 28px 26px",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            color: "#5b616e",
            textAlign: "center",
            lineHeight: 1.5,
            maxWidth: 380,
            animation: "vibraFadeUp 420ms ease both",
            animationDelay: "420ms",
          }}
        >
          {successMessage}
        </p>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: MP_GREEN,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "vibraPop 480ms cubic-bezier(0.2,0.9,0.2,1.25) both",
            animationDelay: "560ms",
          }}
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.2 4.2L19 7" />
          </svg>
        </div>
      </div>
    </div>
  );

  const successKeyframes = `
    @keyframes vibraPop {
      0% { transform: scale(0); opacity: 0; }
      60% { transform: scale(1.08); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes vibraFade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes vibraFadeUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes vibraBtnFill {
      0% { transform: scaleX(0); }
      100% { transform: scaleX(1); }
    }
    /* Input de monto (donación): sin flechitas de subir/bajar. */
    .vibra-amount-input::-webkit-outer-spin-button,
    .vibra-amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .vibra-amount-input { -moz-appearance: textfield; appearance: textfield; }
  `;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      style={
        isSheet
          ? {
              // Panel contenido: llena el contenedor (que debe ser position:relative)
              // y se desliza desde abajo, sin backdrop oscuro (cubre todo el área).
              position: "absolute",
              inset: 0,
              zIndex: 60,
              display: "flex",
              alignItems: "stretch",
              justifyContent: "stretch",
              background: "transparent",
            }
          : mobileSheet
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 2147483647,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              background: "rgba(0,0,0,0.55)",
              opacity: entered ? 1 : 0,
              transition: "opacity 220ms ease",
              willChange: "opacity",
            }
          : {
              position: "fixed",
              inset: 0,
              zIndex: 2147483647,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
              background: "rgba(0,0,0,0.55)",
              opacity: entered ? 1 : 0,
              transition: "opacity 220ms ease",
              willChange: "opacity",
            }
      }
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={
          isSheet
            ? {
                position: "relative",
                width: "100%",
                height: "100%",
                boxSizing: "border-box",
                overflowY: "auto",
                background: "#fff",
                color: "#3a3f4a",
                // La card blanca llena el safe-area inferior; el padding evita que el
                // contenido quede debajo del home-indicator.
                paddingBottom: "var(--vb-safe-bottom, 0px)",
                transform: entered ? "translateY(0)" : "translateY(100%)",
                transition: "transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                willChange: "transform",
              }
            : mobileSheet
            ? {
                position: "relative",
                width: "100%",
                maxHeight: "92vh",
                boxSizing: "border-box",
                overflowY: "auto",
                background: "#fff",
                borderRadius: "16px 16px 0 0",
                boxShadow: "0 -12px 48px rgba(0,0,0,0.4)",
                color: "#3a3f4a",
                paddingBottom: "var(--vb-safe-bottom, 0px)",
                transform: entered ? "translateY(0)" : "translateY(100%)",
                transition: "transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                willChange: "transform",
              }
            : {
                position: "relative",
                width: isNarrow ? "min(100%, 440px)" : "min(100%, 660px)",
                maxHeight: "92vh",
                overflowY: "auto",
                background: "#fff",
                borderRadius: 16,
                boxShadow: "0 24px 72px rgba(0,0,0,0.4)",
                color: "#3a3f4a",
                opacity: entered ? 1 : 0,
                transform: entered ? "translateY(0) scale(1)" : "translateY(10px) scale(0.985)",
                transition: "opacity 220ms ease, transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                willChange: "opacity, transform",
              }
        }
      >
        <style>{successKeyframes}</style>
        {showSuccess ? (
          successView
        ) : (
          <div style={{ opacity: paid ? 0 : 1, transition: "opacity 280ms ease" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: stacked ? "1fr" : "1.05fr 1fr",
                alignItems: "stretch",
              }}
            >
              {leftColumn}
              {rightColumn}
            </div>
          </div>
        )}
      </div>
    </div>,
    (isSheet ? container : null) ?? document.body
  );
}
