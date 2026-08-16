import BotonesCatalogo from "./components/BotonesCatalogo";

/**
 * Catálogo vivo de botones de la plataforma.
 *
 * Hermano de `/estilos-avisos`, y con el mismo propósito: un documento describe
 * cómo DEBERÍA verse un botón, pero con 818 botones escritos a mano lo que hace
 * falta es verlos JUNTOS. Puestos uno al lado del otro, las incoherencias —nueve
 * radios distintos entre 8 y 16, seis grises que no se distinguen— saltan en
 * segundos; leyendo archivos sueltos no aparecen nunca.
 *
 * Sirve para decidir qué familias sobreviven cuando se cierre la escala.
 */
export default function EstilosBotonesPage() {
  return <BotonesCatalogo />;
}
