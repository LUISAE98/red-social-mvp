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

export const LEGAL_DOCS: Record<LegalDocId, LegalDocMeta> = {
  terms: {
    id: "terms",
    titleKey: "terms",
    docNumber: 1,
    sourceFile: "docs/legal/01-terminos-y-condiciones.md",
  },
  privacy: {
    id: "privacy",
    titleKey: "privacy",
    docNumber: 3,
    sourceFile: "docs/legal/03-aviso-privacidad-integral.md",
  },
  cookies: {
    id: "cookies",
    titleKey: "cookies",
    docNumber: 5,
    sourceFile: "docs/legal/05-politica-cookies.md",
  },
  community: {
    id: "community",
    titleKey: "community",
    docNumber: 6,
    sourceFile: "docs/legal/06-normas-comunidad.md",
  },
  refunds: {
    id: "refunds",
    titleKey: "refunds",
    docNumber: 7,
    sourceFile: "docs/legal/07-politica-reembolsos.md",
  },
  ip: {
    id: "ip",
    titleKey: "ip",
    docNumber: 12,
    sourceFile: "docs/legal/12-propiedad-intelectual-dmca.md",
  },
  age: {
    id: "age",
    titleKey: "age",
    docNumber: 13,
    sourceFile: "docs/legal/13-verificacion-edad.md",
  },
};

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
