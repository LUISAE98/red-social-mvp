"use client";

// Compra de un saludo o consejo desde una historia.
//
// Extraído de StoryViewer para que el visor de círculos y el slide del feed de
// reels compartan el mismo flujo, que son dos modales encadenados (recoger el
// encargo, luego cobrar) más el registro geográfico de la compra.
//
// La puerta de identidad vive en `resolveBuyer`, y NO decide por su cuenta: la
// estrategia la pone la superficie que monta el feed (ver `purchaseIdentity`).
// En la app, sin sesión, manda a login. En Vibra Express firma como invitado y
// deja seguir, porque sacar a alguien a una pantalla de login en mitad del
// impulso de compra es perderlo.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import { ensureGuestAuth } from "@/lib/guest/ensureGuestAuth";
import { marcarCambioDeCuenta } from "@/lib/auth/sessionSwap";
import { usePurchaseIdentityMode } from "./purchaseIdentity";
import type { StoryType } from "@/lib/stories/types";
import { createGreetingRequest } from "@/lib/greetings/greetingRequests";
import { createGreetingStripeIntent } from "@/lib/stripe/stripePayments";
import { FIXED_SERVICE_FEE_USD, SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { getServiceByType, getVisibleServices } from "@/lib/services/normalizeServices";
import { attachGuestAccount } from "@/lib/guest/guestAccount";
import { useCreatorProfile } from "@/lib/reels/creatorProfiles";
import { frenarReelFeed } from "@/lib/reels/reelFeedRefresh";
import { registrarCompraGeo } from "@/lib/wallet/registrarCompraGeo";
import CreatorServiceModals from "@/components/services/CreatorServiceModals";
import CompleteProfileAside from "@/components/payments/CompleteProfileAside";
import StripePaymentModal from "@/components/payments/StripePaymentModal";

const FONT = "inherit";

type Params = {
  /** Creador que grabó el saludo, que es a quien se le encarga el nuevo. */
  creatorId: string | null;
  creatorName: string | null;
  creatorPhoto: string | null;
  type: StoryType;
  /** De dónde nace el encargo, perfil o comunidad. */
  source: "profile" | "group";
  groupId: string | null;
};

export function useGreetingPurchase({
  creatorId,
  creatorName,
  creatorPhoto,
  type,
  source,
  groupId,
}: Params) {
  const tWallet = useTranslations("wallet");
  const tServices = useTranslations("services");
  const tExpress = useTranslations("auth.express");
  const tRegister = useTranslations("auth.register");
  const tAuth = useTranslations("auth.shared");
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const identityMode = usePurchaseIdentityMode();
  const pf = usePriceFormat();
  /**
   * Hay que pedir correo y contrasena DENTRO de la pasarela.
   *
   * Solo en Vibra Express y solo sin cuenta real. Un saludo llega dias
   * despues, asi que sin una identidad recuperable la compra se pierde. Un
   * boleto de live se usa al instante, y por eso ese si se cobra sin cuenta.
   */
  /**
   * Se pidió comprar a nombre de otro correo.
   *
   * Vive aquí, en la pantalla, y no en la sesión de Firebase: querer usar otro
   * correo no es motivo para cerrar la sesión que hay. La identidad se resuelve
   * al cobrar.
   */
  const [pedirOtraCuenta, setPedirOtraCuenta] = useState(false);

  const necesitaCuenta =
    identityMode === "guest" && (pedirOtraCuenta || !user || !!user.isAnonymous);

  /**
   * Con qué cuenta se está comprando en Vibra Express.
   *
   * ⚠️ Tras la primera compra la sesión ya es real, así que la segunda no vuelve
   * a pedir nada y se cobra en silencio a esa misma cuenta. Quien llegó a Vibra
   * Express sin sesión no tiene por qué saber que eso pasó, y si quiere comprar
   * a nombre de otro correo se encontraba sin salida.
   *
   * Con esto la pasarela dice a nombre de quién va y deja cambiarlo.
   */
  const cuentaEnUso =
    identityMode === "guest" && !pedirOtraCuenta && user && !user.isAnonymous
      ? (user.email ?? null)
      : null;

  const [formOpen, setFormOpen] = useState(false);
  const [toName, setToName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [allowStory, setAllowStory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // El alta expres, entre el encargo y el cobro.
  // Precio de este servicio, todo incluido y en la moneda de quien mira.
  //
  // El boton sabe pintarlo desde siempre, pero este flujo nunca se lo pasaba:
  // el perfil del creador si, el reel no. Sin precio, la persona pulsa
  // "Continuar al pago" sin saber cuanto va a pagar.
  //
  // Se lee del documento del creador, que es de lectura publica, asi que
  // funciona igual sin sesion.
  //
  // ⚠️ Sale del lector COMPARTIDO de creadores, no de una suscripcion propia de
  // este hook. Antes cada panel abria la suya y el mismo documento se leia por
  // cuatro caminos distintos sin enterarse unos de otros; el boton de comprar,
  // que cuelga de esta lectura, faltaba en perfiles que SI tenian el servicio a
  // la venta solo porque su lectura aun no habia llegado. Compartiendo, un
  // creador ya conocido resuelve en el primer pintado, sin espera.
  const creatorProfile = useCreatorProfile(creatorId);

  /**
   * Precio y disponibilidad, derivados de lo que hay ahora mismo.
   *
   * Derivado y no en estado: un estado que copia lo leido siempre va un pintado
   * por detras, y ese desfase es justo lo que se veia como inestabilidad.
   *
   * `available` es de tres estados a proposito. `null` = todavia no se sabe, y
   * no puede confundirse con `false` = no lo vende: uno pinta esqueleto y el
   * otro no pinta nada.
   */
  const { priceLabel, basePrice, available, servicio } = useMemo(() => {
    if (!creatorId || creatorProfile === undefined) {
      return {
        priceLabel: undefined as string | undefined,
        basePrice: null as number | null,
        available: null as boolean | null,
        servicio: null as ReturnType<typeof getServiceByType>,
      };
    }
    // ⚠️ La MISMA definicion de "a la venta" que usa el perfil del creador
    // (`getVisibleServices`): encendido, visible y del ambito que toca. Con
    // `getServiceByType` a secas, un servicio APAGADO seguia ensenando su boton
    // en el reel aunque en el perfil ya no apareciera.
    const service =
      getVisibleServices(creatorProfile.offerings, source).find((s) => s.type === type) ?? null;
    const price = service?.publicPrice ?? service?.memberPrice ?? null;
    // ⚠️ Encendido NO basta: sin precio no se puede vender. Un servicio sin
    // importe ensenaba el boton, dejaba llenar el formulario y la pasarela se
    // plantaba con "no se pudo determinar el precio". Para quien mira, un
    // servicio sin precio y uno apagado son lo mismo: no esta a la venta.
    const seVende = !!service && typeof price === "number" && price > 0;
    return {
      priceLabel:
        typeof price === "number"
          ? // Total todo incluido: base del creador, cargo fijo e impuesto del
            // pais de quien mira. Es lo que se le va a cobrar.
            pf.formatWithTax(price + FIXED_SERVICE_FEE_USD, {
              baseCurrency: SETTLEMENT_CURRENCY,
              code: true,
            }).total
          : undefined,
      basePrice: typeof price === "number" ? price : null,
      available: seVende,
      servicio: service,
    };
  }, [creatorId, creatorProfile, type, source, pf]);
  const [payOpen, setPayOpen] = useState(false);
  /**
   * Correo con el que se dio de alta esta compra, si llego sin cuenta.
   *
   * Se guarda porque el aviso final lo necesita y para entonces ya no hay forma
   * de saberlo: en cuanto la cuenta queda enlazada, la sesion deja de ser de
   * invitado.
   */
  const [correoAlta, setCorreoAlta] = useState<string | null>(null);

  /**
   * Correo al que se le va a avisar, para el panel de compra hecha.
   *
   * ⚠️ NO basta con el del alta recién hecha. La segunda compra en Vibra
   * Express ya no da de alta nada —la sesión es real desde la primera—, y sin
   * esto se quedaba sin el aviso justo igual que antes. Lo que importa no es si
   * la cuenta se acaba de crear, sino que esta persona llegó por Vibra Express
   * y necesita saber por dónde le llega lo que compró.
   */
  const correoDelAviso = correoAlta ?? cuentaEnUso;

  /**
   * Moneda en la que el creador puso su precio.
   *
   * Es la misma lectura que hace el perfil del creador. Casi siempre es la de
   * liquidacion, pero un servicio antiguo puede traer la suya, y adivinarla es
   * justo lo que hacia que la pasarela ensenara un importe y se cobrara otro.
   */
  const monedaDelServicio = servicio?.currency ?? SETTLEMENT_CURRENCY;
  /** El cobro de esta apertura ya se hizo. Decide que se cierra al salir. */
  const [compraHecha, setCompraHecha] = useState(false);
  const [payRequestId, setPayRequestId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState<number | null>(null);

  /**
   * ¿Hay identidad para comprar? Si no, se resuelve según la estrategia.
   *
   * Como invitado NO se pide correo aquí: se firma anónimamente y el encargo
   * queda ligado a ese uid. El correo y la contraseña se piden en la pasarela
   * y se ENLAZAN sobre ese mismo uid, así la compra que ya se hizo no queda
   * colgada de una identidad que se abandona.
   */
  const resolveBuyer = useCallback(async (): Promise<boolean> => {
    if (user) return true;
    if (identityMode === "guest") {
      try {
        await ensureGuestAuth();
        return true;
      } catch {
        return false;
      }
    }
    router.push(`/login?next=${encodeURIComponent(pathname)}`);
    return false;
  }, [user, identityMode, router, pathname]);

  const open = useCallback(async () => {
    if (!(await resolveBuyer())) return;
    setToName("");
    setInstructions("");
    setAllowStory(false);
    setError(null);
    setSuccess(null);
    setFormOpen(true);
  }, [resolveBuyer]);

  // Sin esto, "no encuentro el servicio", "lo encuentro apagado", "lo encuentro
  // sin precio" y "el precio esta en un campo que no miro" se ven todos igual:
  // un boton que no sale. Solo cuando ya se leyo al creador, para no avisar de
  // algo que simplemente todavia no ha llegado.
  useEffect(() => {
    if (!creatorId || creatorProfile === undefined || available !== false) return;
    console.warn("[useGreetingPurchase] no esta a la venta:", type, "en", source, {
      creador: creatorId,
      encontrado: servicio,
      ofertasDelCreador: Array.isArray(creatorProfile.offerings)
        ? (creatorProfile.offerings as Array<Record<string, unknown>>).map((o) => ({
            type: o?.type,
            enabled: o?.enabled,
            visible: o?.visible,
            sourceScope: o?.sourceScope,
            publicPrice: o?.publicPrice,
            memberPrice: o?.memberPrice,
            price: o?.price,
          }))
        : creatorProfile.offerings,
    });
  }, [creatorId, creatorProfile, available, servicio, type, source]);

  // ⚠️ Con el formulario o la pasarela abiertos, el feed de debajo se congela.
  //
  // No es una precaucion teorica. En Vibra Express, entrar con un correo que ya
  // tenia cuenta cambia el uid a mitad del cobro; el feed se rearmaba, la lista
  // de paneles cambiaba, y el panel que desaparecia se llevaba por delante esta
  // misma pasarela y su pantalla verde. Se cobraba y no se veia la confirmacion.
  //
  // Y con ellos abiertos, CUALQUIER cambio de sesión es parte de la compra.
  //
  // ⚠️ Aquí se cambia de sesión más veces de las que parece: al dar de alta se
  // enlaza y se vuelve a entrar; con un correo que ya existía se entra directo;
  // y «usar otro correo» cierra una sesión y abre otra. Cada una de esas es,
  // vista desde el guardián de rutas, alguien que acaba de irse — y su reacción
  // es mandar a /login, que desde fuera se ve como que la página se recarga
  // sola y se lleva la compra por delante.
  //
  // Marcarlo por botón ya se intentó y se quedó corto: faltaban caminos. El
  // paraguas cubre la compra entera, que es la unidad que de verdad importa.
  // Nadie cierra sesión a propósito mientras paga.
  // Rastro de vida de la compra. Con esto, una sola prueba dice si la pasarela
  // se CERRÓ (alguien puso `payOpen` en falso) o si se DESMONTÓ con el trozo de
  // árbol donde vive, que son fallos distintos y hasta ahora se veían igual.
  useEffect(() => {
    if (!payOpen) return;
    console.info("[compra] pasarela abierta");
    return () => console.warn("[compra] pasarela DESMONTADA o cerrada");
  }, [payOpen]);

  // ⚠️ UNA sola condición, no dos.
  //
  // Con `[formOpen, payOpen]` como dependencias, pasar del formulario a la
  // pasarela re-ejecutaba este efecto: primero soltaba el freno y luego lo
  // volvía a poner. En ese hueco el freno valía CERO, y quien lo escucha
  // —el feed— se rearmaba justo ahí, borraba el panel donde vive la compra y se
  // la llevaba por delante. El freno tiene que ser continuo mientras la compra
  // esté abierta; con un solo booleano, el efecto no se re-ejecuta al pasar de
  // una parte a la otra.
  const compraAbierta = formOpen || payOpen;

  useEffect(() => {
    if (!compraAbierta) return;
    const soltarFeed = frenarReelFeed();
    const finCambio = marcarCambioDeCuenta();
    return () => {
      soltarFeed();
      // El aviso de sesión llega fuera de React y puede caer un instante DESPUÉS
      // de cerrar. Soltar en el mismo momento dejaba ese aviso tardío sin
      // paraguas, que es exactamente el fallo que esto arregla.
      setTimeout(finCambio, 2000);
    };
  }, [compraAbierta]);

  /**
   * Volver a ser invitado para comprar a nombre de otro correo.
   *
   * Se suelta el encargo que hubiera empezado: como `necesitaCuenta` vuelve a
   * ser cierto, la pasarela lo creará de nuevo bajo la identidad definitiva, al
   * cobrar. El encargo suelto se queda esperando pago y nadie lo paga, que es
   * exactamente lo que ya pasa cuando alguien abandona un carrito.
   *
   * El feed no se rearma por debajo aunque el uid cambie dos veces: hay una
   * compra abierta y eso lo tiene congelado.
   */
  /**
   * Comprar a nombre de otro correo.
   *
   * ⚠️ NO TOCA la sesión, y ese es el punto.
   *
   * Antes cerraba la sesión y abría una de invitado ahí mismo, para poder
   * enlazar otro correo después. Dos cambios de sesión en un segundo, con la
   * pasarela abierta encima, y cada uno hace temblar todo lo que depende de
   * quién eres: el feed se rearmaba, el panel donde vive esta compra se
   * borraba, y la compra se iba con él. Se intentó sostener con frenos y
   * marcas, y siempre quedaba un resquicio.
   *
   * Resulta que ese cambio no hacía falta AQUÍ. La identidad definitiva se
   * resuelve al cobrar, que es cuando ya se sabe el correo y la contraseña. Así
   * que esto solo pide los datos de nuevo; la sesión cambia UNA vez, dentro del
   * cobro, en vez de dos veces por pulsar un botón.
   */
  const usarOtroCorreo = useCallback(() => {
    setPedirOtraCuenta(true);
    setPayRequestId(null);
    setPayAmount(null);
    setCorreoAlta(null);
    setError(null);
  }, []);

  const close = useCallback(() => {
    setFormOpen(false);
    setSubmitting(false);
    setError(null);
    setSuccess(null);
  }, []);

  /** Crea el encargo y abre el cobro. Ya con identidad resuelta. */
  const createOrder = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await createGreetingRequest({
        creatorId,
        profileUserId: creatorId,
        type,
        toName: toName.trim(),
        instructions: instructions.trim(),
        source: source === "group" ? "group" : "profile",
        groupId: source === "group" ? groupId : null,
        allowCreatorStory: allowStory,
      });
      // Queda en awaiting_payment: el segundo modal es el que cobra.
      setPayRequestId(res.requestId);
      setPayAmount(res.priceSnapshot ?? null);
      setPayOpen(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tServices("requestError"));
    } finally {
      setSubmitting(false);
    }
  }, [
    toName,
    instructions,
    creatorId,
    type,
    source,
    groupId,
    allowStory,
    tWallet,
  ]);

  /**
   * Lo que hace el botón del formulario.
   *
   * ⚠️ En Express, si todavía no hay cuenta real, el alta va ANTES de crear el
   * encargo. Si el correo que escriba resulta tener cuenta, iniciar sesión con
   * ella CAMBIA el uid — y un encargo creado antes habría quedado colgado del
   * uid anónimo, pagado y sin dueño que pueda abrirlo.
   */
  const submit = useCallback(async () => {
    if (submitting || !toName.trim() || !instructions.trim()) return;
    if (necesitaCuenta) {
      // El encargo NO se crea todavia: se crea DENTRO del cobro, cuando ya se
      // sabe quien compra. Si el correo resulta tener cuenta, entrar en ella
      // cambia el uid, y un encargo creado antes habria quedado pagado y sin
      // dueno que pueda abrirlo.
      setPayOpen(true);
      return;
    }
    await createOrder();
  }, [submitting, toName, instructions, necesitaCuenta, createOrder]);

  /** ¿Hay algún modal abierto? El slide lo usa para pausar el video. */
  const isOpen = formOpen || payOpen;

  const totalAmount = payAmount != null ? payAmount + FIXED_SERVICE_FEE_USD : null;

  const modals = useMemo(
    () => (
      <>
        <CreatorServiceModals
          greetOpen={formOpen}
          greetSubmitting={submitting}
          greetType={type}
          creatorName={creatorName ?? undefined}
          toName={toName}
          instructions={instructions}
          greetPriceLabel={priceLabel}
          greetError={error}
          greetSuccess={success}
          onCloseGreeting={close}
          onSubmitGreeting={submit}
          onChangeToName={setToName}
          onChangeInstructions={setInstructions}
          allowCreatorStory={allowStory}
          onChangeAllowCreatorStory={setAllowStory}
          meetGreetOpen={false}
          meetGreetSubmitting={false}
          meetGreetMessage=""
          meetGreetError={null}
          meetGreetPriceLabel=""
          meetGreetDurationLabel=""
          onCloseMeetGreet={() => {}}
          onSubmitMeetGreet={() => {}}
          onChangeMeetGreetMessage={() => {}}
          exclusiveSessionOpen={false}
          exclusiveSessionSubmitting={false}
          exclusiveSessionMessage=""
          exclusiveSessionError={null}
          exclusiveSessionPriceLabel=""
          exclusiveSessionDurationLabel=""
          onCloseExclusiveSession={() => {}}
          onSubmitExclusiveSession={() => {}}
          onChangeExclusiveSessionMessage={() => {}}
          serviceToast={null}
          subtitleStyle={{ fontSize: 16, fontWeight: 600, lineHeight: 1.2, color: "#fff", fontFamily: FONT }}
          textStyle={{ fontSize: 12, fontWeight: 400, lineHeight: 1.4, color: "rgba(255,255,255,0.70)", fontFamily: FONT }}
          microText={{ fontSize: 12, fontWeight: 400, lineHeight: 1.4, color: "rgba(255,255,255,0.70)", fontFamily: FONT }}
          labelStyle={{ fontSize: 12, fontWeight: 500, lineHeight: 1.3, color: "#fff", fontFamily: FONT }}
          primaryButton={{ padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.24)", background: "#fff", color: "#000", cursor: "pointer", fontWeight: 600, fontSize: 14, lineHeight: 1.2, fontFamily: FONT }}
          secondaryButton={{ padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.07)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14, lineHeight: 1.2, fontFamily: FONT }}
          panelStyle={{ borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", padding: 14 }}
          inputStyle={{ width: "100%", borderRadius: 10, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.06)", color: "#fff", padding: "10px 12px", fontSize: 14, fontFamily: FONT, boxSizing: "border-box" }}
          messageBox={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 12, lineHeight: 1.45, fontFamily: FONT }}
          serviceModalBackdropStyle={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(0,0,0,0.80)", display: "grid", placeItems: "center", padding: 14, fontFamily: FONT }}
          serviceModalCardStyle={{ width: "min(720px, calc(100vw - 28px))", maxHeight: "calc(var(--vb-alto-pantalla) - 28px)", overflowY: "auto", background: "linear-gradient(180deg, rgba(18,18,18,0.98), rgba(8,8,8,0.98))", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.72)", color: "#fff" }}
          serviceToastStyle={{ position: "fixed", left: "50%", bottom: "calc(24px + var(--vb-safe-bottom, 0px))", transform: "translateX(-50%)", zIndex: 100002, maxWidth: "min(520px, calc(100vw - 28px))", padding: "10px 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(12,12,12,0.94)", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: FONT }}
        />
        <StripePaymentModal
          open={payOpen}
          // Sin encargo todavia el importe sale del precio del creador; con
          // encargo, del que quedo congelado al crearlo.
          //
          // ⚠️ Cuelga de si HAY encargo, no de si hace falta cuenta. Antes
          // colgaba de lo segundo, y eso ataba el importe a la sesion: al entrar
          // con un correo que ya tenia cuenta, la sesion se volvia real a mitad
          // del cobro y el importe y la moneda cambiaban de golpe por debajo de
          // la pasarela. Cuanto se cobra no tiene nada que ver con quien eres.
          amount={payAmount != null ? totalAmount : basePrice}
          // ⚠️ La moneda del SERVICIO, nunca "MXN" a secas.
          //
          // Estaba escrito a mano y se quedo asi desde antes de que la
          // plataforma liquidara en dolares. Con un consejo de 100 USD, la
          // pasarela recibia 100 y lo etiquetaba como pesos: ensenaba un total
          // de 6.89 USD y el servidor cobraba el equivalente a 116.49. Ver un
          // importe y que te cobren otro es lo mas grave que puede hacer una
          // pasarela.
          amountCurrency={monedaDelServicio}
          // Correo y contrasena, debajo de los metodos de pago. Solo aqui y solo
          // sin cuenta.
          collectAccount={necesitaCuenta}
          // Solo en Vibra Express. En la app quien compra ya sabe con qué cuenta
          // entró, y decírselo sobraría.
          accountEmail={cuentaEnUso}
          onUseAnotherAccount={cuentaEnUso ? usarOtroCorreo : undefined}
          createIntent={async (args) => {
            let requestId = payRequestId;

            if (necesitaCuenta) {
              // ⚠️ El ORDEN importa y no es negociable.
              //
              // 1) Se resuelve la identidad. Si el correo ya tenia cuenta, aqui
              //    cambia el uid.
              // 2) Se crea el encargo, ya bajo el uid definitivo.
              // 3) Se cobra.
              //
              // Creando el encargo antes del paso 1, un correo con cuenta previa
              // lo dejaba pagado y sin dueno que pudiera abrirlo.
              const cuenta = args.account;
              if (!cuenta) throw new Error(tServices("requestError"));

              const res = await attachGuestAccount(cuenta.email, cuenta.password, cuenta.exists);
              if (!res.ok) {
                // ⚠️ NO se lanza un error generico. El alta puede fallar por
                // cosas muy distintas —la contrasena no cuadra, ese correo ya
                // tiene cuenta, es demasiado corta— y decir "revisa los datos"
                // para las tres deja a la persona sin saber cual arreglar.
                console.error(
                  "[useGreetingPurchase] no se pudo crear la cuenta:",
                  res.reason,
                  // El codigo de Firebase, cuando el motivo es "cualquier otra
                  // cosa". Sin el, media docena de fallos distintos se ven
                  // todos igual y no hay por donde empezar a mirar.
                  res.reason === "unknown" ? res.code : "",
                  { correo: cuenta.email, yaTeniaCuenta: cuenta.exists },
                );
                //
                // ⚠️ Ninguno de estos es un texto de campo reaprovechado. Antes
                // la contrasena corta ensenaba "Minimo 6 caracteres", que es el
                // marcador de un campo y no un aviso, y el resto caia en "Error
                // al enviar la solicitud", que habla de un encargo cuando lo que
                // fallo fue el alta. Los cuatro dicen QUE paso.
                const mensaje =
                  res.reason === "wrong-password"
                    ? tExpress("wrongPassword")
                    : res.reason === "email-in-use"
                      ? tExpress("emailHasAccount")
                      : res.reason === "weak-password"
                        ? tRegister("errWeakPassword")
                        : res.reason === "invalid-email"
                          ? tAuth("errInvalidEmail")
                          : res.reason === "too-many-requests"
                            ? tAuth("errTooManyRequests")
                            : res.reason === "network"
                              ? tAuth("errNetworkFailed")
                              : tRegister("errRegistrationFailed");
                // En DESARROLLO el codigo de Firebase viaja pegado al mensaje.
                //
                // A quien compra no se le ensena jamas: no le dice nada y le
                // ensucia el aviso. Pero a quien esta probando el flujo le
                // ahorra abrir la consola para averiguar cual de la media docena
                // de fallos posibles acaba de ocurrir, que es justo el paso que
                // convierte un fallo en dos vueltas en vez de una.
                const mensajeVisible =
                  process.env.NODE_ENV !== "production" && res.reason === "unknown"
                    ? `${mensaje} [${res.code}]`
                    : mensaje;
                // La pasarela solo muestra el texto de un error si viene con
                // codigo; sin el lo sustituye por su mensaje generico.
                const err = new Error(mensajeVisible) as Error & { code?: string };
                err.code = "express/cuenta";
                throw err;
              }

              // Se recuerda para el aviso final. `necesitaCuenta` ya no sirve
              // ahi: en cuanto la cuenta queda enlazada deja de ser cierto, y
              // justo entonces es cuando hay que contarle a esta persona —que
              // llego sin cuenta— como va a recibir lo que acaba de pagar.
              setCorreoAlta(cuenta.email.trim().toLowerCase());

              const pedido = await createGreetingRequest({
                creatorId,
                profileUserId: creatorId,
                type,
                toName: toName.trim(),
                instructions: instructions.trim(),
                source: source === "group" ? "group" : "profile",
                groupId: source === "group" ? groupId : null,
                allowCreatorStory: allowStory,
              });
              requestId = pedido.requestId;
              setPayRequestId(pedido.requestId);
              setPayAmount(pedido.priceSnapshot ?? null);
            }

            return createGreetingStripeIntent({
              greetingRequestId: requestId ?? "",
              saveCard: args.saveCard,
              taxCountry: args.taxCountry,
              savedPaymentMethodId: args.savedPaymentMethodId,
              applyCredit: args.applyCredit,
            });
          }}
          // El mismo total, ya con impuesto y en la moneda de quien mira, que
          // ensena el boton del formulario. Antes se armaba a mano pegandole
          // "MXN" al numero, con el mismo error de moneda de arriba.
          priceLabel={priceLabel}
          productType={type === "consejo" ? "Consejo" : "Saludo"}
          providerName={creatorName ?? undefined}
          avatarUrl={creatorPhoto}
          description={tServices(type === "consejo" ? "payDescConsejo" : "payDescSaludo", {
            name: creatorName ?? tServices("creatorFallback"),
          })}
          // Quien llego SIN cuenta necesita saber dos cosas mas que quien ya
          // tenia sesion: por donde le va a llegar el aviso, y que ya puede
          // entrar con lo que acaba de escribir. Sin decirlo, la compra termina
          // en una pantalla verde y en ningun sitio al que volver.
          successMessage={
            tServices(type === "consejo" ? "paySuccessConsejo" : "paySuccessSaludo", {
              name: creatorName ?? tServices("creatorFallback"),
            }) +
            (correoDelAviso
              ? " " + tServices("paySuccessGuestNote", { email: correoDelAviso })
              : "")
          }
          // Completar el perfil, junto a la confirmación y sin taparla.
          //
          // Solo en Vibra Express: en la app quien compra ya tiene perfil, y
          // ofrecérselo sería ruido. El propio panel se retira si resulta que ya
          // hay perfil, así que esto es solo la puerta.
          successAside={
            identityMode === "guest"
              ? ({ stacked }) => <CompleteProfileAside stacked={stacked} />
              : null
          }
          onClose={() => {
            setPayOpen(false);
            // ⚠️ Con la compra HECHA se cierra tambien el formulario.
            //
            // Sin esto, cerrar la confirmacion devolvia al formulario relleno,
            // con su boton de "Continuar al pago" ofreciendo pagar algo que se
            // acababa de pagar. Es la forma mas facil de que alguien compre dos
            // veces sin querer.
            //
            // Solo con la compra hecha: quien cierra la pasarela SIN pagar tiene
            // que encontrarse su formulario donde lo dejo.
            if (!compraHecha) return;
            setCompraHecha(false);
            setFormOpen(false);
            setToName("");
            setInstructions("");
            setAllowStory(false);
            setPayRequestId(null);
            setPayAmount(null);
            setCorreoAlta(null);
          }}
          onPaid={() => {
            // El panel NO se cierra: muestra la pantalla de éxito. Solo se
            // registra la compra.
            setCompraHecha(true);
            registrarCompraGeo({
              creatorId,
              serviceType: type === "consejo" ? "advice" : "greeting",
              grossAmount: payAmount ?? undefined,
            });
          }}
        />
      </>
    ),
    [
      formOpen,
      submitting,
      type,
      creatorName,
      creatorPhoto,
      toName,
      instructions,
      error,
      success,
      close,
      submit,
      allowStory,
      priceLabel,
      basePrice,
      necesitaCuenta,
      source,
      groupId,
      payOpen,
      totalAmount,
      payRequestId,
      payAmount,
      creatorId,
      correoDelAviso,
      identityMode,
      compraHecha,
      monedaDelServicio,
      cuentaEnUso,
      usarOtroCorreo,
      tServices,
      tExpress,
      tRegister,
      tAuth,
    ],
  );

  return {
    open,
    isOpen,
    modals,
    /**
     * ¿Se puede encargar? `null` mientras se averigua.
     *
     * Quien lo monta decide que hacer: lo sensato es no ofrecer la compra
     * cuando ya se sabe que no esta a la venta.
     */
    available,
  };
}
