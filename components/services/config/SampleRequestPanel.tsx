"use client";

// El paso previo a grabar una muestra.
//
// Una muestra es un saludo o un consejo que el creador graba para enseñar cómo
// trabaja, sin que nadie se lo haya comprado. Como no hay comprador, no hay
// solicitud que leer, y el panel de grabación se quedaría sin la mitad de lo que
// enseña. Así que aquí el creador escribe esa solicitud, poniéndose en el lugar
// de quien se la pediría, y a partir de ahí graba exactamente igual que siempre.

import { useState } from "react";
import { useTranslations } from "next-intl";
import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";
import { TextArea } from "@/components/ui/TextArea";
import { Button } from "@/components/ui/Button";

export type SampleRequestDraft = { instructions: string };

export default function SampleRequestPanel({
  type,
  open,
  onCancel,
  onSubmit,
  zIndexBase,
}: {
  type: "saludo" | "consejo";
  open: boolean;
  onCancel: () => void;
  onSubmit: (draft: SampleRequestDraft) => void;
  zIndexBase?: number;
}) {
  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");

  const [instructions, setInstructions] = useState("");

  const contextLabel =
    type === "consejo" ? tServices("contextAdvice") : tServices("contextGreeting");

  const ready = instructions.trim().length > 0;

  return (
    <VibraResponsivePanel
      open={open}
      onClose={onCancel}
      title={tServices("sampleRequestTitle")}
      zIndexBase={zIndexBase}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 0 8px" }}>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.5)", fontSize: 13, lineHeight: 1.5 }}>
          {type === "consejo" ? tServices("sampleRequestHintAdvice") : tServices("sampleRequestHintGreeting")}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ color: "rgba(255,255,255,0.72)", fontSize: 13, fontWeight: 600 }}>
            {contextLabel}
          </label>
          <TextArea
            value={instructions}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInstructions(e.target.value)}
            rows={4}
            maxLength={500}
          />
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="secondary" onClick={onCancel} style={{ flex: 1, fontWeight: 600, letterSpacing: "-0.01em" }}>
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={() => onSubmit({ instructions: instructions.trim() })}
            disabled={!ready}
            // El mismo degradado que el botón de enviar del grabador: es el
            // mismo gesto, avanzar con lo que acabas de escribir.
            style={{ flex: 1, background: "linear-gradient(135deg, #ec4899, #9333ea)", color: "#fff", fontWeight: 600, letterSpacing: "-0.01em" }}
          >
            {tCommon("continue")}
          </Button>
        </div>
      </div>
    </VibraResponsivePanel>
  );
}
