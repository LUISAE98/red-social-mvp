// Suelo de contraseña del registro.
//
// ⚠️ Esto NO es la política de seguridad. Cualquier validación de interfaz se
// salta llamando al SDK directamente, así que la política REAL (longitud mínima,
// complejidad, contraseñas filtradas, límites de intentos) tiene que estar
// configurada en Firebase Auth → Configuración → Política de contraseñas, que no
// vive en este repositorio.
//
// Lo que esto sí hace es poner un mínimo demostrable para quien se registra por
// la vía normal, en vez de aceptar "1234" porque se escribió dos veces igual.

// ESPEJO EXACTO de la política configurada en Firebase Auth → Configuración →
// Política de contraseñas. Si allí se cambia, hay que cambiarlo aquí: si el
// formulario acepta algo que Firebase rechaza, la persona recibe un error
// críptico DESPUÉS de rellenar todo el registro.
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 500;

/**
 * Requisitos: 10 a 500 caracteres, con mayúscula, minúscula, número y símbolo.
 */
export function isPasswordAcceptable(password: string): boolean {
  if (typeof password !== "string") return false;
  if (password.length < PASSWORD_MIN_LENGTH) return false;
  if (password.length > PASSWORD_MAX_LENGTH) return false;

  return (
    /\p{Lu}/u.test(password) && // mayúscula
    /\p{Ll}/u.test(password) && // minúscula
    /\p{N}/u.test(password) && // número
    /[^\p{L}\p{N}]/u.test(password) // símbolo
  );
}
