"use client";

// Muestras de saludos y consejos.
//
// Un creador que todavía no ha vendido nada tiene el escaparate vacío, y un
// escaparate vacío no vende. Con esto puede grabar un ejemplo, inventándose la
// solicitud como si fuera quien se la pide.
//
// No es un encargo: no hay comprador, no hay cobro y no entra en el ledger. Por
// eso vive en su propia colección y en su propia función, en vez de colarse por
// el circuito de `greetingRequests`, donde el webhook de Mux dispara la captura
// del pago al ver que un video quedó listo.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type GreetingSampleType = "saludo" | "consejo";
export type GreetingSampleSource = "profile" | "group";

export async function createGreetingSampleUpload(input: {
  type: GreetingSampleType;
  source: GreetingSampleSource;
  /** Obligatorio cuando la muestra es de una comunidad. */
  groupId?: string;
  /** Para quién va dirigida, en el ejemplo inventado. */
  toName?: string;
  /** El contexto que se leerá en pantalla al grabar. */
  context?: string;
}): Promise<{ sampleId: string; uploadId: string; uploadUrl: string }> {
  const call = httpsCallable<
    typeof input,
    { sampleId: string; uploadId: string; uploadUrl: string }
  >(functions, "createGreetingSampleUpload");

  const res = await call(input);
  return res.data;
}

export async function updateGreetingSampleContext(input: {
  sampleId: string;
  context: string;
}): Promise<void> {
  const call = httpsCallable<typeof input, void>(
    functions,
    "updateGreetingSampleContext"
  );
  await call(input);
}

export async function deleteGreetingSample(input: {
  sampleId: string;
}): Promise<void> {
  const call = httpsCallable<typeof input, void>(
    functions,
    "deleteGreetingSample"
  );
  await call(input);
}
