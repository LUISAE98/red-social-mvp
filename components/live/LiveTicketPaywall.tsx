"use client";

// La pasarela del boleto de un live.
//
// Vivía incrustada dentro de `LiveViewerModal`. En cuanto el feed de reels tuvo
// que ofrecer el mismo boleto sin abrir el visor, copiarla habría significado
// tener DOS caminos de cobro para lo mismo: dos formas de firmar al invitado,
// dos de calcular el importe con su comisión y su impuesto, y dos de registrar
// la compra. Es lo último que conviene duplicar.
//
// Así que se extrae tal cual y la usan los dos. El acceso lo concede el backend
// al aprobar el pago; aquí no se toca nada de eso.

import { useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import type { Post } from "@/lib/posts/types";
import { useAuth } from "@/app/providers";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { FIXED_SERVICE_FEE_USD, SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { ensureGuestAuth } from "@/lib/guest/ensureGuestAuth";
import { createLiveAccessStripeIntent } from "@/lib/stripe/stripePayments";
import { registrarCompraGeo } from "@/lib/wallet/registrarCompraGeo";
import StripePaymentModal from "@/components/payments/StripePaymentModal";

/** Precio del boleto tal cual está en el documento, sin comisión ni impuesto. */
export function liveTicketPrice(post: Post): number {
  const raw = post.liveData?.ticketPrice;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * ¿Este live se cobra?
 *
 * Es la MISMA señal que exige el backend para emitir el cobro. Tener una idea
 * propia de "live de pago" en cada pantalla es como se acaba enseñando un
 * candado donde no hay cobro, o al revés.
 */
export function isPaidLive(post: Post): boolean {
  return (post.liveData?.accessType ?? "free") === "paid" && post.requiresPayment === true;
}

/** Lo que de verdad se paga, con comisión e impuesto, ya formateado. */
export function useLiveTicketTotal(post: Post): string | null {
  const pf = usePriceFormat();
  const price = liveTicketPrice(post);
  if (price <= 0) return null;
  // ⚠️ El importe vive SIEMPRE en la moneda de liquidación. Usar la guardada en
  // el documento resucitaba el fallo de enseñar dólares con etiqueta de pesos en
  // los lives creados antes del corte.
  return pf.formatWithTax(price + FIXED_SERVICE_FEE_USD, {
    baseCurrency: SETTLEMENT_CURRENCY,
    code: true,
  }).total;
}

type Props = {
  post: Post;
  open: boolean;
  onClose: () => void;
};

export default function LiveTicketPaywall({ post, open, onClose }: Props) {
  const tPosts = useTranslations("posts");
  const { user } = useAuth();
  // Se saca el uid a una constante en vez de leer `user` dentro: el compilador
  // de React exige que la dependencia sea exactamente lo que se usa.
  const currentUid = user?.uid ?? null;
  const guestUidRef = useRef<string | null>(null);
  const price = liveTicketPrice(post);

  /**
   * Quién compra.
   *
   * Sin sesión se firma como invitado ANTES de cobrar: el boleto se liga a ese
   * uid y se verifica en el servidor, así que una cuenta real distinta no lo
   * hereda.
   */
  const resolveBuyerUid = useCallback(async (): Promise<string | null> => {
    if (currentUid) return currentUid;
    if (guestUidRef.current) return guestUidRef.current;
    try {
      const u = await ensureGuestAuth();
      guestUidRef.current = u.uid;
      return u.uid;
    } catch (err) {
      console.warn("[LiveTicketPaywall] identidad de invitado", err);
      return null;
    }
  }, [currentUid]);

  return (
    <StripePaymentModal
      open={open}
      amount={price > 0 ? price + FIXED_SERVICE_FEE_USD : null}
      amountCurrency={SETTLEMENT_CURRENCY}
      createIntent={async (args) => {
        await resolveBuyerUid();
        return createLiveAccessStripeIntent({
          postId: post.id,
          saveCard: args.saveCard,
          taxCountry: args.taxCountry,
          savedPaymentMethodId: args.savedPaymentMethodId,
          applyCredit: args.applyCredit,
        });
      }}
      productType={tPosts("liveTicketProductType")}
      providerName={post.authorName ?? post.authorUsername ?? undefined}
      avatarUrl={post.authorAvatarUrl ?? null}
      description={tPosts("liveTicketPayDescription")}
      successMessage={tPosts("liveTicketPaySuccess")}
      onPaid={() => {
        // El acceso lo concede el backend al aprobar el pago; la suscripción a
        // `liveAccess` lo refleja sola en cuanto el webhook lo materializa.
        registrarCompraGeo({
          creatorId: post.authorId,
          serviceType: "live_ticket",
          grossAmount: price || undefined,
        });
      }}
      onClose={onClose}
    />
  );
}
