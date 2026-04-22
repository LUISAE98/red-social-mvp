import type { CSSProperties } from "react";

export const groupPageFontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

export const groupPageUi = {
  pageMaxWidth: 1080,
  coverHeight: "clamp(190px, 35vw, 300px)",
  avatarSize: "clamp(112px, 22vw, 200px)",
  avatarOffsetTop: "clamp(-56px, -7vw, -72px)",
  cardRadius: 18,
  panelRadius: 14,
  buttonRadius: 12,
  buttonPadding: "11px 16px",
  inputPadding: "10px 12px",
  modalMaxWidth: 680,
  title: 18,
  subtitle: 16,
  body: 14,
  micro: 12,
  label: 12,
  shadow: "0 18px 48px rgba(0,0,0,0.55)",
  borderSoft: "1px solid rgba(255,255,255,0.16)",
  borderFaint: "1px solid rgba(255,255,255,0.10)",
  cardBg: "rgba(12,12,12,0.92)",
  panelBg: "rgba(255,255,255,0.03)",
};

export const pageWrap: CSSProperties = {
  minHeight: "calc(100dvh - 70px)",
  padding: "12px 0 calc(120px + env(safe-area-inset-bottom))",
  background: "#000",
  color: "#fff",
  fontFamily: groupPageFontStack,
  WebkitFontSmoothing: "antialiased",
  MozOsxFontSmoothing: "grayscale",
  textRendering: "optimizeLegibility",
};

export const container: CSSProperties = {
  maxWidth: groupPageUi.pageMaxWidth,
  margin: "0 auto",
  width: "100%",
  padding: "0",
  boxSizing: "border-box",
  minWidth: 0,
};

export const cardStyle: CSSProperties = {
  borderRadius: groupPageUi.cardRadius,
  overflow: "hidden",
  border: groupPageUi.borderSoft,
  background: groupPageUi.cardBg,
  boxShadow: groupPageUi.shadow,
  color: "#fff",
  backdropFilter: "blur(10px)",
  minWidth: 0,
};

export const panelStyle: CSSProperties = {
  borderRadius: groupPageUi.panelRadius,
  border: groupPageUi.borderFaint,
  background: groupPageUi.panelBg,
  padding: 14,
};

export const titleStyle: CSSProperties = {
  fontSize: groupPageUi.title,
  fontWeight: 600,
  lineHeight: 1.2,
  color: "#fff",
  letterSpacing: 0,
  maxWidth: 620,
  textAlign: "center",
  wordBreak: "break-word",
  overflowWrap: "anywhere",
  padding: "0 16px",
  textShadow: "0 2px 14px rgba(0,0,0,0.45)",
};

export const subtitleStyle: CSSProperties = {
  fontSize: groupPageUi.subtitle,
  fontWeight: 600,
  lineHeight: 1.2,
  color: "#fff",
  letterSpacing: 0,
};

export const textStyle: CSSProperties = {
  fontSize: groupPageUi.body,
  fontWeight: 400,
  lineHeight: 1.5,
  color: "rgba(255,255,255,0.82)",
};

export const microText: CSSProperties = {
  fontSize: groupPageUi.micro,
  fontWeight: 400,
  lineHeight: 1.45,
  color: "rgba(255,255,255,0.70)",
};

export const labelStyle: CSSProperties = {
  fontSize: groupPageUi.label,
  fontWeight: 500,
  lineHeight: 1.3,
  color: "#fff",
};

export const primaryButton: CSSProperties = {
  padding: groupPageUi.buttonPadding,
  borderRadius: groupPageUi.buttonRadius,
  border: "1px solid rgba(255,255,255,0.92)",
  background: "#fff",
  color: "#000",
  fontWeight: 700,
  fontSize: groupPageUi.body,
  lineHeight: 1.2,
  cursor: "pointer",
  fontFamily: groupPageFontStack,
  boxShadow: "0 10px 30px rgba(255,255,255,0.10)",
  minHeight: 42,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  transition: "all 160ms ease",
};

export const secondaryButton: CSSProperties = {
  padding: groupPageUi.buttonPadding,
  borderRadius: groupPageUi.buttonRadius,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.07)",
  color: "#fff",
  fontWeight: 700,
  fontSize: groupPageUi.body,
  lineHeight: 1.2,
  cursor: "pointer",
  fontFamily: groupPageFontStack,
  backdropFilter: "blur(8px)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  minHeight: 42,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  transition: "all 160ms ease",
};

export const tinyGhostButton: CSSProperties = {
  padding: "7px 10px",
  borderRadius: groupPageUi.buttonRadius,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(12,12,12,0.88)",
  color: "#fff",
  fontWeight: 600,
  fontSize: groupPageUi.micro,
  lineHeight: 1.2,
  cursor: "pointer",
  fontFamily: groupPageFontStack,
  backdropFilter: "blur(10px)",
  boxShadow: groupPageUi.shadow,
};

export const coverDonationButton: CSSProperties = {
  ...tinyGhostButton,
  position: "absolute",
  left: 12,
  top: 12,
  zIndex: 3,
  background: "rgba(0,0,0,0.92)",
  border: "1px solid rgba(255,255,255,0.18)",
};

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: groupPageUi.inputPadding,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "#fff",
  outline: "none",
  fontSize: groupPageUi.body,
  fontWeight: 400,
  fontFamily: groupPageFontStack,
  boxSizing: "border-box",
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
};

export const messageBox: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.05)",
  fontSize: groupPageUi.micro,
  fontWeight: 400,
  color: "rgba(255,255,255,0.92)",
  lineHeight: 1.45,
};

export const serviceModalBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483646,
  background: "rgba(0,0,0,0.76)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  display: "grid",
  placeItems: "center",
  padding: 16,
};

export const serviceModalCardStyle: CSSProperties = {
  width: "min(560px, 100%)",
  maxHeight: "min(88dvh, 760px)",
  overflowY: "auto",
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "linear-gradient(180deg, rgba(18,18,18,0.98) 0%, rgba(10,10,10,0.98) 100%)",
  boxShadow: "0 24px 80px rgba(0,0,0,0.52)",
  color: "#fff",
  padding: 16,
};

export const serviceToastStyle: CSSProperties = {
  position: "fixed",
  top: 16,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 2147483647,
  minWidth: 280,
  maxWidth: "min(92vw, 560px)",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(12,12,12,0.96)",
  color: "#fff",
  boxShadow: "0 18px 48px rgba(0,0,0,0.45)",
  fontSize: groupPageUi.body,
  fontWeight: 600,
  lineHeight: 1.35,
  textAlign: "center",
  backdropFilter: "blur(10px)",
};