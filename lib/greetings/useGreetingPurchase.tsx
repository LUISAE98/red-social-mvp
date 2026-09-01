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
import { usePurchaseIdentityMode } from "./purchaseIdentity";
import type { StoryType } from "@/lib/stories/types";
import { createGreetingRequest } from "@/lib/greetings/greetingRequests";
import { createGreetingStripeIntent } from "@/lib/stripe/stripePayments";
import { FIXED_SERVICE_FEE_USD, SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { getServiceByType, getVisibleServices } from "@/lib/services/normalizeServices";
import { attachGuestAccount } from "@/lib/guest/guestAccount";
import { useCreatorProfile } from "@/lib/reels/creatorProfiles";
import { registrarCompraGeo } from "@/lib/wallet/registrarCompraGeo";
import CreatorServiceModals from "@/components/services/CreatorServiceModals";
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
  const necesitaCuenta = identityMode === "guest" && (!user || !!user.isAnonymous);

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
          serviceModalCardStyle={{ width: "min(720px, calc(100vw - 28px))", maxHeight: "calc(100dvh - 28px)", overflowY: "auto", background: "linear-gradient(180deg, rgba(18,18,18,0.98), rgba(8,8,8,0.98))", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.72)", color: "#fff" }}
          serviceToastStyle={{ position: "fixed", left: "50%", bottom: "calc(24px + var(--vb-safe-bottom, 0px))", transform: "translateX(-50%)", zIndex: 100002, maxWidth: "min(520px, calc(100vw - 28px))", padding: "10px 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(12,12,12,0.94)", color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: FONT }}
        />
        <StripePaymentModal
          open={payOpen}
          // Sin encargo todavia (invitado) el importe sale del precio del
          // creador; con encargo, del que quedo congelado al crearlo.
          amount={necesitaCuenta ? basePrice : totalAmount}
          amountCurrency={necesitaCuenta ? SETTLEMENT_CURRENCY : "MXN"}
          // Correo y contrasena, debajo de los metodos de pago. Solo aqui y solo
          // sin cuenta.
          collectAccount={necesitaCuenta}
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
          priceLabel={totalAmount != null ? `$${totalAmount} MXN` : undefined}
          productType={type === "consejo" ? "Consejo" : "Saludo"}
          providerName={creatorName ?? undefined}
          avatarUrl={creatorPhoto}
          description={tServices(type === "consejo" ? "payDescConsejo" : "payDescSaludo", {
            name: creatorName ?? tServices("creatorFallback"),
          })}
          successMessage={tServices(type === "consejo" ? "paySuccessConsejo" : "paySuccessSaludo", {
            name: creatorName ?? tServices("creatorFallback"),
          })}
          onClose={() => setPayOpen(false)}
          onPaid={() => {
            // El panel NO se cierra: muestra la pantalla de éxito. Solo se
            // registra la compra.
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
