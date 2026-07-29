"use client";
import { useState } from "react";
import {
  BLUE,
  PINK,
  DARK_OVERLAY,
  CREATOR_NAME,
  BUYER_NAME,
  DATE_LABEL,
  DURATION,
  type Kind,
  Avt,
  BannerWrap,
  PBlock,
  SectionTitle,
  CountdownRow,
  SessionCardMockup,
  BuyerOverlayMockup,
  PrepScreenMockup,
  ServicesConfigMockup,
  PendingCardMockup,
  CreatorOverlayMockup,
  RejectionFormMockup,
  DateSelectorMockup,
} from "./session-panels.mockups";


/* ─── Main page ───────────────────────────────────────────────────────── */
export default function SessionPanelsPage() {
  const [kind, setKind] = useState<Kind>("meet_greet");
  const accent = kind === "meet_greet" ? BLUE : PINK;

  const [resched10, setResched10] = useState(false);
  const [resched25, setResched25] = useState(false);

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#090909",
        color: "#fff",
        fontFamily:
          "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        padding: "32px 24px 80px",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,.4)",
            marginBottom: 8,
          }}
        >
          Panel de pruebas
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: "#fff",
            letterSpacing: "-0.03em",
          }}
        >
          Flujo de sesiones
        </h1>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 13,
            color: "rgba(255,255,255,.45)",
            lineHeight: 1.5,
          }}
        >
          28 paneles · Tiempo Contigo y Sesión Exclusiva
        </p>
      </div>

      {/* Kind toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        {(["meet_greet", "exclusive_session"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            style={{
              height: 34,
              paddingInline: 14,
              borderRadius: 8,
              border: "none",
              background:
                kind === k
                  ? k === "meet_greet"
                    ? BLUE
                    : PINK
                  : "rgba(255,255,255,.08)",
              color:
                kind === k ? "#fff" : "rgba(255,255,255,.55)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "background .15s",
            }}
          >
            {k === "meet_greet" ? "Tiempo contigo" : "Sesión exclusiva"}
          </button>
        ))}
      </div>
      <p
        style={{
          margin: "0 0 32px",
          fontSize: 11,
          color: "rgba(255,255,255,.3)",
        }}
      >
        El toggle cambia el color del acento en todos los paneles.
      </p>

      {/* ══════════════════ COMPRADOR ══════════════════ */}
      <SectionTitle label="Comprador" />

      {/* 1 — Card del servicio */}
      <PBlock num={1} title="Card del servicio" tag="perfil / grupo">
        <div
          style={{
            borderRadius: 14,
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.09)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: 90,
              backgroundImage: `url(${kind === "meet_greet" ? "/encuentroenvivo.webp" : "/sesionexclusiva.webp"})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(to bottom, transparent 30%, rgba(0,0,0,.7))",
              }}
            />
            <div style={{ position: "absolute", bottom: 10, left: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
                {kind === "meet_greet" ? "Tiempo contigo" : "Sesión exclusiva"}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,.65)",
                  marginTop: 2,
                }}
              >
                {DURATION} min
              </div>
            </div>
          </div>
          <div
            style={{
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>
                $350 MXN
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,.45)",
                  marginTop: 2,
                }}
              >
                por sesión
              </div>
            </div>
            <button
              type="button"
              style={{
                height: 36,
                paddingInline: 18,
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
              Reservar
            </button>
          </div>
        </div>
      </PBlock>

      {/* 2 — Modal de solicitud */}
      <PBlock num={2} title="Modal de solicitud" tag="comprador">
        <div
          style={{
            borderRadius: 16,
            background: "#111",
            border: "1px solid rgba(255,255,255,.10)",
            padding: "20px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avt name={CREATOR_NAME} size={40} />
            <div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,.5)" }}>
                Reservar sesión con
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>
                {CREATOR_NAME}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div
              style={{
                flex: 1,
                borderRadius: 8,
                background: "rgba(255,255,255,.06)",
                padding: "8px 12px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,.45)",
                  marginBottom: 2,
                }}
              >
                Duración
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
                {DURATION} min
              </div>
            </div>
            <div
              style={{
                flex: 1,
                borderRadius: 8,
                background: "rgba(255,255,255,.06)",
                padding: "8px 12px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,.45)",
                  marginBottom: 2,
                }}
              >
                Precio
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
                $350 MXN
              </div>
            </div>
          </div>
          <textarea
            readOnly
            placeholder="¿Qué quieres hablar o hacer en la sesión?"
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
          <button
            type="button"
            style={{
              width: "100%",
              height: 44,
              borderRadius: 10,
              border: "none",
              background: accent,
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Confirmar reserva · $350 MXN
          </button>
        </div>
      </PBlock>

      {/* 3 — Pendiente respuesta */}
      <PBlock num={3} title="Sesión pendiente" tag="pending_creator_response">
        <SessionCardMockup kind={kind} status="pending_creator_response" date={null} />
      </PBlock>

      {/* 4 — Aceptada sin fecha */}
      <PBlock num={4} title="Aceptada, sin fecha" tag="accepted_pending_schedule">
        <SessionCardMockup kind={kind} status="accepted_pending_schedule" date={null} />
      </PBlock>

      {/* 5 — Overlay de detalle comprador */}
      <PBlock num={5} title="Overlay de detalle" tag="comprador">
        <BuyerOverlayMockup kind={kind} accent={accent} />
      </PBlock>

      {/* 6 — Sesión agendada */}
      <PBlock num={6} title="Sesión agendada" tag="scheduled">
        <SessionCardMockup kind={kind} status="scheduled" date={DATE_LABEL} expanded />
      </PBlock>

      {/* 7 — Banner agendada, botón deshabilitado */}
      <PBlock num={7} title="Banner: sesión próxima" tag=">15 min">
        <BannerWrap kind={kind}>
          <CountdownRow
            personName={CREATOR_NAME}
            label="Inicia en"
            value="04:32:17"
          />
          <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
            <svg
              width={15}
              height={15}
              viewBox="0 0 24 24"
              fill="none"
              stroke={kind === "meet_greet" ? "#93c5fd" : "#f9a8d4"}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="8.01" />
              <line x1="12" y1="12" x2="12" y2="16" />
            </svg>
            <span
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,.60)",
                lineHeight: 1.4,
              }}
            >
              Faltando 15 minutos podrás prepararte para entrar a tu sesión
            </span>
          </div>
          <button
            type="button"
            disabled
            style={{
              width: "100%",
              height: 40,
              borderRadius: 8,
              border: "none",
              background: "rgba(255,255,255,.14)",
              color: "rgba(255,255,255,.35)",
              fontSize: 15,
              fontWeight: 600,
              cursor: "not-allowed",
              fontFamily: "inherit",
            }}
          >
            Prepararse
          </button>
        </BannerWrap>
      </PBlock>

      {/* 8 — Banner -10min, botón activo */}
      <PBlock num={8} title="Banner: listo para entrar" tag="-10 min">
        <BannerWrap kind={kind}>
          <CountdownRow
            personName={CREATOR_NAME}
            label="Inicia en"
            value="00:08:41"
          />
          <button
            type="button"
            style={{
              width: "100%",
              height: 40,
              borderRadius: 8,
              border: "none",
              background:
                kind === "meet_greet"
                  ? "linear-gradient(135deg,#2563eb 0%,#3b82f6 100%)"
                  : "linear-gradient(135deg,#be185d 0%,#ec4899 100%)",
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Prepararse
          </button>
        </BannerWrap>
      </PBlock>

      {/* 9 — Banner tolerancia expirada */}
      <PBlock num={9} title="Banner: tolerancia expirada" tag=">15 min tarde">
        <BannerWrap kind={kind}>
          <CountdownRow
            personName={CREATOR_NAME}
            label="Se acabó el tiempo"
            value="15:00"
            color="#fb923c"
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontSize: 12,
                color: "#fb923c",
                lineHeight: 1.4,
                fontWeight: 500,
              }}
            >
              El tiempo de tolerancia venció. Elige una opción:
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 6,
                  border: "none",
                  background: accent,
                  color: "#fff",
                  fontSize: 13,
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
                  borderRadius: 6,
                  border: "none",
                  background: "rgba(255,255,255,.10)",
                  color: "rgba(255,255,255,.70)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Solicitar devolución
              </button>
            </div>
          </div>
        </BannerWrap>
      </PBlock>

      {/* 10 — Banner form de reagenda (accordion) */}
      <PBlock num={10} title="Banner: form de reagenda" tag="accordion · clic Reagendar">
        <BannerWrap kind={kind}>
          <CountdownRow
            personName={CREATOR_NAME}
            label="Se acabó el tiempo"
            value="15:00"
            color="#fb923c"
          />
          {/* Buttons — colapsa al abrir form */}
          <div
            style={{
              overflow: "hidden",
              maxHeight: resched10 ? 0 : "120px",
              opacity: resched10 ? 0 : 1,
              transition:
                "max-height .30s cubic-bezier(.16,1,.3,1),opacity .18s ease",
              pointerEvents: resched10 ? "none" : "auto",
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setResched10(true)}
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 6,
                  border: "none",
                  background: accent,
                  color: "#fff",
                  fontSize: 13,
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
                  borderRadius: 6,
                  border: "none",
                  background: "rgba(255,255,255,.10)",
                  color: "rgba(255,255,255,.70)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Solicitar devolución
              </button>
            </div>
          </div>
          {/* Form — aparece */}
          <div
            style={{
              overflow: "hidden",
              maxHeight: resched10 ? "280px" : 0,
              opacity: resched10 ? 1 : 0,
              transition:
                "max-height .30s cubic-bezier(.16,1,.3,1),opacity .18s ease",
              pointerEvents: resched10 ? "auto" : "none",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                paddingTop: 2,
              }}
            >
              <textarea
                placeholder="Motivo del cambio de fecha (opcional)"
                rows={3}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "rgba(255,255,255,.06)",
                  border: "none",
                  borderRadius: 12,
                  padding: "10px 12px",
                  color: "#fff",
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
                    height: 36,
                    borderRadius: 6,
                    border: "none",
                    background: accent,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Confirmar reagenda
                </button>
                <button
                  type="button"
                  onClick={() => setResched10(false)}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 6,
                    border: "none",
                    background: "rgba(255,255,255,.10)",
                    color: "rgba(255,255,255,.70)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </BannerWrap>
      </PBlock>

      {/* 11 — Auto-rejected no-show */}
      <PBlock num={11} title="Banner: no se realizó" tag="auto_rejected_no_show">
        <BannerWrap kind={kind}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avt
              name={CREATOR_NAME}
              size={52}
              border="rgba(251,146,60,.40)"
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,.65)",
                  marginBottom: 3,
                }}
              >
                Sesión con
              </div>
              <div
                style={{
                  fontSize: 17,
                  color: "#fff",
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                }}
              >
                {CREATOR_NAME}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  marginTop: 3,
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#fb923c",
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    color: "#fb923c",
                    fontWeight: 600,
                  }}
                >
                  No se realizó
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontSize: 12,
                color: "#fb923c",
                lineHeight: 1.4,
                fontWeight: 500,
              }}
            >
              La sesión no se realizó dentro del tiempo de tolerancia. ¿Qué
              quieres hacer?
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 6,
                  border: "none",
                  background: accent,
                  color: "#fff",
                  fontSize: 13,
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
                  borderRadius: 6,
                  border: "none",
                  background: "rgba(255,255,255,.10)",
                  color: "rgba(255,255,255,.70)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Solicitar devolución
              </button>
            </div>
          </div>
        </BannerWrap>
      </PBlock>

      {/* 12 — Prep / videollamada fullscreen (comprador) */}
      <PBlock num={12} title="Sala de sesión (comprador)" tag="MeetGreetPreparationFullscreen">
        <PrepScreenMockup role="buyer" kind={kind} accent={accent} />
      </PBlock>

      {/* 13 — Portal 3-2-1 */}
      <PBlock num={13} title="Portal 3-2-1" tag="fullscreen · antes de entrar">
        <div
          style={{
            borderRadius: 12,
            background: "rgba(0,0,0,.92)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "40px 24px",
          }}
        >
          <div
            style={{
              fontSize: 120,
              fontWeight: 900,
              color: "#fff",
              letterSpacing: "-0.06em",
              lineHeight: 1,
            }}
          >
            3
          </div>
          <div
            style={{
              fontSize: 16,
              color: "rgba(255,255,255,.55)",
              fontWeight: 500,
            }}
          >
            La sesión está por comenzar
          </div>
        </div>
      </PBlock>

      {/* 14 — Videollamada en curso */}
      <PBlock num={14} title="Sesión en curso" tag="LiveKit · ambos conectados">
        <div
          style={{
            borderRadius: 12,
            background: "#000",
            overflow: "hidden",
            position: "relative",
            aspectRatio: "4/3",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#111",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Avt name={CREATOR_NAME} size={80} />
          </div>
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              width: 80,
              height: 60,
              borderRadius: 8,
              background: "#1e1e1e",
              border: "1.5px solid rgba(255,255,255,.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Avt name={BUYER_NAME} size={28} />
          </div>
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              background: "rgba(0,0,0,.6)",
              borderRadius: 6,
              padding: "3px 8px",
              fontSize: 12,
              fontWeight: 600,
              color: "#4ade80",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            24:13
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              background:
                "linear-gradient(to top, rgba(0,0,0,.85), transparent)",
              padding: "20px 16px 14px",
              display: "flex",
              justifyContent: "center",
              gap: 14,
            }}
          >
            {["🎤", "📷", "📤", "🔴"].map((icon, i) => (
              <div
                key={i}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background:
                    i === 3 ? "#dc2626" : "rgba(255,255,255,.12)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 18,
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,.10)",
                }}
              >
                {icon}
              </div>
            ))}
          </div>
        </div>
      </PBlock>

      {/* 15 — Banner grabación procesando */}
      <PBlock num={15} title="Banner: grabación procesando" tag="post-sesión">
        <div
          style={{
            width: "100%",
            position: "relative",
            borderRadius: 12,
            overflow: "hidden",
            backgroundImage: `url(${kind === "meet_greet" ? "/encuentroenvivo.webp" : "/sesionexclusiva.webp"})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: DARK_OVERLAY,
            }}
          />
          <div
            style={{
              position: "relative",
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avt name={CREATOR_NAME} size={44} border="rgba(34,197,94,.50)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,.60)",
                    marginBottom: 2,
                  }}
                >
                  Sesión con
                </div>
                <div
                  style={{
                    fontSize: 16,
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  {CREATOR_NAME}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 3,
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#4ade80",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: "#4ade80",
                      fontWeight: 600,
                    }}
                  >
                    Completada
                  </span>
                </div>
              </div>
            </div>
            <div
              style={{
                borderTop: "1px solid rgba(255,255,255,.12)",
                paddingTop: 12,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: "#fff",
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                Sesión anterior completada
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,.65)",
                  lineHeight: 1.5,
                  textAlign: "center",
                  marginBottom: 8,
                }}
              >
                Descarga tu sesión. Tienes 28 días para hacerlo.
              </div>
              <button
                type="button"
                disabled
                style={{
                  width: "100%",
                  height: 38,
                  borderRadius: 8,
                  border: "none",
                  background: "rgba(255,255,255,.08)",
                  color: "rgba(255,255,255,.35)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "not-allowed",
                  fontFamily: "inherit",
                }}
              >
                Procesando grabación…
              </button>
            </div>
          </div>
        </div>
      </PBlock>

      {/* 16 — Banner grabación lista */}
      <PBlock num={16} title="Banner: grabación lista" tag="recording ready · descarga disponible">
        <div
          style={{
            width: "100%",
            position: "relative",
            borderRadius: 12,
            overflow: "hidden",
            backgroundImage: `url(${kind === "meet_greet" ? "/encuentroenvivo.webp" : "/sesionexclusiva.webp"})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: DARK_OVERLAY,
            }}
          />
          <button
            type="button"
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              border: "none",
              background: "none",
              color: "rgba(255,255,255,.45)",
              fontSize: 16,
              cursor: "pointer",
              padding: "0 2px",
              zIndex: 2,
              fontFamily: "inherit",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
          <div
            style={{
              position: "relative",
              padding: "16px 40px 16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Avt name={CREATOR_NAME} size={44} border="rgba(34,197,94,.50)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,.60)",
                    marginBottom: 2,
                  }}
                >
                  Sesión con
                </div>
                <div
                  style={{ fontSize: 16, color: "#fff", fontWeight: 700 }}
                >
                  {CREATOR_NAME}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 3,
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#4ade80",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: "#4ade80",
                      fontWeight: 600,
                    }}
                  >
                    Completada
                  </span>
                </div>
              </div>
            </div>
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,.65)",
                lineHeight: 1.5,
                textAlign: "center",
              }}
            >
              Descarga tu sesión. Tienes 28 días para hacerlo, después ya no
              se podrá.
            </div>
            <button
              type="button"
              style={{
                width: "100%",
                height: 38,
                borderRadius: 8,
                border: "none",
                background:
                  kind === "exclusive_session"
                    ? "rgba(236,72,153,.22)"
                    : "rgba(59,130,246,.22)",
                color:
                  kind === "exclusive_session" ? "#f9a8d4" : "#93c5fd",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Descargar sesión
            </button>
          </div>
        </div>
      </PBlock>

      {/* ══════════════════ CREADOR ══════════════════ */}
      <SectionTitle label="Creador" />

      {/* 17 — Configuración del servicio */}
      <PBlock num={17} title="Configuración del servicio" tag="ProfileServicesTab">
        <ServicesConfigMockup kind={kind} accent={accent} />
      </PBlock>

      {/* 18 — Card en wallet/pendientes */}
      <PBlock num={18} title="Card en wallet · pendientes" tag="solicitud entrante">
        <PendingCardMockup kind={kind} accent={accent} />
      </PBlock>

      {/* 19 — Overlay solicitud (creador) */}
      <PBlock num={19} title="Overlay: solicitud entrante" tag="creador">
        <CreatorOverlayMockup kind={kind} accent={accent} />
      </PBlock>

      {/* 20 — Formulario de rechazo */}
      <PBlock num={20} title="Formulario de rechazo" tag="dentro del overlay">
        <RejectionFormMockup />
      </PBlock>

      {/* 21 — ScheduleDateTimeSelector */}
      <PBlock num={21} title="Selector de fecha / hora" tag="ScheduleDateTimeSelector">
        <div
          style={{
            borderRadius: 14,
            background: "#111",
            border: "1px solid rgba(255,255,255,.10)",
            padding: "16px",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,.5)",
              marginBottom: 12,
            }}
          >
            Proponer fecha y hora para la sesión
          </div>
          <DateSelectorMockup kind={kind} accent={accent} />
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
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
              Confirmar fecha
            </button>
          </div>
        </div>
      </PBlock>

      {/* 22 — Sesión agendada en pendientes */}
      <PBlock num={22} title="Sesión agendada (creador)" tag="scheduled en pendientes">
        <PendingCardMockup
          kind={kind}
          accent={accent}
          status="scheduled"
          date={DATE_LABEL}
        />
      </PBlock>

      {/* 23 — Tabla sesiones del día */}
      <PBlock num={23} title="Sesiones del día" tag="CreatorSessionCountdownBanner">
        <BannerWrap kind={kind}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#4ade80",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>
              Sesiones de hoy
            </span>
            <span
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,.45)",
                marginLeft: "auto",
              }}
            >
              2 más agendadas
            </span>
          </div>
          {[
            { name: "Ana Torres", time: "18:00", min: 30 },
            { name: "Carlos López", time: "19:30", min: 15 },
            { name: "Sofía Ramírez", time: "20:00", min: 60 },
          ].map((s) => (
            <div
              key={s.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "3px 0",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#fff",
                  minWidth: 40,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.time}
              </div>
              <Avt name={s.name} size={26} border="rgba(255,255,255,.18)" />
              <div
                style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#fff",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.name}
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#fff",
                  whiteSpace: "nowrap",
                }}
              >
                {s.min} min
              </div>
            </div>
          ))}
        </BannerWrap>
      </PBlock>

      {/* 24 — Banner creador: join activo */}
      <PBlock num={24} title="Banner creador: listo para entrar" tag="-10 min">
        <BannerWrap kind={kind}>
          <CountdownRow
            personName={BUYER_NAME}
            label="Inicia en"
            value="00:06:22"
          />
          <button
            type="button"
            style={{
              width: "100%",
              height: 40,
              borderRadius: 8,
              border: "none",
              background:
                "linear-gradient(135deg,#16a34a 0%,#22c55e 100%)",
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Prepararse
          </button>
        </BannerWrap>
      </PBlock>

      {/* 25 — Banner creador: reagendar con selector */}
      <PBlock num={25} title="Banner creador: proponer nueva fecha" tag="ScheduleDateTimeSelector · clic Reagendar">
        <BannerWrap kind={kind}>
          <CountdownRow
            personName={BUYER_NAME}
            label="Se acabó el tiempo"
            value="15:00"
            color="#fb923c"
          />
          <div
            style={{
              overflow: "hidden",
              maxHeight: resched25 ? 0 : "120px",
              opacity: resched25 ? 0 : 1,
              transition:
                "max-height .30s cubic-bezier(.16,1,.3,1),opacity .18s ease",
              pointerEvents: resched25 ? "none" : "auto",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  fontSize: 12,
                  color: "#fb923c",
                  lineHeight: 1.4,
                  fontWeight: 500,
                }}
              >
                El tiempo de tolerancia venció. Elige una opción:
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setResched25(true)}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 6,
                    border: "none",
                    background: accent,
                    color: "#fff",
                    fontSize: 13,
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
                    borderRadius: 6,
                    border: "none",
                    background: "rgba(255,255,255,.10)",
                    color: "rgba(255,255,255,.70)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Rechazar
                </button>
              </div>
            </div>
          </div>
          <div
            style={{
              overflow: "hidden",
              maxHeight: resched25 ? "360px" : 0,
              opacity: resched25 ? 1 : 0,
              transition:
                "max-height .30s cubic-bezier(.16,1,.3,1),opacity .18s ease",
              pointerEvents: resched25 ? "auto" : "none",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                paddingTop: 2,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,.60)",
                }}
              >
                Proponer nueva fecha
              </div>
              <DateSelectorMockup kind={kind} accent={accent} compact />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 6,
                    border: "none",
                    background: accent,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Confirmar fecha
                </button>
                <button
                  type="button"
                  onClick={() => setResched25(false)}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 6,
                    border: "none",
                    background: "rgba(255,255,255,.10)",
                    color: "rgba(255,255,255,.70)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </BannerWrap>
      </PBlock>

      {/* 26 — Sala de sesión (creador) */}
      <PBlock num={26} title="Sala de sesión (creador)" tag="MeetGreetPreparationFullscreen">
        <PrepScreenMockup role="creator" kind={kind} accent={accent} />
      </PBlock>

      {/* 27 — Videollamada en curso (creador) */}
      <PBlock num={27} title="Sesión en curso (creador)" tag="LiveKit">
        <div
          style={{
            borderRadius: 12,
            background: "#000",
            overflow: "hidden",
            position: "relative",
            aspectRatio: "4/3",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#111",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Avt name={BUYER_NAME} size={80} />
          </div>
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              width: 80,
              height: 60,
              borderRadius: 8,
              background: "#1e1e1e",
              border: "1.5px solid rgba(255,255,255,.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Avt name={CREATOR_NAME} size={28} />
          </div>
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              background: "rgba(0,0,0,.6)",
              borderRadius: 6,
              padding: "3px 8px",
              fontSize: 12,
              fontWeight: 600,
              color: "#4ade80",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            24:13
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              background:
                "linear-gradient(to top, rgba(0,0,0,.85), transparent)",
              padding: "20px 16px 14px",
              display: "flex",
              justifyContent: "center",
              gap: 14,
            }}
          >
            {["🎤", "📷", "📤", "🔴"].map((icon, i) => (
              <div
                key={i}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background:
                    i === 3 ? "#dc2626" : "rgba(255,255,255,.12)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 18,
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,.10)",
                }}
              >
                {icon}
              </div>
            ))}
          </div>
        </div>
      </PBlock>

      {/* 28 — Historial wallet */}
      <PBlock num={28} title="Historial — sesión completada" tag="wallet/historial">
        <div
          style={{
            borderRadius: 12,
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.08)",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avt name={BUYER_NAME} size={38} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,.45)",
                  marginBottom: 2,
                }}
              >
                {kind === "meet_greet"
                  ? "Tiempo contigo"
                  : "Sesión exclusiva"}
              </div>
              <div
                style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}
              >
                {BUYER_NAME}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#4ade80",
                }}
              >
                +$297 MXN
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,.35)",
                  marginTop: 2,
                }}
              >
                14 jul 2026
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { label: "Duración", value: `${DURATION} min` },
              { label: "Precio", value: "$350 MXN" },
              { label: "Comisión", value: "$53 MXN" },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  flex: 1,
                  borderRadius: 6,
                  background: "rgba(255,255,255,.05)",
                  padding: "7px 10px",
                  fontSize: 11,
                  color: "rgba(255,255,255,.45)",
                }}
              >
                <div
                  style={{
                    color: "rgba(255,255,255,.65)",
                    fontWeight: 600,
                    marginBottom: 2,
                  }}
                >
                  {item.label}
                </div>
                {item.value}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#4ade80",
              }}
            />
            <span
              style={{ fontSize: 11, color: "#4ade80", fontWeight: 600 }}
            >
              Completada
            </span>
            <span
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,.30)",
                marginLeft: "auto",
              }}
            >
              18:00 — 18:30
            </span>
          </div>
        </div>
      </PBlock>
    </div>
  );
}
