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
import { getServiceByType } from "@/lib/services/normalizeServices";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { registrarCompraGeo } from "@/lib/wallet/registrarCompraGeo";
import CreatorServiceModals from "@/components/services/CreatorServiceModals";
import StripePaymentModal from "@/components/payments/StripePaymentModal";
import GuestAccountStep from "@/components/payments/GuestAccountStep";

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
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const identityMode = usePurchaseIdentityMode();
  const pf = usePriceFormat();

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
  const [priceLabel, setPriceLabel] = useState<string | undefined>(undefined);
  const [accountOpen, setAccountOpen] = useState(false);
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

  useEffect(() => {
    if (!creatorId) return;
    let cancelled = false;
    getDoc(doc(db, "users", creatorId))
      .then((snap) => {
        if (cancelled) return;
        const offerings = snap.data()?.offerings ?? null;
        const service = getServiceByType(offerings, type, source);
        const price = service?.publicPrice ?? service?.memberPrice ?? null;
        if (typeof price !== "number") return;
        // Total todo incluido: base del creador, cargo fijo e impuesto del
        // pais de quien mira. Es lo que se le va a cobrar.
        setPriceLabel(
          pf.formatWithTax(price + FIXED_SERVICE_FEE_USD, {
            baseCurrency: SETTLEMENT_CURRENCY,
            code: true,
          }).total,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [creatorId, type, source, pf]);

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
    const necesitaCuenta = identityMode === "guest" && (!user || user.isAnonymous);
    if (necesitaCuenta) {
      setAccountOpen(true);
      return;
    }
    await createOrder();
  }, [submitting, toName, instructions, identityMode, user, createOrder]);

  /** ¿Hay algún modal abierto? El slide lo usa para pausar el video. */
  const isOpen = formOpen || accountOpen || payOpen;

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
        {/* El alta exprés. Al resolverse, sigue el encargo y el cobro. */}
        <GuestAccountStep
          open={accountOpen}
          onClose={() => setAccountOpen(false)}
          onReady={() => {
            setAccountOpen(false);
            void createOrder();
          }}
        />

        <StripePaymentModal
          open={payOpen}
          amount={totalAmount}
          amountCurrency="MXN"
          createIntent={(args) =>
            createGreetingStripeIntent({
              greetingRequestId: payRequestId ?? "",
              saveCard: args.saveCard,
              taxCountry: args.taxCountry,
              savedPaymentMethodId: args.savedPaymentMethodId,
              applyCredit: args.applyCredit,
            })
          }
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
      accountOpen,
      createOrder,
      payOpen,
      totalAmount,
      payRequestId,
      payAmount,
      creatorId,
      tServices,
    ],
  );

  return { open, isOpen, modals };
}
