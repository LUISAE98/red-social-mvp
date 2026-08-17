// Primitivos de UI de Vibra — fuente única del lenguaje visual (ver `vibra_style.md`).
// Import: `import { Button, Input, TextArea, Avatar, Modal } from "@/components/ui";`

export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export { Input } from "./Input";
export type { InputProps } from "./Input";

export { TextArea } from "./TextArea";
export type { TextAreaProps } from "./TextArea";

export { Avatar } from "./Avatar";
export type { AvatarProps } from "./Avatar";

// El modal canónico de Vibra ya existe: VibraResponsivePanel (bottom sheet en
// móvil, panel centrado en desktop). Se expone como `Modal` para descubrimiento.
export { default as Modal } from "./VibraResponsivePanel";

// Los dos huecos de carga que se repiten en todo el producto: renglones de
// avatar + texto, y cards apiladas. Nada de leyendas de "Cargando…".
export { default as ListSkeleton, CardsSkeleton } from "./ListSkeleton";
