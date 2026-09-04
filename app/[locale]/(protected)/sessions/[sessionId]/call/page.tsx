"use client";

// Ruta standalone para videollamada: /sessions/[sessionId]/call?type=meet_greet&role=buyer
// Se usa cuando se accede directamente desde un enlace, fuera del panel de preparación.

import { type CSSProperties } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import LiveKitVideoRoom from "@/app/components/liveKit/LiveKitVideoRoom";
import type { LivekitSessionType } from "@/lib/liveKit/getLivekitToken";
import { useScreenReady } from "@/lib/useScreenReady";

export default function SessionCallPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  /**
   * Va ANTES de las guardas de abajo, que hacen returns tempranos: un hook no
   * puede quedar detrás de un return.
   *
   * Espera a que la sesión esté resuelta, no a tener sala: sin eso, `user` es
   * null durante un instante y apagar el splash ahí enseñaría el mensaje de
   * "inicia sesión" a quien sí la tiene. Con la sesión resuelta ya hay algo
   * correcto que pintar, sea la llamada o el aviso.
   */
  useScreenReady(!authLoading);

  const tSessions = useTranslations("sessions");
  const tCommon = useTranslations("common");

  const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;

  const typeParam = searchParams.get("type");
  const sessionType: LivekitSessionType | null =
    typeParam === "meet_greet" || typeParam === "exclusive_session" ? typeParam : null;

  const roleParam = searchParams.get("role");
  const role: "buyer" | "creator" = roleParam === "creator" ? "creator" : "buyer";

  const handleLeave = () => router.back();

  // ── Guardas ────────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div style={screen}>
        <p style={errorMsg}>{tSessions("mustLoginToJoinSession")}</p>
      </div>
    );
  }

  if (!sessionId || !sessionType) {
    return (
      <div style={screen}>
        <p style={errorMsg}>{tSessions("invalidSessionLink")}</p>
        <button type="button" onClick={handleLeave} style={backButton}>
          {tCommon("back")}
        </button>
      </div>
    );
  }

  // ── Vista de llamada ───────────────────────────────────────────────────────
  const sessionLabel = sessionType === "meet_greet" ? tSessions("meetGreetTitle") : tSessions("exclusiveSessionTitle");

  return (
    <div style={screen}>
      {/* Barra superior */}
      <div style={topBar}>
        <span style={titleStyle}>{sessionLabel}</span>
      </div>

      {/* Área de video */}
      <div style={videoWrapper}>
        <LiveKitVideoRoom
          sessionId={sessionId}
          sessionType={sessionType}
          role={role}
          onLeave={handleLeave}
        />
      </div>
    </div>
  );
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

const screen: CSSProperties = {
  position: "fixed",
  inset: 0,
  height: "var(--vb-alto-pantalla)",
  zIndex: 9999,
  background: "rgba(0,0,0,0.95)",
  display: "flex",
  flexDirection: "column",
  paddingTop: "env(safe-area-inset-top)",
  paddingInlineEnd: "env(safe-area-inset-right)",
  paddingBottom: "var(--vb-safe-bottom, 0px)",
  paddingInlineStart: "env(safe-area-inset-left)",
  boxSizing: "border-box",
};

const topBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "max(12px,1.8dvh) 16px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  flexShrink: 0,
  minHeight: 60,
  boxSizing: "border-box",
};

const titleStyle: CSSProperties = {
  fontSize: "clamp(14px,4dvw,16px)",
  fontWeight: 800,
  color: "#fff",
  lineHeight: 1.15,
};

const videoWrapper: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  padding: "12px 16px max(12px,var(--vb-safe-bottom, 0px))",
  overflow: "hidden",
  boxSizing: "border-box",
};

const errorMsg: CSSProperties = {
  color: "rgba(255,255,255,0.75)",
  fontSize: 15,
  textAlign: "center",
  margin: "auto",
  padding: 24,
};

const backButton: CSSProperties = {
  margin: "12px auto 0",
  display: "block",
  padding: "10px 20px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.20)",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};
