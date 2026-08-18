"use client";

// Compra de un saludo o consejo desde una historia.
//
// Extraído de StoryViewer para que el visor de círculos y el slide del feed de
// reels compartan el mismo flujo, que son dos modales encadenados (recoger el
// encargo, luego cobrar) más el registro geográfico de la compra.
//
// La puerta de identidad vive en `resolveBuyer`: hoy, sin sesión, manda a login.
// Vibra Express necesitará abrir ahí un alta exprés en vez de navegar fuera, y
// ese es el único punto que habrá que tocar.

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import type { StoryType } from "@/lib/stories/types";
import { createGreetingRequest } from "@/lib/greetings/greetingRequests";
import { createGreetingStripeIntent } from "@/lib/stripe/stripePayments";
import { FIXED_SERVICE_FEE_USD } from "@/lib/currency/catalog";
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
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [formOpen, setFormOpen] = useState(false);
  const [toName, setToName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [allowStory, setAllowStory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [payOpen, setPayOpen] = useState(false);
  const [payRequestId, setPayRequestId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState<number | null>(null);

  /** ¿Hay identidad para comprar? Si no, se resuelve y se corta el flujo. */
  const resolveBuyer = useCallback((): boolean => {
    if (user) return true;
    router.push(`/login?next=${encodeURIComponent(pathname)}`);
    return false;
  }, [user, router, pathname]);

  const open = useCallback(() => {
    if (!resolveBuyer()) return;
    setToName("");
    setInstructions("");
    setAllowStory(false);
    setError(null);
    setSuccess(null);
    setFormOpen(true);
  }, [resolveBuyer]);

  const close = useCallback(() => {
    setFormOpen(false);
    setSubmitting(false);
    setError(null);
    setSuccess(null);
  }, []);

  const submit = useCallback(async () => {
    if (submitting || !toName.trim() || !instructions.trim()) return;
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
    submitting,
    toName,
    instructions,
    creatorId,
    type,
    source,
    groupId,
    allowStory,
    tWallet,
  ]);

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
