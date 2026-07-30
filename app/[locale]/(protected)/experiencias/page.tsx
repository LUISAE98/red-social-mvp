"use client";

// Página "Mis experiencias" (lado COMPRADOR). Se llega desde la estrella junto a
// notificaciones. Subnav de 3 pestañas (Pendientes / Rechazados / Entregados) con
// los íconos reloj / tache / paloma. Reusa OwnerSidebarGreetings (con activeSection)
// alimentado por el hook autocontenido useMyExperiences. Ver docs de experiencias.

import { useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import OwnerSidebarGreetings from "@/app/components/OwnerSidebar/OwnerSidebarGreetings";
import { buildDisplayName, fmtDate } from "@/app/components/OwnerSidebar/OwnerSidebar.utils";
import { useMyExperiences } from "@/lib/experiences/useMyExperiences";

type Tab = "requested" | "rejected" | "delivered";

// Íconos del subnav (mismos que las secciones): reloj / tache / paloma.
const CLOCK_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);
const X_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);
const CHECK_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12l5 5L19 8" />
  </svg>
);

// Subset de `styles` que consume OwnerSidebarGreetings (replicado del sidebar, sin
// dependencia de isMobile). El data-layer es autocontenido (useMyExperiences).
const fontStack = "inherit";
const styles: Record<string, CSSProperties> = {
  input: { padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)", color: "#fff", outline: "none", fontSize: 12, fontFamily: fontStack, boxSizing: "border-box", height: 42 },
  buttonSecondary: { padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: fontStack, lineHeight: 1.1 },
  buttonPrimary: { padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "#fff", color: "#000", fontSize: 13, fontWeight: 700, lineHeight: 1.1, cursor: "pointer", fontFamily: fontStack },
  message: { padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#fff", fontSize: 12, lineHeight: 1.35 },
  sectionTitle: { fontSize: 11, fontWeight: 550, color: "rgba(254,254,254,0.22)", textTransform: "none", letterSpacing: 0.65 },
  sectionHeaderRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "4px 2px 2px" },
  createInlineButton: { minHeight: 24, padding: "0 9px", borderRadius: 9, border: "2.5px solid rgba(168,85,247,0.75)", background: "transparent", color: "rgba(168,85,247,0.92)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 11, fontWeight: 700, fontFamily: fontStack, lineHeight: 1, cursor: "pointer", opacity: 0.85 },
  card: { padding: "10px 12px", borderRadius: 12, background: "#000", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 18px 44px rgba(0,0,0,0.34)" },
  subtle: { fontSize: 11, color: "rgba(255,255,255,0.56)", lineHeight: 1.3 },
  sectionPanel: { padding: "10px", borderRadius: 12, border: "none", background: "rgba(90,41,174,0.14)", boxShadow: "none", display: "grid", gap: 8 },
  miniItem: { borderRadius: 12, border: "none", background: "transparent", boxShadow: "none", padding: 9, display: "grid", gap: 7, width: "100%", boxSizing: "border-box", minWidth: 0 },
};

export default function ExperienciasPage() {
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const tWallet = useTranslations("wallet");
  const tServices = useTranslations("services");
  const tSessions = useTranslations("sessions");
  const router = useRouter();
  const { user } = useAuth();
  const exp = useMyExperiences(user?.uid);
  const [tab, setTab] = useState<Tab>("requested");

  function renderUserLink(uid: string): ReactNode {
    const u = exp.userMiniMap[uid];
    const label = u?.displayName ?? buildDisplayName(null, uid, tCommon("user"));
    const href = u?.handle ? `/u/${u.handle}` : null;
    if (!href) {
      return <span style={{ color: "#fff", fontWeight: 600, fontSize: 12, lineHeight: 1.2 }}>{label}</span>;
    }
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); router.push(href); }}
        style={{ background: "transparent", border: "none", padding: 0, margin: 0, color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 12, lineHeight: 1.2 }}
      >
        {label}
      </button>
    );
  }

  const typeLabel = (type: string) => {
    if (type === "saludo") return tWallet("typeLabelGreeting");
    if (type === "consejo") return tWallet("typeLabelAdvice");
    if (type === "mensaje") return tWallet("typeLabelMessage");
    if (type === "meet_greet_digital") return tSessions("meetGreetTitle");
    if (type === "exclusive_session" || type === "clase_personalizada" || type === "digital_exclusive_session") return tServices("exclusiveSession");
    return type;
  };

  const tabs: Array<{ key: Tab; label: string; icon: ReactNode; color: string }> = [
    { key: "requested", label: tWallet("sectionPending"), icon: CLOCK_ICON, color: "#a855f7" },
    { key: "rejected", label: tWallet("sectionRejected"), icon: X_ICON, color: "#ef4444" },
    { key: "delivered", label: tCommon("delivered"), icon: CHECK_ICON, color: "#22c55e" },
  ];

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 12px 48px", width: "100%", boxSizing: "border-box" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: "4px 2px 14px", letterSpacing: "-0.02em" }}>
        {tNav("tabExperiences")}
      </h1>

      {/* Subnav de pestañas */}
      <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                padding: "10px 6px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                border: active ? `1px solid ${t.color}` : "1px solid rgba(255,255,255,0.10)",
                background: active ? "rgba(255,255,255,0.05)" : "transparent",
                color: active ? t.color : "rgba(255,255,255,0.55)",
                transition: "color 150ms ease, border-color 150ms ease, background 150ms ease",
              }}
            >
              <span style={{ display: "inline-flex" }}>{t.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: active ? "#fff" : "rgba(255,255,255,0.55)" }}>{t.label}</span>
            </button>
          );
        })}
      </div>

      {exp.loading ? (
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>{tCommon("loading")}</p>
      ) : (
        <OwnerSidebarGreetings
          activeSection={tab}
          buyerPending={exp.buyerPending}
          buyerDelivered={exp.buyerDelivered}
          buyerRejectedGreetings={exp.buyerRejectedGreetings}
          buyerMeetGreets={exp.buyerMeetGreets}
          buyerExclusiveSessions={exp.buyerExclusiveSessions}
          exclusiveSessionsByGroup={{}}
          meetGreetsByGroup={{}}
          groupMetaMap={exp.groupMetaMap}
          userMiniMap={exp.userMiniMap}
          styles={styles}
          typeLabel={typeLabel}
          fmtDate={fmtDate}
          renderUserLink={renderUserLink}
          router={router}
        />
      )}
    </div>
  );
}
