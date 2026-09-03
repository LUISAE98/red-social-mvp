"use client";

// Convertir una sesión de invitado en una cuenta, sin perder lo comprado.
//
// ⚠️ La clave está en ENLAZAR, no en crear. La compra de Vibra Express se hace
// bajo el uid anónimo: si aquí se creara una cuenta nueva, nacería con OTRO uid
// y el saludo que se acaba de pagar quedaría colgado de una identidad que nadie
// va a volver a abrir. Enlazando, el uid es el mismo y la compra viaja con él.

import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  sendEmailVerification,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "@/lib/firebase";
import { ensureGuestAuth } from "./ensureGuestAuth";


/**
 * ¿Este correo ya tiene cuenta?
 *
 * Se pregunta al servidor porque el SDK del navegador, con la protección contra
 * enumeración de correos activada, responde vacío siempre.
 *
 * Ante un fallo se responde `null` —no se sabe—, nunca `false`: dar por libre un
 * correo que sí existe lleva a cobrar y fallar después.
 */
export async function emailHasAccount(email: string): Promise<boolean | null> {
  try {
    const call = httpsCallable<{ email: string }, { exists: boolean }>(
      functions,
      "emailHasAccount",
    );
    const res = await call({ email: email.trim().toLowerCase() });
    return res.data.exists;
  } catch {
    return null;
  }
}

export type GuestAccountResult =
  | { ok: true }
  /** El correo ya tenía cuenta y la contraseña no cuadra. */
  | { ok: false; reason: "wrong-password" }
  /** El correo ya está en uso por otra forma de entrar (Google, por ejemplo). */
  | { ok: false; reason: "email-in-use" }
  | { ok: false; reason: "weak-password" }
  /** El correo no tiene forma de correo. */
  | { ok: false; reason: "invalid-email" }
  /** Demasiados intentos seguidos desde aquí. Firebase corta por un rato. */
  | { ok: false; reason: "too-many-requests" }
  /** No se llegó al servidor. */
  | { ok: false; reason: "network" }
  /**
   * Cualquier otra cosa. Lleva el código de Firebase encima A PROPÓSITO: sin él,
   * media docena de fallos muy distintos —el proveedor de correo apagado, la
   * sesión ya enlazada, un correo mal formado— se ven todos como el mismo
   * "Error al enviar la solicitud" y no hay por dónde empezar a mirar.
   */
  | { ok: false; reason: "unknown"; code: string };

/**
 * Deja la sesión lista para comprar, con cuenta.
 *
 * Si el correo NO existe, enlaza credenciales sobre la sesión anónima: mismo
 * uid, ahora recuperable desde cualquier aparato.
 *
 * Si el correo YA existe, se inicia sesión con él. Ahí el uid cambia, y por eso
 * esto tiene que ocurrir ANTES de crear el encargo y de cobrar — que es
 * exactamente lo que hace la pasarela.
 */
