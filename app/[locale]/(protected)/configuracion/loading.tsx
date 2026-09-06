import SkeletonBlock from "@/components/ui/SkeletonBlock";

/**
 * Configuración. Un título y la columna de ajustes plegados, que es lo que hay
 * cuando la pantalla abre: siete renglones cerrados, no tarjetas altas.
 *
 * Las medidas salen de la página real: el ancho y el aire de `.cfgPage` —640 en
 * celular y sin tope en laptop— y los 40 de alto mínimo de cada renglón de
 * `OwnerSidebarSettings`. Antes esta ruta heredaba el fallback compartido y
 * dibujaba publicaciones, que no se parecen en nada a una lista de ajustes.
 */
const AJUSTES = 7;

export default function Loading() {
  return (
    <div className="cfgSkel" aria-hidden="true">
      <SkeletonBlock width={196} height={25} radius={7} />

      <div className="cfgSkelFilas">
        {Array.from({ length: AJUSTES }).map((_, i) => (
          <SkeletonBlock key={i} height={48} radius={14} />
        ))}
      </div>

      <style>{`
        .cfgSkel {
          max-width: 640px;
          margin: 0 auto;
          padding: 8px 12px 12px;
          box-sizing: border-box;
        }
        .cfgSkelFilas {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 18px;
        }
        @media (min-width: 901px) {
          .cfgSkel {
            max-width: none;
            padding-inline: 0;
          }
        }
      `}</style>
    </div>
  );
}
