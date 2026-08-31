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

/** Mínimo que exige Firebase. */
export const MIN_PASSWORD_LENGTH = 6;

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
  | { ok: false; reason: "unknown" };

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
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: "weak-password" };

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
    if (code === "auth/weak-password") return { ok: false, reason: "weak-password" };
    return { ok: false, reason: "unknown" };
  }
}
