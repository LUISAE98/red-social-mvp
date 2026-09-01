"use client";

// Convertir una sesión de invitado en una cuenta, sin perder lo comprado.
//
// ⚠️ La clave está en ENLAZAR, no en crear. La compra de Vibra Express se hace
// bajo el uid anónimo: si aquí se creara una cuenta nueva, nacería con OTRO uid
// y el saludo que se acaba de pagar quedaría colgado de una identidad que nadie
// va a volver a abrir. Enlazando, el uid es el mismo y la compra viaja con él.

import {
  EmailAuthProvider,
  linkWithCredential,
  sendEmailVerification,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "@/lib/firebase";
import { ensureGuestAuth } from "./ensureGuestAuth";
import { isPasswordAcceptable } from "@/lib/auth/passwordPolicy";


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
  // ⚠️ La MISMA regla que el registro normal y que la politica de Firebase, no
  // el minimo del SDK. Con el minimo, esto dejaba pasar contrasenas que el
  // servidor iba a rechazar despues, ya con la tarjeta puesta.
  //
  // Solo al CREAR. Entrar a una cuenta que ya existe no vuelve a juzgar su
  // contrasena: quien la tiene desde antes de la politica sigue pudiendo entrar.
  if (!alreadyHasAccount && !isPasswordAcceptable(password)) {
    return { ok: false, reason: "weak-password" };
  }

  try {
    if (alreadyHasAccount) {
      await signInWithEmailAndPassword(auth, clean, password);
      return { ok: true };
    }

    const user = await ensureGuestAuth();
    const credential = EmailAuthProvider.credential(clean, password);
    await linkWithCredential(user, credential);
    // La verificación se pide, pero NO se espera ni se bloquea: quien acaba de
    // pagar tiene que poder ver lo suyo ya. Verificar importa cuando vuelva.
    void sendEmailVerification(auth.currentUser ?? user).catch(() => {});
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
      return { ok: false, reason: "wrong-password" };
    }
    if (code === "auth/email-already-in-use" || code === "auth/credential-already-in-use") {
      return { ok: false, reason: "email-in-use" };
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
