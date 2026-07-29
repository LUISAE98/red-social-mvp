"use client";
import React, { useState } from "react";

// Mockups y helpers presentacionales de la página dev de session-panels.
// Extraído de page.tsx (#5, opción B). Solo dev; sin lógica de producción.

/* ─── Constants ───────────────────────────────────────────────────────── */
export const BLUE = "#2563eb";
export const PINK = "#be185d";
export const DARK_OVERLAY = "linear-gradient(160deg,rgba(0,0,0,.60) 0%,rgba(0,0,0,.80) 100%)";
export const CREATOR_NAME = "Luis García";
export const BUYER_NAME = "Ana Torres";
export const DATE_LABEL = "14 de julio, 18:00";
export const DURATION = 30;

export type Kind = "meet_greet" | "exclusive_session";

/* ─── Shared helpers ──────────────────────────────────────────────────── */
export function Avt({
  name,
  size = 44,
  border = "rgba(255,255,255,.22)",
}: {
  name: string;
  size?: number;
  border?: string;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        background: "rgba(255,255,255,.10)",
        border: `2px solid ${border}`,
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.38,
        fontWeight: 700,
        color: "#fff",
        textTransform: "uppercase",
      }}
    >
      {name[0]}
    </div>
  );
}

export function BannerWrap({ kind, children }: { kind: Kind; children: React.ReactNode }) {
  const bg =
    kind === "meet_greet" ? "/encuentroenvivo.webp" : "/sesionexclusiva.webp";
  return (
    <div
      style={{
        width: "100%",
        position: "relative",
        borderRadius: 12,
        overflow: "hidden",
        boxSizing: "border-box",
        backgroundImage: `url(${bg})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: DARK_OVERLAY }} />
      <div
        style={{
          position: "relative",
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function PLabel({
  num,
  title,
  tag,
}: {
  num: number;
  title: string;
  tag?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 10,
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "#141414",
          border: "1px solid rgba(255,255,255,.18)",
          display: "grid",
          placeItems: "center",
          fontSize: 11,
          fontWeight: 700,
          color: "rgba(255,255,255,.65)",
          flexShrink: 0,
        }}
      >
        {num}
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#e4e4e7" }}>
        {title}
      </span>
      {tag && (
        <span
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,.4)",
            background: "rgba(255,255,255,.06)",
            borderRadius: 4,
            padding: "2px 6px",
            letterSpacing: ".03em",
          }}
        >
          {tag}
        </span>
      )}
    </div>
  );
}

export function PBlock({
  num,
  title,
  tag,
  children,
}: {
  num: number;
  title: string;
  tag?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 36 }}>
      <PLabel num={num} title={title} tag={tag} />
      <div style={{ maxWidth: 380 }}>{children}</div>
    </div>
  );
}

export function SectionTitle({ label }: { label: string }) {
  return (
    <div
      style={{
        marginTop: 48,
        marginBottom: 28,
        paddingBottom: 14,
        borderBottom: "1px solid rgba(255,255,255,.08)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,.35)",
          marginBottom: 4,
        }}
      >
        Flujo
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>{label}</div>
    </div>
  );
}

export function CountdownRow({
  personName,
  label,
  value,
  color = "#fff",
}: {
  personName: string;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Avt name={personName} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,.65)",
            fontWeight: 500,
            marginBottom: 3,
          }}
        >
          Sesión con
        </div>
        <div
          style={{
            fontSize: 16,
            color: "#fff",
            fontWeight: 700,
            letterSpacing: "-0.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {personName}
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: "right", maxWidth: "40%" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            marginBottom: 2,
            lineHeight: 1.3,
            color,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: "-0.03em",
            fontVariantNumeric: "tabular-nums",
            color,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-panel components ────────────────────────────────────────────── */

export function SessionCardMockup({
  kind,
  status,
  date,
  expanded = false,
}: {
  kind: Kind;
  status: string;
  date: string | null;
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(expanded);
  const statusColors: Record<string, string> = {
    pending_creator_response: "rgba(255,255,255,.60)",
    accepted_pending_schedule: "rgba(255,255,255,.60)",
    scheduled: "#86efac",
    completed: "#86efac",
    rejected: "#fca5a5",
  };
  const statusLabels: Record<string, string> = {
    pending_creator_response: "Pendiente de respuesta",
    accepted_pending_schedule: "Aceptada · Falta fecha",
    scheduled: "Agendada",
  };
  const color = statusColors[status] ?? "rgba(255,255,255,.60)";
  const label = statusLabels[status] ?? status;

  return (
    <div
      style={{
        borderRadius: 12,
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.08)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          cursor: "pointer",
          textAlign: "left",
          color: "#fff",
          fontFamily: "inherit",
        }}
      >
        <Avt name={CREATOR_NAME} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
              {kind === "meet_greet" ? "Tiempo contigo" : "Sesión exclusiva"}
            </span>
            <span style={{ fontSize: 11, color, fontWeight: 500 }}>{label}</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.45)" }}>
            {CREATOR_NAME}
          </div>
          {date && (
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,.40)",
                marginTop: 3,
              }}
            >
              {date}
            </div>
          )}
        </div>
        <span style={{ color: "rgba(255,255,255,.30)", fontSize: 12 }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div
          style={{
            padding: "0 16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            borderTop: "1px solid rgba(255,255,255,.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: "rgba(255,255,255,.5)",
              paddingTop: 10,
            }}
          >
            <span>Duración</span>
            <span style={{ color: "#fff", fontWeight: 600 }}>{DURATION} min</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: "rgba(255,255,255,.5)",
            }}
          >
            <span>Precio</span>
            <span style={{ color: "#fff", fontWeight: 600 }}>$350 MXN</span>
          </div>
          <div
            style={{
              background: "rgba(255,255,255,.06)",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
              color: "rgba(255,255,255,.7)",
              lineHeight: 1.5,
              marginTop: 4,
            }}
          >
            Quiero hablar sobre mi proyecto de música y recibir tus consejos.
          </div>
        </div>
      )}
    </div>
  );
}

export function BuyerOverlayMockup({ kind, accent }: { kind: Kind; accent: string }) {
  return (
    <div
      style={{
        borderRadius: 16,
        background: "#111",
        border: "1px solid rgba(255,255,255,.10)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 16px 12px",
          borderBottom: "1px solid rgba(255,255,255,.07)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avt name={CREATOR_NAME} size={44} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,.45)",
                marginBottom: 2,
              }}
            >
              {kind === "meet_greet" ? "Tiempo contigo" : "Sesión exclusiva"} ·{" "}
              {DURATION} min
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>
              {CREATOR_NAME}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#86efac",
                fontWeight: 600,
                marginTop: 2,
              }}
            >
              Agendada · {DATE_LABEL}
            </div>
          </div>
        </div>
      </div>
      {/* Dates row */}
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          gap: 10,
          borderBottom: "1px solid rgba(255,255,255,.07)",
        }}
      >
        <div style={{ flex: 1, fontSize: 12, color: "rgba(255,255,255,.5)" }}>
          <div
            style={{
              color: "rgba(255,255,255,.65)",
              fontWeight: 600,
              marginBottom: 2,
            }}
          >
            Fecha agendada
          </div>
          {DATE_LABEL}
        </div>
        <div style={{ flex: 1, fontSize: 12, color: "rgba(255,255,255,.5)" }}>
          <div
            style={{
              color: "rgba(255,255,255,.65)",
              fontWeight: 600,
              marginBottom: 2,
            }}
          >
            Duración
          </div>
          {DURATION} min
        </div>
      </div>
      {/* Message thread */}
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,.35)",
            marginBottom: 2,
          }}
        >
          Mensajes
        </div>
        <div
          style={{
            alignSelf: "flex-end",
            background: "rgba(255,255,255,.08)",
            borderRadius: "10px 10px 2px 10px",
            padding: "8px 12px",
            fontSize: 13,
            color: "#fff",
            maxWidth: "85%",
          }}
        >
          Quiero hablar sobre mi proyecto de música
        </div>
        <div
          style={{
            alignSelf: "flex-start",
            background: "rgba(255,255,255,.06)",
            borderRadius: "10px 10px 10px 2px",
            padding: "8px 12px",
            fontSize: 13,
            color: "rgba(255,255,255,.8)",
            maxWidth: "85%",
          }}
        >
          ¡Perfecto! Te espero el 14 de julio a las 18:00
        </div>
      </div>
      {/* Actions */}
      <div
        style={{
          padding: "10px 16px 16px",
          display: "flex",
          gap: 8,
        }}
      >
        <button
          type="button"
          style={{
            flex: 1,
            height: 36,
            borderRadius: 8,
            border: "none",
            background: "rgba(255,255,255,.08)",
            color: "rgba(255,255,255,.7)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Reagendar
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            height: 36,
            borderRadius: 8,
            border: "none",
            background: "rgba(255,255,255,.08)",
            color: "rgba(255,255,255,.7)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Solicitar devolución
        </button>
      </div>
    </div>
  );
}

export function PrepScreenMockup({
  role,
  kind,
  accent,
}: {
  role: "buyer" | "creator";
  kind: Kind;
  accent: string;
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        background: "#000",
        overflow: "hidden",
        position: "relative",
        aspectRatio: "16/9",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
      }}
    >
      {/* Dark video area */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#0d0d0d",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Avt
          name={role === "buyer" ? BUYER_NAME : CREATOR_NAME}
          size={64}
        />
      </div>
      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background:
            "linear-gradient(to bottom, rgba(0,0,0,.7), transparent)",
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)" }}>
            {role === "buyer" ? `Sesión con ${CREATOR_NAME}` : `Sesión con ${BUYER_NAME}`}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#fff",
              marginTop: 1,
            }}
          >
            {DATE_LABEL} · {DURATION} min
          </div>
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#4ade80",
            fontVariantNumeric: "tabular-nums",
            background: "rgba(0,0,0,.5)",
            borderRadius: 6,
            padding: "3px 8px",
          }}
        >
          00:00
        </div>
      </div>
      {/* Controls */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background:
            "linear-gradient(to top, rgba(0,0,0,.85), transparent)",
          padding: "20px 14px 12px",
          display: "flex",
          justifyContent: "center",
          gap: 10,
        }}
      >
        {["🎤", "📷", "📤", "🔴"].map((icon, i) => (
          <div
            key={i}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background:
                i === 3 ? "#dc2626" : "rgba(255,255,255,.12)",
              display: "grid",
              placeItems: "center",
              fontSize: 16,
              cursor: "pointer",
              border: "1px solid rgba(255,255,255,.10)",
            }}
          >
            {icon}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ServicesConfigMockup({
  kind,
  accent,
}: {
  kind: Kind;
  accent: string;
}) {
  const [enabled, setEnabled] = useState(true);
  return (
    <div
      style={{
        borderRadius: 14,
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.08)",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              marginBottom: 2,
            }}
          >
            {kind === "meet_greet" ? "Tiempo contigo" : "Sesión exclusiva"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.45)" }}>
            {kind === "meet_greet" ? "5–25 minutos" : "5–90 minutos"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          style={{
            width: 44,
            height: 24,
            borderRadius: 12,
            background: enabled ? accent : "rgba(255,255,255,.15)",
            border: "none",
            position: "relative",
            cursor: "pointer",
            transition: "background .2s",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 2,
              left: enabled ? undefined : 2,
              right: enabled ? 2 : undefined,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#fff",
              transition: "right .2s, left .2s",
            }}
          />
        </button>
      </div>
      {enabled && (
        <>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,.45)",
                  marginBottom: 6,
                }}
              >
                Precio
              </div>
              <div
                style={{
                  borderRadius: 8,
                  background: "rgba(255,255,255,.06)",
                  border: "1px solid rgba(255,255,255,.10)",
                  padding: "8px 12px",
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#fff",
                }}
              >
                $350 MXN
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,.45)",
                  marginBottom: 6,
                }}
              >
                Duración
              </div>
              <div
                style={{
                  borderRadius: 8,
                  background: "rgba(255,255,255,.06)",
                  border: "1px solid rgba(255,255,255,.10)",
                  padding: "8px 12px",
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#fff",
                }}
              >
                {DURATION} min
              </div>
            </div>
          </div>
          <button
            type="button"
            style={{
              width: "100%",
              height: 38,
              borderRadius: 8,
              border: "none",
              background: accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Guardar cambios
          </button>
        </>
      )}
    </div>
  );
}

export function PendingCardMockup({
  kind,
  accent,
  status = "pending_creator_response",
  date,
}: {
  kind: Kind;
  accent: string;
  status?: string;
  date?: string | null;
}) {
  const statusColors: Record<string, string> = {
    pending_creator_response: "#fde68a",
    accepted_pending_schedule: "#fde68a",
    scheduled: "#86efac",
  };
  const statusLabels: Record<string, string> = {
    pending_creator_response: "Pendiente",
    accepted_pending_schedule: "Aceptada",
    scheduled: "Agendada",
  };

  return (
    <div
      style={{
        borderRadius: 12,
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.08)",
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background:
            kind === "meet_greet"
              ? "rgba(37,99,235,.25)"
              : "rgba(190,24,93,.25)",
          display: "grid",
          placeItems: "center",
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {kind === "meet_greet" ? "🤝" : "🎬"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
            {kind === "meet_greet" ? "Tiempo contigo" : "Sesión exclusiva"}
          </span>
          <span
            style={{
              fontSize: 10,
              color: statusColors[status] ?? "rgba(255,255,255,.5)",
              fontWeight: 600,
            }}
          >
            {statusLabels[status] ?? status}
          </span>
        </div>
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,.45)",
            marginTop: 3,
          }}
        >
          {BUYER_NAME}
          {date ? ` · ${date}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>$350</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,.35)", marginTop: 2 }}>
          MXN
        </div>
      </div>
    </div>
  );
}

export function CreatorOverlayMockup({
  kind,
  accent,
}: {
  kind: Kind;
  accent: string;
}) {
  return (
    <div
      style={{
        borderRadius: 16,
        background: "#111",
        border: "1px solid rgba(255,255,255,.10)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px",
          borderBottom: "1px solid rgba(255,255,255,.07)",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}
        >
          <Avt name={BUYER_NAME} size={44} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,.45)",
                marginBottom: 2,
              }}
            >
              {kind === "meet_greet" ? "Tiempo contigo" : "Sesión exclusiva"} ·
              $350 MXN
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>
              {BUYER_NAME}
            </div>
            <div
              style={{ fontSize: 11, color: "rgba(255,255,255,.5)", marginTop: 2 }}
            >
              hace 3 min · pendiente
            </div>
          </div>
        </div>
        <div
          style={{
            background: "rgba(255,255,255,.06)",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 13,
            color: "rgba(255,255,255,.8)",
            lineHeight: 1.5,
          }}
        >
          Hola, me gustaría hablar sobre mi proyecto de música y recibir tus
          consejos.
        </div>
      </div>
      {/* Info row */}
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          gap: 10,
          borderBottom: "1px solid rgba(255,255,255,.07)",
        }}
      >
        <div style={{ flex: 1, fontSize: 12, color: "rgba(255,255,255,.5)" }}>
          <div
            style={{
              color: "rgba(255,255,255,.7)",
              fontWeight: 600,
              marginBottom: 2,
            }}
          >
            Duración
          </div>
          {DURATION} min
        </div>
        <div style={{ flex: 1, fontSize: 12, color: "rgba(255,255,255,.5)" }}>
          <div
            style={{
              color: "rgba(255,255,255,.7)",
              fontWeight: 600,
              marginBottom: 2,
            }}
          >
            Ganancia
          </div>
          $297 MXN
        </div>
      </div>
      {/* Actions */}
      <div style={{ padding: "12px 16px", display: "flex", gap: 8 }}>
        <button
          type="button"
          style={{
            flex: 1,
            height: 40,
            borderRadius: 8,
            border: "none",
            background: accent,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Aceptar y agendar
        </button>
        <button
          type="button"
          style={{
            height: 40,
            paddingInline: 14,
            borderRadius: 8,
            border: "none",
            background: "rgba(255,255,255,.08)",
            color: "rgba(255,255,255,.7)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Rechazar
        </button>
      </div>
    </div>
  );
}

export function RejectionFormMockup() {
  return (
    <div
      style={{
        borderRadius: 14,
        background: "#111",
        border: "1px solid rgba(255,255,255,.10)",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
        Motivo del rechazo
      </div>
      <div
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,.45)",
          lineHeight: 1.5,
        }}
      >
        El comprador recibirá un reembolso completo. Opcionalmente puedes
        indicar el motivo.
      </div>
      <textarea
        readOnly
        placeholder="Motivo (opcional)"
        rows={3}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "rgba(255,255,255,.06)",
          border: "none",
          borderRadius: 12,
          padding: "10px 12px",
          color: "rgba(255,255,255,.4)",
          fontSize: 13,
          fontFamily: "inherit",
          lineHeight: 1.5,
          resize: "none",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          style={{
            flex: 1,
            height: 38,
            borderRadius: 8,
            border: "none",
            background: "rgba(239,68,68,.25)",
            color: "#fca5a5",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Confirmar rechazo
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            height: 38,
            borderRadius: 8,
            border: "none",
            background: "rgba(255,255,255,.08)",
            color: "rgba(255,255,255,.7)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function DateSelectorMockup({
  kind,
  accent,
  compact = false,
}: {
  kind: Kind;
  accent: string;
  compact?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 10 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {[
          { label: "14", flex: 1 },
          { label: "Julio", flex: 2 },
          { label: "2026", flex: 1 },
        ].map((item, i) => (
          <div
            key={i}
            style={{
              flex: item.flex,
              borderRadius: 8,
              background: "rgba(255,255,255,.08)",
              border: "1px solid rgba(255,255,255,.12)",
              padding: compact ? "6px 8px" : "8px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: compact ? 12 : 13,
              color: "#fff",
              fontWeight: 600,
            }}
          >
            <span>{item.label}</span>
            <span style={{ color: "rgba(255,255,255,.3)", fontSize: 10 }}>▼</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {["18", "00"].map((val, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              borderRadius: 8,
              background: "rgba(255,255,255,.08)",
              border: "1px solid rgba(255,255,255,.12)",
              padding: compact ? "6px 8px" : "8px 10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: compact ? 12 : 13,
              color: "#fff",
              fontWeight: 600,
            }}
          >
            <span>{val}</span>
            <span style={{ color: "rgba(255,255,255,.3)", fontSize: 10 }}>▼</span>
          </div>
        ))}
        <div
          style={{
            fontSize: compact ? 16 : 18,
            color: "rgba(255,255,255,.4)",
            fontWeight: 700,
          }}
        >
          :
        </div>
      </div>
      {!compact && (
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,.35)",
            lineHeight: 1.4,
          }}
        >
          El comprador está en UTC−6 (misma hora que tú)
        </div>
      )}
    </div>
  );
}
