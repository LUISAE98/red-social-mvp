"use client";

// Panel de confirmación (éxito) de pago: sección verde (avatar + nombre + tipo) y
// sección blanca (mensaje + palomita animada). Compartido por las pasarelas y por
// otros flujos de compra (supercomentario) para que la confirmación se vea igual.

const GREEN = "#00a650";

const SUCCESS_KEYFRAMES = `
  @keyframes vibraPaySuccessPop { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
  @keyframes vibraPaySuccessFade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes vibraPaySuccessFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
`;

export default function PaymentSuccessCard({
  avatarUrl,
  providerName,
  productType,
  successMessage,
  onClose,
  locale = "en",
  stacked = false,
  showClose = true,
}: {
  avatarUrl?: string | null;
  providerName?: string | null;
  productType?: string | null;
  successMessage?: string | null;
  onClose: () => void;
  locale?: string;
  stacked?: boolean;
  showClose?: boolean;
}) {
  const purchaseDate = new Date().toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  return (
    <div style={{ height: stacked ? 480 : 440, display: "flex", flexDirection: "column", position: "relative" }}>
      <style>{SUCCESS_KEYFRAMES}</style>
      {showClose && (
        <button type="button" onClick={onClose} aria-label="Cerrar" style={{ position: "absolute", top: 10, insetInlineEnd: 16, zIndex: 2, border: "none", background: "transparent", color: "#fff", fontSize: 32, lineHeight: 1, padding: 2, cursor: "pointer" }}>×</button>
      )}
      <div style={{ position: "absolute", top: 16, insetInlineStart: 0, insetInlineEnd: 0, zIndex: 2, textAlign: "center", color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 500, pointerEvents: "none", animation: "vibraPaySuccessFade 300ms ease both" }}>{purchaseDate}</div>
      <div style={{ flex: 2, background: GREEN, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: 7, padding: "88px 24px 14px", animation: "vibraPaySuccessFade 300ms ease both" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {avatarUrl ? <img src={avatarUrl} alt={providerName ?? ""} style={{ width: 128, height: 128, borderRadius: "50%", objectFit: "cover", boxShadow: "0 8px 24px rgba(0,0,0,0.18)", animation: "vibraPaySuccessPop 460ms cubic-bezier(0.2,0.9,0.2,1.2) both", animationDelay: "120ms" }} /> : null}
        {providerName ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ color: "#fff", fontSize: 20, fontWeight: 600, textAlign: "center", animation: "vibraPaySuccessFade 360ms ease both", animationDelay: "260ms" }}>{providerName}</span>
            {productType ? <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 15, fontWeight: 500, textAlign: "center", animation: "vibraPaySuccessFade 360ms ease both", animationDelay: "340ms" }}>{productType}</span> : null}
          </div>
        ) : null}
      </div>
      <div style={{ flex: 1, background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "18px 28px 26px" }}>
        <p style={{ margin: 0, fontSize: 13.5, color: "#5b616e", textAlign: "center", lineHeight: 1.5, maxWidth: 380, animation: "vibraPaySuccessFadeUp 420ms ease both", animationDelay: "420ms" }}>{successMessage}</p>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: GREEN, display: "flex", alignItems: "center", justifyContent: "center", animation: "vibraPaySuccessPop 480ms cubic-bezier(0.2,0.9,0.2,1.25) both", animationDelay: "560ms" }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
        </div>
      </div>
    </div>
  );
}
