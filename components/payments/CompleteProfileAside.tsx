"use client";

// Completar el perfil, dentro de la pantalla de compra hecha.
//
// Es la PRIMERA de las dos oportunidades que tiene quien compró por Vibra
// Express. Aquí no se obliga a nada: se pide justo cuando esa persona acaba de
// pagar y está contenta, y si la salta se le vuelve a ofrecer más adelante.
//
// El momento no es casual. El perfil le sirve al CREADOR, y le sirve ANTES de
// grabar —cuando decide si acepta el encargo—, así que pedirlo al entregar el
// video llegaría tarde para quien lo necesitaba. Y este es el único momento que
// existe hoy, sin depender de la entrega por correo.
//
// ⚠️ Reutiliza el formulario de siempre, no una copia. Mismos campos, mismos
// marcadores y mismos textos que «Completa tu perfil» y que el alta de Google,
// porque son literalmente el mismo componente y el mismo hook. Cambiar un texto
// allí lo cambia aquí.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import { useProfileOnboarding } from "@/lib/profile/useProfileOnboarding";
import CompleteProfilePanel from "@/components/profile/CompleteProfilePanel";

export default function CompleteProfileAside({ stacked = false }: { stacked?: boolean }) {
  const t = useTranslations("completeProfile");
  const tLater = useTranslations("notifPrompt");
  const tCommon = useTranslations("common");
  const { user } = useAuth();
  const { ready, hasProfile, submit, panel } = useProfileOnboarding(user ?? null);
  const [saltado, setSaltado] = useState(false);
  const [hecho, setHecho] = useState(false);

  // Quien YA tiene perfil no ve nada: no hay nada que completar. Y mientras no
  // se sabe tampoco, para no asomar un formulario que va a desaparecer solo.
  if (!user || !ready || hasProfile || saltado) return null;

  const marco: React.CSSProperties = {
    // Fondo oscuro: el formulario es el de siempre, y el de siempre está hecho
    // para fondo oscuro (campos translúcidos, texto claro). Cambiarle los
    // colores aquí lo convertiría en una copia, que es justo lo que no se hace.
    background: "linear-gradient(180deg, #16161c, #0e0e12)",
    color: "#fff",
    padding: stacked ? "20px 18px 26px" : "24px 22px 26px",
    // En escritorio es la columna de la derecha, con su propio desplazamiento si
    // el formulario no cabe. En celular va debajo, dentro del de la hoja.
    ...(stacked
      ? { borderTop: "1px solid rgba(255,255,255,0.10)" }
      : {
          width: 330,
          flexShrink: 0,
          borderInlineStart: "1px solid rgba(255,255,255,0.10)",
          overflowY: "auto" as const,
        }),
  };

  if (hecho) {
    return (
      <div style={{ ...marco, display: "grid", placeItems: "center", minHeight: stacked ? 0 : 200 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.86)" }}>
          {tCommon("done")}
        </span>
      </div>
    );
  }

  return (
    <div style={marco}>
      <CompleteProfilePanel
        {...panel}
        onSubmit={(e) => {
          void submit(e, () => setHecho(true));
        }}
        // No es un «cancelar»: no se cancela nada, se deja para luego. Habrá una
        // segunda oportunidad, así que el botón lo dice con esas palabras.
        onCancel={() => setSaltado(true)}
        cancelLabel={tLater("later")}
        title={t("title")}
        // La bajada de siempre dice «para terminar de crear tu cuenta», y aquí
        // la cuenta ya está creada: se pagó con ella hace un segundo.
        subtitle=""
      />
    </div>
  );
}
