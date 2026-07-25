"use client";

import React, { useState } from "react";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import VibraFlameIcon from "@/app/components/VibraServiceIcons/VibraFlameIcon";
import { BRAND_DOMAIN } from "@/lib/brand";

// ── Simuladores de dispositivo (lienzos para diseñar los paneles de ──────────
//    supercomentarios / donación en vivo) ─────────────────────────────────────
function PhoneFrame({ label, children }: { label?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {label && (
        <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: 600 }}>{label}</span>
      )}
      <div
        style={{
          position: "relative",
          width: 300,
          height: 630,
          borderRadius: 46,
          padding: 11,
          background: "linear-gradient(150deg, #2c2c30, #101012)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,255,255,0.05)",
          flexShrink: 0,
        }}
      >
        {/* Pantalla */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 36,
            overflow: "hidden",
            background: "#050506",
          }}
        >
          {/* Dynamic island */}
          <div
            style={{
              position: "absolute",
              top: 11,
              left: "50%",
              transform: "translateX(-50%)",
              width: 98,
              height: 27,
              borderRadius: 20,
              background: "#000",
              zIndex: 5,
            }}
          />
          {children}
        </div>
      </div>
    </div>
  );
}

function DesktopFrame({ label, children }: { label?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      {label && (
        <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: 600 }}>{label}</span>
      )}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {/* Monitor */}
        <div
          style={{
            width: 780,
            maxWidth: "100%",
            borderRadius: 18,
            padding: 12,
            background: "linear-gradient(150deg, #2c2c30, #101012)",
            boxShadow: "0 30px 80px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,255,255,0.05)",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "16 / 9",
              borderRadius: 8,
              overflow: "hidden",
              background: "#050506",
            }}
          >
            {children}
          </div>
        </div>
        {/* Soporte */}
        <div
          style={{
            width: 96,
            height: 44,
            background: "linear-gradient(#1c1c1f, #141416)",
            clipPath: "polygon(30% 0, 70% 0, 100% 100%, 0 100%)",
          }}
        />
        <div style={{ width: 190, height: 12, borderRadius: 8, background: "#1c1c1f" }} />
      </div>
    </div>
  );
}

// ── Mockup: espectador de un LIVE horizontal en celular vertical ─────────────
//    Réplica del layout real de LiveViewerModal (rama "MOBILE — horizontal:
//    video top + chat panel below"): video 16:9 arriba + info del creador + chat.
function LiveChatMsg({ initial, color, name, text }: { initial: string; color: string; name: string; text: string }) {
  return (
    <div style={{ display: "flex", gap: 6, padding: "3px 0", alignItems: "center" }}>
      <div style={{ width: 22, height: 22, borderRadius: "50%", background: color, flexShrink: 0, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>
        {initial}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.85)", marginRight: 4 }}>{name}</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", lineHeight: 1.4, wordBreak: "break-word" }}>{text}</span>
      </div>
    </div>
  );
}