export async function attachGuestAccount(
  email: string,
  password: string,
  alreadyHasAccount: boolean,
): Promise<GuestAccountResult> {
  const clean = email.trim().toLowerCase();
  // ⚠️ AQUÍ NO se juzga la fortaleza de la contraseña, y es deliberado.
  //
  // La pantalla sí la exige antes de habilitar el botón, que es donde sirve de
  // algo. Repetir el juicio aquí cerraba una puerta que hace falta: si la
  // pregunta de "¿ya tiene cuenta?" no llegó a tiempo, esto se cree que va a
  // crear una cuenta nueva, y a alguien con una cuenta VIEJA —contraseña de
  // antes de la política— se le rechazaba su propia contraseña sin llegar
  // siquiera a intentar entrar.
  //
  // La política real vive en Firebase Auth y se aplica igual al crear; su error
  // se traduce más abajo. No hace falta adelantarse a ella para cerrar el paso.

  try {
    if (alreadyHasAccount) {
      await signInWithEmailAndPassword(auth, clean, password);
      return { ok: true };
    }

    const actual = auth.currentUser;
    // ⚠️ Ya hay una cuenta REAL abierta y se está pidiendo OTRO correo.
    //
    // Aquí no se puede enlazar: enlazar le pegaría el correo nuevo a la cuenta
    // que ya está abierta, que es exactamente lo contrario de lo que se pide.
    // Se crea la cuenta nueva y se entra con ella. No hay nada que perder por el
    // camino: al cambiar de correo, el encargo empezado se suelta y se vuelve a
    // crear bajo la identidad definitiva.
    if (actual && !actual.isAnonymous && actual.email?.toLowerCase() !== clean) {
      await createUserWithEmailAndPassword(auth, clean, password);
      void sendEmailVerification(auth.currentUser ?? actual).catch(() => {});
      return { ok: true };
    }

    const user = await ensureGuestAuth();
    const credential = EmailAuthProvider.credential(clean, password);
    await linkWithCredential(user, credential);

    // ⚠️ Y ENSEGUIDA se vuelve a entrar con esa misma credencial.
    //
    // Enlazar añade la contraseña a la cuenta, pero NO cambia cómo se abrió la
    // sesión: el token sigue diciendo `sign_in_provider: "anonymous"`. Cincuenta
    // y una reglas de Firestore exigen una sesión que no sea anónima —con razón,
    // es lo que impide que un anónimo reserve nombres de usuario a montones—, y
    // todas seguían viendo un invitado. Terminar el perfil moría con «missing or
    // insufficient permissions».
    //
    // Entrar de nuevo emite un token que dice `password`. Es la MISMA cuenta y
    // el MISMO uid —ese correo ya le pertenece—, así que la compra recién hecha
    // no se mueve de sitio. De paso dispara el aviso de cambio de sesión que el
    // enlace no dispara, así que la app deja de creer que sigue habiendo un
    // invitado durante el resto de la visita.
    try {
      await signInWithEmailAndPassword(auth, clean, password);
    } catch (err) {
      // La cuenta quedó creada igual; solo el token se quedó viejo. No se corta
      // la compra por esto, pero se dice, porque explica cualquier permiso
      // denegado que venga después.
      console.error("[guestAccount] la cuenta se creó pero no se pudo refrescar la sesión:", err);
    }
    // La verificación se pide, pero NO se espera ni se bloquea: quien acaba de
    // pagar tiene que poder ver lo suyo ya. Verificar importa cuando vuelva.
    void sendEmailVerification(auth.currentUser ?? user).catch(() => {});
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
      return { ok: false, reason: "wrong-password" };
    }
    // Ese correo ya era de alguien. En vez de rendirse, se ENTRA con él.
    //
    // ⚠️ Sin esto había un callejón sin salida, y no hacía falta mala suerte
    // para caer en él. La pregunta de "¿este correo ya tiene cuenta?" se lanza
    // al salir del campo; si alguien escribe su correo y pulsa pagar sin
    // esperar, la respuesta aún no ha llegado y aquí se intenta CREAR una cuenta
    // que ya existe. El aviso decía "escribe tu contraseña para continuar" —y ya
    // estaba escrita—, así que reintentar daba exactamente el mismo error para
    // siempre.
    //
    // Ahora esa pregunta es una comodidad para la pantalla, no un requisito
    // para cobrar. Si la contraseña es la suya, entra; si no, se le dice.
    if (code === "auth/email-already-in-use" || code === "auth/credential-already-in-use") {
      try {
        await signInWithEmailAndPassword(auth, clean, password);
        return { ok: true };
      } catch (err2) {
        const code2 = (err2 as { code?: string })?.code ?? "";
        if (code2 === "auth/wrong-password" || code2 === "auth/invalid-credential") {
          return { ok: false, reason: "wrong-password" };
        }
        if (code2 === "auth/too-many-requests") return { ok: false, reason: "too-many-requests" };
        if (code2 === "auth/network-request-failed") return { ok: false, reason: "network" };
        console.error("[guestAccount] el correo ya existía y tampoco se pudo entrar:", code2, err2);
        return { ok: false, reason: "email-in-use" };
      }
    }
    // El segundo es el que devuelve Firebase cuando el proyecto tiene una
    // politica de contrasenas configurada. Sin contemplarlo llegaba tal cual a
    // la pantalla, en ingles y entre corchetes, sin decir que arreglar.
    if (code === "auth/weak-password" || code === "auth/password-does-not-meet-requirements") {
      return { ok: false, reason: "weak-password" };
    }
    if (code === "auth/invalid-email") return { ok: false, reason: "invalid-email" };
    // Probar el flujo varias veces seguidas es suficiente para llegar aquí, y
    // sin nombrarlo se lee como que el registro está roto cuando solo hay que
    // esperar.
    if (code === "auth/too-many-requests") return { ok: false, reason: "too-many-requests" };
    if (code === "auth/network-request-failed") return { ok: false, reason: "network" };
    // Esta sesión YA quedó enlazada a un correo en un intento anterior.
    //
    // Si es el MISMO correo, no hay nada que arreglar: la identidad ya está
    // resuelta y cortar aquí dejaría sin comprar a quien solo pulsó dos veces.
    // Si es OTRO, sí importa: seguir adelante colgaría la compra de una cuenta
    // que no es la que la persona acaba de escribir.
    if (code === "auth/provider-already-linked") {
      if (auth.currentUser?.email?.toLowerCase() === clean) return { ok: true };
      return { ok: false, reason: "email-in-use" };
    }
    console.error("[guestAccount] el alta falló:", code || err, err);
    return { ok: false, reason: "unknown", code: code || String(err) };
  }
}
