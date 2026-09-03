// Cloud Functions de dinero, cobros, retiros, KYC y facturación.
// Los endpoints HTTP externos y los schedules permanecen en indexCompat.ts.

export {
  onSuperCommentLedger,
  onLiveAccessLedger,
  onPostAccessLedger,
  onGroupSubscriptionLedger,
  onGroupSubscriptionChurn,
  onProfileDonationLedger,
  onGreetingLedger,
  onExclusiveSessionLedger,
  onMeetGreetLedger,
} from "./wallet/ledgerTriggers";

export {
  requestWithdrawal,
  reviewWithdrawal,
  markWithdrawalPaid,
  avisarPuedeRetirar,
} from "./wallet/withdrawals";

export { mirrorLedgerToBuyerPurchase } from "./wallet/buyerPurchases";
export {
  requestCashout,
  resolveCashout,
  dismissCashoutNotice,
  devCaptureAndCredit,
} from "./wallet/cashout";

export { createKycSession } from "./kyc";
export { stripeHealthcheck } from "./payments/stripe/stripeHealthcheck";
export { fxQuoteDiagnostic } from "./tax/fxQuoteDiagnostic";
export { createStripePaymentIntent } from "./payments/stripe/createPaymentIntent";
export { repriceStripeIntentForCard } from "./payments/stripe/repriceForCard";
export { createGreetingStripeIntent } from "./payments/stripe/greetingStripeIntent";
export { createServiceStripeIntent } from "./payments/stripe/serviceStripeIntent";
export { createDonationStripeIntent } from "./payments/stripe/donationStripeIntent";
export { createLiveAccessStripeIntent } from "./payments/stripe/liveAccessStripeIntent";
export { createPremiumPostStripeIntent } from "./payments/stripe/premiumPostStripeIntent";
export { createLiveDonationStripeIntent } from "./payments/stripe/liveDonationStripeIntent";
export { createSuperCommentStripeIntent } from "./payments/stripe/superCommentStripeIntent";
export {
  createGroupSubscription,
  cancelGroupSubscriptionStripe,
} from "./payments/stripe/groupSubscriptionStripe";
export {
  createPayoutAccountLink,
  refreshPayoutAccountStatus,
} from "./payments/stripe/globalPayoutsRecipient";
export { createPayoutAccountQuestionnaire } from "./payments/payoutAccountQuestionnaire";

export { facturapiHealthcheck } from "./facturacion/facturapiHealthcheck";
export { saveCreatorTaxProfile } from "./facturacion/creatorTaxProfile";
export { setCreatorResidency } from "./facturacion/creatorResidency";
export { setCreatorPayoutAccountCountry } from "./facturacion/creatorPayoutAccount";
export { runCreatorMonthlyDocs } from "./facturacion/runCreatorMonthlyDocs";
export { generarInformativaMensual } from "./facturacion/informativaMensual";
export { uploadCreatorCsd } from "./facturacion/uploadCreatorCsd";
export { saveBuyerTaxProfile } from "./facturacion/buyerTaxProfile";
export {
  saveBuyerBillingProfile,
  deleteBuyerBillingProfile,
} from "./facturacion/buyerBillingProfiles";
export {
  generateBuyerInvoice,
  downloadBuyerInvoice,
} from "./facturacion/generateBuyerInvoice";
// ✂️ Sacar una venta de una global ya timbrada, motivo 04. Ver pendientesimpuestos.md §B7.
export { cancelarGlobalPorNominativa } from "./facturacion/cancelacionGlobal";
// 📅 Factura global DIARIA, por el plazo de 24 h. Ver pendientesimpuestos.md §A1.
export {
  globalInvoiceDailyCron,
  runGlobalInvoiceDay,
} from "./facturacion/runGlobalInvoice";
// 🕓 Cola de facturas que esperan al sello del creador. Ver pendientesimpuestos.md §B5.
export {
  onCsdValidoEmitirCola,
  reintentarColaDeFacturas,
} from "./facturacion/colaDeFacturas";