// ── Mockup: pasarela de donación del live ────────────────────────────────────
//    Réplica visual del ServicePaymentModal (modo donación / monto editable) del
//    perfil. `narrow` = layout móvil apilado (Celular 1); false = dos columnas
//    (Ordenador). Estática, sin SDK real de MP — solo para diseñar.
function DonationGatewayMockup({ narrow, onClose }: { narrow: boolean; onClose: () => void }) {
  const MP_BLUE = "#009ee3";
  const pf = usePriceFormat();
  // Montos sugeridos: anclas en MXN; se muestran (y se convierten) en la moneda del usuario.
  const DONATION_PRESETS_MXN = [30, 70, 140, 240];
  const [method, setMethod] = useState<"credit" | "debit" | null>(null);
  const [amount, setAmount] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [cardExp, setCardExp] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardName, setCardName] = useState("");

  // El botón "Pagar" (igual que el ServicePaymentModal real) exige monto válido,
  // un método elegido Y los datos de la tarjeta completos.
  const amountOk = !!amount && Number(amount) > 0;
  const cardOk = cardNumber.trim().length > 0 && cardExp.trim().length > 0 && cardCvv.trim().length > 0 && cardName.trim().length > 0;
  const canPay = amountOk && method !== null && cardOk;

  const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#5b616e", marginBottom: 6, display: "block" };
  const inputBox: React.CSSProperties = { height: 40, borderRadius: 10, border: "1px solid #e3e6ea", background: "#fff", padding: "0 12px", boxSizing: "border-box", color: "#3a3f4a", fontSize: 14, outline: "none", fontFamily: "inherit", width: "100%" };
  const rowButton: React.CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "15px 2px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" };
  const rowDivider: React.CSSProperties = { borderBottom: "1px solid #eceef1" };
  const cardIcon = (active: boolean) => (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={active ? MP_BLUE : "#8a8f99"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" />
    </svg>
  );
  const radio = (active: boolean) => (
    <span style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${active ? MP_BLUE : "#b8bcc4"}`, display: "grid", placeItems: "center", flexShrink: 0 }}>
      {active && <span style={{ width: 9, height: 9, borderRadius: "50%", background: MP_BLUE }} />}
    </span>
  );
  const cardFields = (
    <div style={{ display: "grid", gap: 14, padding: "6px 2px 18px" }}>
      <div><label style={label}>Número de tarjeta</label><input className="vibra-mock-card" style={inputBox} inputMode="numeric" placeholder="1234 1234 1234 1234" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label style={label}>Vencimiento</label><input className="vibra-mock-card" style={inputBox} placeholder="MM/AA" value={cardExp} onChange={(e) => setCardExp(e.target.value)} /></div>
        <div><label style={label}>CVV</label><input className="vibra-mock-card" style={inputBox} inputMode="numeric" placeholder="CVV" value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} /></div>
      </div>
      <div><label style={label}>Nombre del titular</label><input className="vibra-mock-card" style={inputBox} placeholder="Como aparece en la tarjeta" value={cardName} onChange={(e) => setCardName(e.target.value)} /></div>
    </div>
  );
  function methodRow(kind: "credit" | "debit", title: string) {
    const active = method === kind;
    return (
      <div style={rowDivider}>
        <button type="button" onClick={() => setMethod(active ? null : kind)} style={rowButton}>
          {cardIcon(active)}
          <span style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", flex: 1, textAlign: "left" }}>{title}</span>
          {radio(active)}
        </button>
        <div style={{ display: "grid", gridTemplateRows: active ? "1fr" : "0fr", transition: "grid-template-rows 300ms cubic-bezier(0.4,0,0.2,1)" }}>
          <div style={{ overflow: "hidden", opacity: active ? 1 : 0, transition: "opacity 260ms ease" }}>{cardFields}</div>
        </div>
      </div>
    );
  }

  const leftColumn = (
    <div style={{ position: "relative", padding: narrow ? "24px 18px 4px" : "28px 24px 24px", minWidth: 0 }}>
      <button type="button" onClick={onClose} aria-label="Cerrar" style={{ position: "absolute", top: 8, right: 10, zIndex: 2, border: "none", background: "none", color: "#9aa0a8", cursor: "pointer", fontSize: 26, lineHeight: 1, padding: 4 }}>×</button>
      {narrow && (
        // eslint-disable-next-line @next/next/no-img-element
        <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-start" }}><img src="/mercadopago.webp" alt="Mercado Pago" style={{ height: 30, width: "auto" }} /></div>
      )}
      <div style={{ marginBottom: 16, marginTop: narrow ? 0 : 4 }}>
        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#3a3f4a" }}>¿Cómo quieres pagar?</h4>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#9aa0a8", fontWeight: 400 }}>Elige tu forma de pago</p>
      </div>
      <div style={{ display: "grid" }}>
        {methodRow("credit", "Tarjeta de crédito")}
        {methodRow("debit", "Tarjeta de débito")}
      </div>
    </div>
  );

  const rightColumn = (
    <div style={{ position: "relative", padding: narrow ? "16px 18px 20px" : "48px 24px 24px", background: "#fff", borderLeft: narrow ? "none" : "1px solid #eaecef", display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 12, minWidth: 0 }}>
      {!narrow && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/mercadopago.webp" alt="Mercado Pago" style={{ position: "absolute", top: 22, right: 24, height: 30, width: "auto" }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #ec4899 0%, #9333ea 100%)", display: "grid", placeItems: "center", fontSize: 19, fontWeight: 700, color: "#fff" }}>N</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a" }}>Nombre del creador</div>
          <div style={{ fontSize: 12.5, color: "#6b7280" }}>Donación</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 2 }}>
        <div style={{ height: 1, background: "#e6e8ec" }} />
        <p style={{ margin: 0, fontSize: 12.5, color: "#5b616e", lineHeight: 1.5 }}>Tu contribución es un apoyo directo para Nombre del creador. ¡Gracias por respaldar su historia!</p>
      </div>
      <div style={{ height: 1, background: "#e6e8ec" }} />
      {/* 4 montos sugeridos (anclas MXN → moneda del usuario). Al elegir uno se pone en "Otro monto". */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {DONATION_PRESETS_MXN.map((mxn) => {
          const selected = selectedPreset === mxn;
          return (
            <button
              key={mxn}
              type="button"
              onClick={() => { setSelectedPreset(mxn); setAmount(String(Math.round(pf.toDisplayForInput(mxn, "MXN")))); }}
              style={{ padding: "9px 2px", borderRadius: 10, border: "none", background: selected ? "#eaf6fd" : "transparent", color: selected ? MP_BLUE : "#3a3f4a", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {pf.format(mxn, { code: true })}
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gap: 6, justifyItems: "center", marginTop: 2 }}>
        <span style={{ fontSize: 12.5, color: "#6b7280", fontWeight: 600 }}>Otro monto</span>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: "#3a3f4a" }}>$</span>
          <input type="number" inputMode="decimal" min={1} className="vibra-amount-input" value={amount} onChange={(e) => { setAmount(e.target.value); setSelectedPreset(null); }} placeholder="0" style={{ width: 120, border: "none", borderBottom: "1px solid #eceef1", background: "transparent", fontSize: 22, fontWeight: 700, color: "#3a3f4a", textAlign: "center", outline: "none", fontFamily: "inherit", padding: "0 2px 4px" }} />
          <span style={{ fontSize: 13, color: "#9aa0a8", fontWeight: 600 }}>{pf.currency}</span>
        </div>
      </div>
      <button type="button" disabled={!canPay} style={{ height: 40, borderRadius: 10, border: "none", background: canPay ? MP_BLUE : "#9fd8f2", color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: canPay ? "pointer" : "not-allowed" }}>Pagar</button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11, color: "#8a8f99", marginTop: -6 }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={MP_BLUE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" />
        </svg>
        <span>Tu pago está protegido por <span style={{ color: MP_BLUE, fontWeight: 700 }}>Mercado Pago</span></span>
      </div>
    </div>
  );

  return (
    <div style={{ width: "100%", maxWidth: narrow ? "none" : 660, margin: narrow ? undefined : "0 auto", background: "#fff", color: "#3a3f4a", fontFamily: "system-ui, sans-serif" }}>
      <style>{`.vibra-amount-input::-webkit-outer-spin-button,.vibra-amount-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}.vibra-amount-input{-moz-appearance:textfield;appearance:textfield}.vibra-mock-card::placeholder{color:#9aa0a8;opacity:1}`}</style>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1.05fr 1fr", alignItems: "stretch" }}>
        {leftColumn}
        {rightColumn}
      </div>
    </div>
  );
}

