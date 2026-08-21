// Registro fuente-de-verdad de los documentos legales que se enlazan en la UI
// (footer del login hoy; pie del rail izquierdo `OwnerSidebar` más adelante).
//
// El índice maestro con estado, audiencia y dónde vive cada documento está en
// docs/legal/README.md. Aquí solo mapeamos el id estable de cada documento a su
// clave de i18n (legal.docs.*) y a su origen, para que cuando exista el panel
// real solo haya que apuntar `sourceFile` a su contenido renderizado.

export type LegalDocId =
  | "terms"
  | "privacy"
  | "cookies"
  | "community"
  | "refunds"
  | "ip"
  | "age";

export interface LegalDocMeta {
  id: LegalDocId;
  /** Clave i18n del título, bajo el namespace `legal.docs`. */
  titleKey: LegalDocId;
  /** Número del documento en docs/legal/README.md (índice maestro). */
  docNumber: number;
  /** Archivo fuente en docs/legal/ (para el panel real cuando exista). */
  sourceFile: string;
}

// Orden en que aparecen los enlaces en el footer del login (audiencia 🌐/❤️,
// "Completo"). Si más adelante otra superficie necesita otro subconjunto, se
// define su propio arreglo en vez de reordenar este.
export const LEGAL_FOOTER_DOCS: LegalDocId[] = [
  "terms",
  "privacy",
  "cookies",
  "community",
  "refunds",
  "ip",
  "age",
];
