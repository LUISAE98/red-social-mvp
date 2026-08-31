// ¿Este correo ya tiene cuenta en Vibra?
//
// Lo pregunta la pasarela de Vibra Express ANTES de cobrar. Si el correo ya
// existe, el enlace de credenciales sobre la sesión anónima falla — y fallaría
// con el pago ya hecho, dejando la compra colgada de una identidad que nadie va
// a volver a usar. Preguntarlo antes cuesta una lectura y evita ese lío.
//
// ⚠️ Va en el SERVIDOR y no en el cliente a propósito. El SDK del navegador tiene
// `fetchSignInMethodsForEmail`, pero con la protección contra enumeración de
// correos activada —que es lo que traen los proyectos nuevos— devuelve vacío
// siempre, así que diría "no existe" para todo el mundo.
//
// ⚠️ Y sí, esto es un oráculo de existencia de correos: permite comprobar si
// alguien está registrado. Se acota devolviendo SOLO un booleano —ni nombre, ni
// proveedor, ni nada más— y exigiendo un correo con forma válida. Es el precio
// de no cobrarle a alguien para después decirle que no puede continuar.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailHasAccount = onCall<{ email?: string }>(
  { region: "us-central1", cors: true },
  async (request) => {
    const email = request.data?.email?.trim().toLowerCase() ?? "";
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      throw new HttpsError("invalid-argument", "Correo no válido.");
    }

    try {
      await getAuth().getUserByEmail(email);
      return { exists: true };
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/user-not-found") return { exists: false };
      // Cualquier otro fallo no puede leerse como "no existe": eso llevaría a
      // intentar el enlace, fallar tras cobrar, y dejar la compra huérfana.
      throw new HttpsError("internal", "No se pudo comprobar el correo.");
    }
  }
);
