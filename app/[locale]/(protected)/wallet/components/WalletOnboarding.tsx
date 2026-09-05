"use client";

/**
 * Lo que ve la wallet de un creador que TODAVÍA NO monetiza.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 Esto NO tiene contenido propio, y es a propósito.
 *
 * Antes eran siete secciones escritas aquí —reglas, comisión, transparencia,
 * garantías, las once formas de monetizar, los tipos de comunidad y el cierre—,
 * unas 2.300 líneas con sus propios textos. El problema no era el tamaño: era
 * que decían cosas distintas de las del login. Dos presentaciones del mismo
 * negocio, mantenidas por separado, y una de las dos siempre desactualizada. La
 * de aquí era la vieja.
 *
 * Ahora se reutiliza LITERALMENTE el panel de creador del login, el mismo
 * componente y no una copia. Así no puede volver a haber dos versiones: lo que
 * se cambie en la presentación de monetización se cambia una vez y sale en los
 * dos sitios.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El panel trae el reparto del dinero, la wallet de muestra, el alcance
 * internacional y las preguntas frecuentes. Los porcentajes no están escritos a
 * mano: salen del país de quien mira.
 *
 * ⚠️ Y aquí sale MEJOR que en el login. `useCreatorNetRate` deduce el país de la
 * IP cuando no hay sesión, y por eso en el login el porcentaje se presenta como
 * una estimación. Aquí siempre hay sesión, así que sale el país de verdad y el
 * número que va a ver el día del primer retiro.
 *
 * 📌 Pendiente de mudanza: al usarlo dos rutas, por la regla de ubicación de
 * componentes le toca vivir en `components/`. No se mueve en este ticket porque
 * arrastra a `LoginFaq`, `LoginWalletPhone` y `useInView` con él, y eso es un
 * cambio de otro tamaño.
 */

import LoginCreatorPanel from "@/app/[locale]/(public)/login/LoginCreatorPanel";

export default function WalletOnboarding() {
  return <LoginCreatorPanel />;
}
