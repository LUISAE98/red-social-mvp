import type { CSSProperties } from "react";

/**
 * El `styles` que consume `OwnerSidebarGreetings` para pintar las tarjetas de
 * experiencias.
 *
 * Vive aparte porque ya lo necesitan dos sitios: la página /experiencias y la
 * sección "Mis experiencias" del menú lateral. Mientras fue una constante suelta
 * dentro de la página, la única forma de enseñar esas mismas tarjetas en otro
 * lado era copiar el objeto — y dos copias se separan a la primera corrección,
 * que es justo lo que NO puede pasar aquí: la gracia de la sección del menú es
 * que la tarjeta sea idéntica a la de la página, no parecida.
 *
 * Sin dependencia de `isMobile`: los mismos valores en los dos tamaños.
 */
const fontStack = "inherit";

export const greetingsCardStyles: Record<string, CSSProperties> = {
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
