// Primitivos de UI de Vibra — fuente única del lenguaje visual (ver `vibra_style.md`).
// Import: `import { Button, Input, TextArea, Avatar, Modal } from "@/components/ui";`

export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export { TextButton } from "./TextButton";
export type { TextButtonProps, TextButtonTone, TextButtonSize } from "./TextButton";

export { IconButton } from "./IconButton";
export type {
  IconButtonProps,
  IconButtonTone,
  IconButtonSize,
  IconButtonShape,
} from "./IconButton";

export { Input } from "./Input";
export type { InputProps } from "./Input";

export { TextArea } from "./TextArea";
export type { TextAreaProps } from "./TextArea";

// Contraseña con ojo para revelarla. Hereda el aspecto de quien lo usa, así que
// vale igual en el alta, en el login y en cualquier formulario con estilo propio.
export { PasswordInput } from "./PasswordInput";
export type { PasswordInputProps } from "./PasswordInput";

export { Avatar } from "./Avatar";
export type { AvatarProps } from "./Avatar";

// El modal canónico de Vibra ya existe: VibraResponsivePanel (bottom sheet en
// móvil, panel centrado en desktop). Se expone como `Modal` para descubrimiento.
export { default as Modal } from "./VibraResponsivePanel";

// Los dos huecos de carga que se repiten en todo el producto: renglones de
// avatar + texto, y cards apiladas. Nada de leyendas de "Cargando…".
export { default as ListSkeleton, CardsSkeleton } from "./ListSkeleton";
export { default as SkeletonBlock } from "./SkeletonBlock";
export { default as VibraAvatarFallback } from "./VibraAvatarFallback";

// El glifo de "abrir menú": tres rayitas. Sustituye a los tres puntos, que
// vivían en tres implementaciones distintas repartidas por el producto.
export { default as MenuLinesIcon } from "./MenuLinesIcon";
export type { MenuLinesIconProps } from "./MenuLinesIcon";

// Desenfoque progresivo para cabeceras y pies flotantes: el contenido se
// disuelve al pasar por debajo, sin el canto duro de un `backdrop-filter` suelto.
export { default as BlurFade } from "./BlurFade";
export type { BlurFadeProps } from "./BlurFade";

// Cabecera o pie flotante con el cristal detrás. Se mide sola y devuelve su alto
// para que el scroller le reserve el hueco.
export { default as GlassEdge } from "./GlassEdge";
export type { GlassEdgeProps } from "./GlassEdge";