function LiveSpectatorMockup() {
  const [chatFocused, setChatFocused] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [donateClosing, setDonateClosing] = useState(false);
  const closeDonate = () => setDonateClosing(true);
  const headerBtn: React.CSSProperties = { background: "none", border: "none", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", background: "#0a0a0a", paddingTop: 42, overflow: "hidden" }}>
      <style>{`@keyframes lvmPulse{0%,100%{opacity:1}50%{opacity:0.35}}.vibra-chat-ph::placeholder{color:rgba(255,255,255,0.32)}`}</style>

      {/* ── Video 16:9 ── */}
      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000", flexShrink: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="https://picsum.photos/seed/vibralive/640/360" alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />

        {/* Header: mute + expandir + cerrar */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, padding: "8px 8px" }}>
          <button style={headerBtn} aria-label="Silenciar">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          </button>
          <button style={headerBtn} aria-label="Pantalla completa">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
          <button style={headerBtn} aria-label="Cerrar">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Badge EN VIVO — abajo derecha */}
        <div style={{ position: "absolute", bottom: 12, right: 12, display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(239,68,68,0.88)", borderRadius: 7, padding: "5px 11px 5px 8px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#fff", backdropFilter: "blur(4px)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "lvmPulse 1.4s ease-in-out infinite" }} />
          EN VIVO
        </div>

        {/* Badge espectadores — abajo izquierda */}
        <div style={{ position: "absolute", bottom: 12, left: 12, display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(0,0,0,0.55)", borderRadius: 7, border: "1px solid rgba(255,255,255,0.12)", padding: "5px 10px 5px 8px", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.88)", backdropFilter: "blur(4px)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          1,284
        </div>
      </div>

      {/* Contenido bajo el video — el panel de donación se ancla aquí, así el live nunca queda tapado */}
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>

      {/* ── Info del creador ── */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid transparent", display: "flex", alignItems: "center", gap: 11, flexShrink: 0 }}>
        <div style={{ width: 42, height: 42, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #ec4899 0%, #9333ea 100%)", display: "grid", placeItems: "center", fontSize: 17, fontWeight: 700, color: "#fff" }}>
          N
        </div>
        <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>
            Nombre del creador
          </span>
          {/* 2ª línea: "En vivo" izquierda · like derecha (conteo fijo a la derecha, flamita a su izquierda) */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.2 }}>En vivo</span>
            <button style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }} aria-label="Me gusta">
              <VibraFlameIcon size={18} active />
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>1,284</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Chat ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 10px", display: "flex", flexDirection: "column", gap: 1 }}>
        <LiveChatMsg initial="A" color="#f43f5e" name="Ana" text="¡Qué buena transmisión! 🔥" />
        <LiveChatMsg initial="C" color="#3b82f6" name="Carlos" text="Saludos desde México 🇲🇽" />

        {/* Supercomentario / donación */}
        <div style={{ display: "flex", gap: 8, padding: "6px 10px", alignItems: "flex-start", margin: "2px -10px" }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: "#8b5cf6", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: "#fff", boxShadow: "0 0 0 2px #a855f7" }}>
            L
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Lucía</span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>donó</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>$100 MXN</span>
            </div>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", lineHeight: 1.4 }}>¡Sigue así crack! 💜</span>
          </div>
        </div>

        <LiveChatMsg initial="D" color="#10b981" name="Diego" text="¿Vas a hablar del tema nuevo?" />
        <LiveChatMsg initial="M" color="#f59e0b" name="María" text="😍😍😍" />
        <LiveChatMsg initial="J" color="#6366f1" name="Jorge" text="Primera vez aquí, todo excelente" />
      </div>

      {/* ── Barra de input ── */}
      <div style={{ padding: "8px 10px", borderTop: "1px solid transparent", flexShrink: 0, display: "flex", alignItems: "center" }}>
        {/* Campo con flecha de enviar DENTRO */}
        <div style={{ position: "relative", flex: 1 }}>
          <input
            maxLength={50}
            className="vibra-chat-ph"
            placeholder="Escribe un comentario…"
            onFocus={() => setChatFocused(true)}
            onBlur={() => setChatFocused(false)}
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 12, padding: "10px 36px 10px 12px", color: "#fff", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, outline: "none" }}
          />
          <button style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="Enviar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#a855f7" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" style={{ transform: "rotate(-20deg)" }} aria-hidden="true">
              <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
            </svg>
          </button>
        </div>
        {/* Moneda (supercomentario) + corazón (aportación) — se colapsan al enfocar */}
        <div style={{ overflow: "hidden", flexShrink: 0, width: chatFocused ? 0 : 56, marginLeft: chatFocused ? 0 : 10, opacity: chatFocused ? 0 : 1, transition: "width 0.25s ease, margin 0.25s ease, opacity 0.2s ease" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Supercomentario — moneda */}
            <button style={{ background: "none", border: "none", padding: 0, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Supercomentario">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8.2" />
                <path d="M12 7.4v9.2" />
                <path d="M14.3 9.4c-.5-.7-1.3-1.1-2.3-1.1-1.4 0-2.4.7-2.4 1.8 0 2.5 4.9 1.2 4.9 3.8 0 1.1-1 1.8-2.5 1.8-1 0-1.9-.4-2.4-1.2" />
              </svg>
            </button>
            {/* Aportación — solo corazón */}
            <button onClick={() => setDonateOpen(true)} style={{ background: "none", border: "none", padding: 0, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Hacer aportación">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Panel de donación — entra desde abajo; cubre de debajo del video hacia abajo (no tapa el live) ── */}
      {donateOpen && (
        <div
          onAnimationEnd={() => { if (donateClosing) { setDonateOpen(false); setDonateClosing(false); } }}
          style={{ position: "absolute", inset: 0, zIndex: 100, background: "#fff", overflowY: "auto", animation: `${donateClosing ? "dgDown" : "dgUp"} 0.32s cubic-bezier(0.2,0.8,0.2,1) forwards` }}
        >
          <style>{`@keyframes dgUp{from{transform:translateY(100%)}to{transform:translateY(0)}}@keyframes dgDown{from{transform:translateY(0)}to{transform:translateY(100%)}}`}</style>
          <DonationGatewayMockup narrow onClose={closeDonate} />
        </div>
      )}
      </div>
    </div>
  );
}

// ── Mockup: espectador de un LIVE VERTICAL en celular vertical ───────────────
//    Réplica de la rama "MOBILE — portrait: fullscreen + overlay chat":
//    video a pantalla completa (cover) + chat translúcido encima.
function LiveOverlayMsg({ initial, color, name, text }: { initial: string; color: string; name: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
      <div style={{ width: 20, height: 20, borderRadius: "50%", background: color, flexShrink: 0, display: "grid", placeItems: "center", fontSize: 9, fontWeight: 700, color: "#fff" }}>
        {initial}
      </div>
      <span style={{ fontSize: 12.5, lineHeight: 1.4, color: "rgba(255,255,255,0.92)", flex: 1, minWidth: 0 }}>
        <strong style={{ fontWeight: 700, color: "#fff", marginRight: 5 }}>{name}</strong>
        {text}
      </span>
    </div>
  );
}

function LivePortraitSpectatorMockup() {
  const [chatFocused, setChatFocused] = useState(false);
  const headerBtn: React.CSSProperties = { background: "none", border: "none", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#000", overflow: "hidden" }}>
      <style>{`@keyframes lvmPulse2{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>

      {/* Video vertical a pantalla completa (imagen, cover) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="https://picsum.photos/seed/vibralivev/420/900" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />

      {/* Badge EN VIVO — arriba-centro (debajo del island) */}
      <div style={{ position: "absolute", top: 46, left: "50%", transform: "translateX(-50%)", display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(239,68,68,0.88)", borderRadius: 7, padding: "5px 11px 5px 8px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#fff", backdropFilter: "blur(4px)", zIndex: 10 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "lvmPulse2 1.4s ease-in-out infinite" }} />
        EN VIVO
      </div>

      {/* Badge espectadores — arriba-izquierda */}
      <div style={{ position: "absolute", top: 46, left: 12, display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(0,0,0,0.55)", borderRadius: 7, border: "1px solid rgba(255,255,255,0.12)", padding: "5px 10px 5px 8px", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.88)", backdropFilter: "blur(4px)", zIndex: 10 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        1,284
      </div>

      {/* Header — mute + cerrar (sin expandir en portrait), arriba-derecha */}
      <div style={{ position: "absolute", top: 42, right: 8, display: "flex", alignItems: "center", gap: 4, zIndex: 10 }}>
        <button style={headerBtn} aria-label="Silenciar">
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        </button>
        <button style={headerBtn} aria-label="Cerrar">
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Overlay de chat translúcido — parte inferior */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 5, display: "flex", flexDirection: "column", paddingTop: 44, background: "linear-gradient(to top, rgba(0,0,0,0.68) 50%, transparent 100%)" }}>
        {/* Mensajes */}
        <div style={{ padding: "0 14px", display: "flex", flexDirection: "column" }}>
          {/* Like (izquierda) · Botón Seguir (derecha) — misma línea */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 8 }}>
            <button style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }} aria-label="Me gusta">
              <VibraFlameIcon size={18} active />
              <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>1,284</span>
            </button>
            <button style={{ background: "rgba(255,255,255,0.92)", border: "none", color: "#000", borderRadius: 20, padding: "5px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: "0.01em" }}>
              Seguir
            </button>
          </div>

          <LiveOverlayMsg initial="A" color="#f43f5e" name="Ana" text="¡Qué buena transmisión! 🔥" />
          <LiveOverlayMsg initial="C" color="#3b82f6" name="Carlos" text="Saludos desde México 🇲🇽" />

          {/* Supercomentario / donación */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "0 -14px 5px -14px", padding: "6px 14px" }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: "#8b5cf6", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: "#fff", boxShadow: "0 0 0 2px #a855f7" }}>
              L
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Lucía</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>donó</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>$100 MXN</span>
              </div>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.9)", lineHeight: 1.4 }}>¡Sigue así crack! 💜</span>
            </div>
          </div>

          <LiveOverlayMsg initial="M" color="#f59e0b" name="María" text="😍😍😍" />
        </div>

        {/* Barra de input — mismo sistema que el horizontal */}
        <div style={{ padding: "7px 14px 14px", display: "flex", alignItems: "center" }}>
          {/* Campo con flecha de enviar DENTRO */}
          <div style={{ position: "relative", flex: 1 }}>
            <input
              maxLength={50}
              className="vibra-chat-ph"
              placeholder="Escribe un comentario…"
              onFocus={() => setChatFocused(true)}
              onBlur={() => setChatFocused(false)}
              style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 12, padding: "10px 36px 10px 12px", color: "#fff", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, outline: "none" }}
            />
            <button style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="Enviar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#a855f7" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" style={{ transform: "rotate(-20deg)" }} aria-hidden="true">
                <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
              </svg>
            </button>
          </div>
          {/* Moneda (supercomentario) + corazón (aportación) — se colapsan al enfocar */}
          <div style={{ overflow: "hidden", flexShrink: 0, width: chatFocused ? 0 : 56, marginLeft: chatFocused ? 0 : 10, opacity: chatFocused ? 0 : 1, transition: "width 0.25s ease, margin 0.25s ease, opacity 0.2s ease" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button style={{ background: "none", border: "none", padding: 0, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Supercomentario">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="8.2" /><path d="M12 7.4v9.2" />
                  <path d="M14.3 9.4c-.5-.7-1.3-1.1-2.3-1.1-1.4 0-2.4.7-2.4 1.8 0 2.5 4.9 1.2 4.9 3.8 0 1.1-1 1.8-2.5 1.8-1 0-1.9-.4-2.4-1.2" />
                </svg>
              </button>
              <button style={{ background: "none", border: "none", padding: 0, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Hacer aportación">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mockup: espectador de un LIVE horizontal en ORDENADOR ────────────────────
//    Réplica de la rama "DESKTOP — horizontal": dos cards flotantes (video
//    grande + card de chat con info del creador arriba). Se renderiza a tamaño
//    real (800×450 + 300×450) y se escala para caber en la pantalla 16:9.
function LiveDesktopSpectatorMockup() {
  const [chatFocused, setChatFocused] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [donateClosing, setDonateClosing] = useState(false);
  const closeDonate = () => setDonateClosing(true);
  const FLOAT_SHADOW = "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)";
  const headerBtn: React.CSSProperties = { background: "none", border: "none", color: "rgba(255,255,255,0.9)", padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.88)", overflow: "hidden" }}>
      <style>{`@keyframes lvmPulse3{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%) scale(0.62)", display: "flex", gap: 24 }}>

        {/* ── Card de video 800×450 ── */}
        <div style={{ position: "relative", width: 800, height: 450, background: "#000", borderRadius: 18, overflow: "hidden", flexShrink: 0, boxShadow: FLOAT_SHADOW }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://picsum.photos/seed/vibralived/960/540" alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />

          {/* Header: mute + pantalla completa + cerrar (íconos 20) */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, padding: "12px 14px" }}>
            <button style={headerBtn} aria-label="Silenciar">
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            </button>
            <button style={headerBtn} aria-label="Pantalla completa">
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
            <button style={headerBtn} aria-label="Cerrar">
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Badge EN VIVO — abajo derecha */}
          <div style={{ position: "absolute", bottom: 14, right: 14, display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(239,68,68,0.88)", borderRadius: 7, padding: "5px 11px 5px 8px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#fff", backdropFilter: "blur(4px)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "lvmPulse3 1.4s ease-in-out infinite" }} />
            EN VIVO
          </div>

          {/* Badge espectadores — abajo izquierda */}
          <div style={{ position: "absolute", bottom: 14, left: 14, display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(0,0,0,0.55)", borderRadius: 7, border: "1px solid rgba(255,255,255,0.12)", padding: "5px 10px 5px 8px", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.88)", backdropFilter: "blur(4px)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            1,284
          </div>
        </div>

        {/* ── Card de chat 300×450 ── */}
        <div style={{ width: 300, height: 450, background: "rgba(10,10,10,0.97)", borderRadius: 18, overflow: "hidden", flexShrink: 0, boxShadow: FLOAT_SHADOW, display: "flex", flexDirection: "column" }}>
          {/* Info del creador */}
          <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid transparent", display: "flex", alignItems: "center", gap: 11, flexShrink: 0 }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #ec4899 0%, #9333ea 100%)", display: "grid", placeItems: "center", fontSize: 17, fontWeight: 700, color: "#fff" }}>
              N
            </div>
            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>Nombre del creador</span>
              {/* 2ª línea: "En vivo" izquierda · like derecha */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.2 }}>En vivo</span>
                <button style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }} aria-label="Me gusta">
                  <VibraFlameIcon size={18} active />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>1,284</span>
                </button>
              </div>
            </div>
          </div>

          {/* Chat */}
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 10px", display: "flex", flexDirection: "column", gap: 1 }}>
            <LiveChatMsg initial="A" color="#f43f5e" name="Ana" text="¡Qué buena transmisión! 🔥" />
            <LiveChatMsg initial="C" color="#3b82f6" name="Carlos" text="Saludos desde México 🇲🇽" />

            {/* Supercomentario / donación */}
            <div style={{ display: "flex", gap: 8, padding: "6px 10px", alignItems: "flex-start", margin: "2px -10px" }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: "#8b5cf6", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: "#fff", boxShadow: "0 0 0 2px #a855f7" }}>L</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 4, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Lucía</span>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>donó</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>$100 MXN</span>
                </div>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", lineHeight: 1.4 }}>¡Sigue así crack! 💜</span>
              </div>
            </div>

            <LiveChatMsg initial="D" color="#10b981" name="Diego" text="¿Vas a hablar del tema nuevo?" />
            <LiveChatMsg initial="M" color="#f59e0b" name="María" text="😍😍😍" />
            <LiveChatMsg initial="J" color="#6366f1" name="Jorge" text="Primera vez aquí, todo excelente" />
          </div>

          {/* Barra de input */}
          <div style={{ padding: "8px 10px", borderTop: "1px solid transparent", flexShrink: 0, display: "flex", alignItems: "center" }}>
            {/* Campo con flecha de enviar DENTRO */}
            <div style={{ position: "relative", flex: 1 }}>
              <input maxLength={50} className="vibra-chat-ph" placeholder="Escribe un comentario…" onFocus={() => setChatFocused(true)} onBlur={() => setChatFocused(false)} style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 12, padding: "10px 36px 10px 12px", color: "#fff", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, outline: "none" }} />
              <button style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} aria-label="Enviar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#a855f7" stroke="#a855f7" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" style={{ transform: "rotate(-20deg)" }} aria-hidden="true">
                  <path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
                </svg>
              </button>
            </div>
            {/* Moneda (supercomentario) + corazón (aportación) — se colapsan al enfocar */}
            <div style={{ overflow: "hidden", flexShrink: 0, width: chatFocused ? 0 : 56, marginLeft: chatFocused ? 0 : 10, opacity: chatFocused ? 0 : 1, transition: "width 0.25s ease, margin 0.25s ease, opacity 0.2s ease" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button style={{ background: "none", border: "none", padding: 0, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Supercomentario">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="8.2" /><path d="M12 7.4v9.2" />
                    <path d="M14.3 9.4c-.5-.7-1.3-1.1-2.3-1.1-1.4 0-2.4.7-2.4 1.8 0 2.5 4.9 1.2 4.9 3.8 0 1.1-1 1.8-2.5 1.8-1 0-1.9-.4-2.4-1.2" />
                  </svg>
                </button>
                <button onClick={() => setDonateOpen(true)} style={{ background: "none", border: "none", padding: 0, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} aria-label="Hacer aportación">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ── Panel de donación — cubre toda el área del live, entra desde abajo ── */}
      {donateOpen && (
        <div
          onAnimationEnd={() => { if (donateClosing) { setDonateOpen(false); setDonateClosing(false); } }}
          style={{ position: "absolute", inset: 0, zIndex: 100, background: "#fff", overflowY: "auto", display: "flex", alignItems: "center", justifyContent: "center", animation: `${donateClosing ? "dgDown3" : "dgUp3"} 0.32s cubic-bezier(0.2,0.8,0.2,1) forwards` }}
        >
          <style>{`@keyframes dgUp3{from{transform:translateY(100%)}to{transform:translateY(0)}}@keyframes dgDown3{from{transform:translateY(0)}to{transform:translateY(100%)}}`}</style>
          <DonationGatewayMockup narrow={false} onClose={closeDonate} />
        </div>
      )}
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function VideoIconsPreview() {
  // Cambiar esta key re-monta el bloque y vuelve a disparar la animación de entrada.
  const [animKey, setAnimKey] = useState(0);

  return (
    <div style={{ background: "#0a0a0a", minHeight: "100vh", padding: "40px 32px", fontFamily: "inherit" }}>

      {/* ── Estilo del texto "Vibra" animado (copiado del login) ── */}
      <style>{`
        .vibraHeroText {
          background: linear-gradient(100deg, #ff2fb3 0%, #a855ff 45%, #4f46ff 100%);
          background-size: 220% 220%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: vibraTextFlow 4.5s ease-in-out infinite;
        }
        @keyframes vibraTextFlow {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes vibraReveal {
          0%   { opacity: 0; transform: translateY(28px) scale(0.94); filter: blur(12px); }
          60%  { opacity: 1; }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
      `}</style>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SIMULADORES — supercomentarios y donación en vivo                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <h2 style={{ color: "#fff", fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>
        Simuladores — supercomentarios y donación en vivo
      </h2>
      <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
        Lienzos vacíos para ir diseñando los paneles poco a poco. Dos celulares en vertical y una
        pantalla de ordenador en horizontal.
      </p>

      <div
        style={{
          display: "flex",
          gap: 40,
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "center",
          marginBottom: 72,
        }}
      >
        <PhoneFrame label="Celular 1 · live (espectador)">
          <LiveSpectatorMockup />
        </PhoneFrame>
        <PhoneFrame label="Celular 2 · live vertical (espectador)">
          <LivePortraitSpectatorMockup />
        </PhoneFrame>
        <DesktopFrame label="Ordenador · live horizontal (espectador)">
          <LiveDesktopSpectatorMockup />
        </DesktopFrame>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* LIENZO DE DISEÑO — animación "Vibra"                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "24px 0 56px", gap: 24 }}>
        <div
          key={animKey}
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "stretch",
            animation: "vibraReveal 1s cubic-bezier(0.22, 1, 0.36, 1) both",
            willChange: "transform, opacity, filter",
          }}
        >
          <span
            className="vibraHeroText"
            style={{ fontSize: 104, fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1 }}
          >
            Vibra
          </span>
          {/* mismo ancho que "Vibra": las letras se reparten de borde a borde */}
          <span style={{ display: "flex", justifyContent: "space-between", color: "#fff", fontSize: 30, fontWeight: 600, lineHeight: 1, marginTop: -4 }}>
            {BRAND_DOMAIN.split("").map((ch, i) => (
              <span key={i}>{ch}</span>
            ))}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setAnimKey((k) => k + 1)}
          style={{
            border: "1px solid rgba(255,255,255,0.16)",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.85)",
            borderRadius: 999,
            padding: "8px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Repetir animación
        </button>
      </div>
    </div>
  );
}
