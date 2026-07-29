import type { CSSProperties } from "react";

// Base compartida — todos los botones heredan esto
const BASE: CSSProperties = {
  border: "none",
  borderRadius: 10,
  fontWeight: 600,
  fontSize: 14,
  letterSpacing: "-0.01em",
  color: "#fff",
  cursor: "pointer",
  transition: "opacity 150ms ease, transform 80ms ease",
  WebkitTapHighlightColor: "transparent",
  outline: "none",
};

// PRIMARY — Seguir, Solicitar servicio, Crear comunidad, Unirse
export const btnPrimary: CSSProperties = {
  ...BASE,
  background: "linear-gradient(135deg, #f472b6, #a855f7)",
};

// AUTH — Login, Registro, Completar perfil, Reset password
export const btnAuth: CSSProperties = {
  ...BASE,
  background:
    "linear-gradient(100deg, #ff2fb3 0%, #a855f7 35%, #4f46ff 70%, #ff2fb3 100%)",
};

// BLUE — Donar/Apoyar, Contexto en historias
export const btnBlue: CSSProperties = {
  ...BASE,
  background: "#3b82f6",
};

// PURPLE — Super comentario live, acciones moradas sólidas
export const btnPurple: CSSProperties = {
  ...BASE,
  background: "#a855f7",
};

// CANCEL — "Cancelar", "Volver", "No, gracias"
export const btnCancel: CSSProperties = {
  ...BASE,
  background: "rgba(239, 68, 68, 0.10)",
};

// DESTRUCTIVE — Bloquear, Eliminar, Banear, Abandonar
export const btnDestructive: CSSProperties = {
  ...BASE,
  background: "rgba(239, 68, 68, 0.22)",
};

// LOGOUT — Cerrar sesión
export const btnLogout: CSSProperties = {
  ...BASE,
  background: "rgba(90, 41, 174, 0.4)",
};
