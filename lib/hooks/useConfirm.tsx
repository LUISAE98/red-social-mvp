"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import ConfirmPanel, { type ConfirmTone } from "@/components/ui/ConfirmPanel";

/**
 * `window.confirm`, pero con el panel de Vibra.
 *
 * El problema de sustituir el diálogo del sistema es que ese es SÍNCRONO: el
 * código se para en esa línea y sigue con la respuesta. Un panel de React no
 * puede hacer eso, así que cambiarlo obligaría a partir en dos cada manejador
 * —abrir el panel, guardar lo que iba a hacer, retomarlo al confirmar—.
 *
 * Este hook devuelve una promesa y ahorra esa cirugía: en el sitio de llamada
 * solo hay que añadir un `await` y el cambio es de una línea.
 *
 *   const { confirm, confirmPanel } = useConfirm();
 *
 *   const ok = await confirm({ title, body, confirmLabel, tone: "danger" });
 *   if (!ok) return;
 *
 * Y montar `{confirmPanel}` en el JSX, una sola vez por componente.
 */

export type ConfirmOptions = {
  /** La pregunta, corta. Va en la cabecera. */
  title: string;
  /** Qué implica decir que sí. */
  body?: string;
  /** Dato que hay que leer sí o sí: un importe, un nombre. */
  highlight?: string;
  /** Por omisión, "Confirmar". */
  confirmLabel?: string;
  /** Por omisión, "Cancelar". */
  cancelLabel?: string;
  /** `danger` para lo que destruye o no se deshace. Es lo predeterminado. */
  tone?: ConfirmTone;
  /** Subir cuando quien pregunta vive dentro de otro modal más alto. */
  zIndexBase?: number;
};

type Pendiente = {
  opciones: ConfirmOptions;
  resolver: (respuesta: boolean) => void;
};

export function useConfirm() {
  const tCommon = useTranslations("common");
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);

  /**
   * Si el componente se desmonta con una pregunta abierta, la promesa se queda
   * colgada para siempre y con ella el `await` de quien preguntó. Se resuelve
   * que no: nadie confirmó nada.
   */
  const pendienteRef = useRef<Pendiente | null>(null);

  useEffect(() => {
    pendienteRef.current = pendiente;
  }, [pendiente]);

  useEffect(
    () => () => {
      pendienteRef.current?.resolver(false);
    },
    []
  );

  const confirm = useCallback(
    (opciones: ConfirmOptions) =>
      new Promise<boolean>((resolver) => {
        setPendiente((previo) => {
          // Dos preguntas a la vez no deberían pasar, pero si pasan, la anterior
          // se cierra en falso en vez de quedarse colgada.
          previo?.resolver(false);
          return { opciones, resolver };
        });
      }),
    []
  );

  const responder = useCallback((respuesta: boolean) => {
    setPendiente((actual) => {
      actual?.resolver(respuesta);
      return null;
    });
  }, []);

  const confirmPanel = pendiente ? (
    <ConfirmPanel
      open
      onClose={() => responder(false)}
      onConfirm={() => responder(true)}
      title={pendiente.opciones.title}
      body={pendiente.opciones.body}
      highlight={pendiente.opciones.highlight}
      confirmLabel={pendiente.opciones.confirmLabel ?? tCommon("confirm")}
      cancelLabel={pendiente.opciones.cancelLabel ?? tCommon("cancel")}
      tone={pendiente.opciones.tone ?? "danger"}
      zIndexBase={pendiente.opciones.zIndexBase}
    />
  ) : null;

  return { confirm, confirmPanel };
}
