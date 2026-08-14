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

export const PASSWORD_MIN_LENGTH = 8;

/**
 * Mínimo aceptable: 8 caracteres y al menos dos clases distintas (letras,
 * números, símbolos). Dos clases en vez de exigir mayúscula + número + símbolo:
 * las reglas rígidas empujan a la gente hacia "Password1!" y no hacia una
 * contraseña buena.
 */
export function isPasswordAcceptable(password: string): boolean {
  if (typeof password !== "string") return false;
  if (password.length < PASSWORD_MIN_LENGTH) return false;

  const classes = [
    /[a-záéíóúñü]/i.test(password), // letras
    /\d/.test(password), // números
    /[^\p{L}\p{N}]/u.test(password), // símbolos y espacios
  ].filter(Boolean).length;

  return classes >= 2;
}
