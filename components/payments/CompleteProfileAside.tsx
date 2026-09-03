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

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { onIdTokenChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useProfileOnboarding } from "@/lib/profile/useProfileOnboarding";
import CompleteProfilePanel from "@/components/profile/CompleteProfilePanel";

export default function CompleteProfileAside({ stacked = false }: { stacked?: boolean }) {
  const t = useTranslations("completeProfile");
  const tLater = useTranslations("notifPrompt");
  const tCommon = useTranslations("common");
  // ⚠️ La sesión se lee de Firebase DIRECTAMENTE, no del contexto de la app.
  //
  // Por dos razones, y las dos importan justo aquí. La primera es de diseño: el
  // contexto trata a los invitados como si no hubiera nadie —es lo correcto para
  // la interfaz, un anónimo no debe ver la app en modo sesión iniciada—, pero
  // este panel necesita a la persona de verdad.
  //
  // La segunda es un fallo medido: en Vibra Express la cuenta nace ENLAZANDO
  // credenciales sobre la sesión anónima, y eso conserva el mismo uid. Como
  // nadie entra ni sale, `onAuthStateChanged` NO se dispara y el contexto sigue
  // creyendo que es un invitado hasta la siguiente recarga. Por eso este panel
  // no salía nunca: preguntaba al contexto y el contexto decía que no había
  // nadie. `onIdTokenChanged` sí se entera, porque enlazar renueva el token.
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  useEffect(() => onIdTokenChanged(auth, setUser), []);

  const { ready, hasProfile, submit, panel } = useProfileOnboarding(user);
  const [saltado, setSaltado] = useState(false);
  const [hecho, setHecho] = useState(false);

  // Quien YA tiene perfil no ve nada: no hay nada que completar. Y mientras no
  // se sabe tampoco, para no asomar un formulario que va a desaparecer solo.
  //
  // Un anónimo tampoco: sin correo ni contraseña no hay cuenta que completar, y
  // eso solo pasa en los servicios que se cobran sin alta.
  if (!user || user.isAnonymous || !ready || hasProfile || saltado) return null;

  const marco: React.CSSProperties = {
    // Blanco, como el resto de la pasarela. El formulario es el mismo de
    // siempre; lo que cambia son sus colores, y eso lo resuelve él con `tone`
    // en vez de obligarnos a copiarlo.
    background: "#fff",
    // Aire de sobra. Apretado se leía como un formulario metido con calzador, y
    // este es el momento en que se le pide algo a alguien que acaba de pagar.
    padding: stacked ? "22px 22px 28px" : "30px 34px 32px",
    ...(stacked
      ? { borderTop: "1px solid #eaecef" }
      : {
          // Ancho de verdad: los campos de nombre y apellido van en dos
          // columnas y en 330 px salían estrangulados.
          width: 460,
          flexShrink: 0,
          borderInlineStart: "1px solid #eaecef",
        }),
  };

  if (hecho) {
    return (
      <div style={{ ...marco, display: "grid", placeItems: "center", minHeight: stacked ? 0 : 200 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#2b2f38" }}>{tCommon("done")}</span>
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
        // Sobre blanco. Cambia SOLO los colores; los campos, los textos y el
        // orden siguen siendo los mismos que en el alta.
        tone="light"
      />
    </div>
  );
}
