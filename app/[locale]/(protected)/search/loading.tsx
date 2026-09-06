import ListSkeleton from "@/components/ui/ListSkeleton";
import SkeletonBlock from "@/components/ui/SkeletonBlock";

/**
 * Búsqueda. Tres piezas, en el orden en que están en la pantalla real: el subnav
 * de pestañas, el campo de consulta con su filtro al lado, y los resultados.
 *
 * Las medidas salen de la página: los 52 de alto mínimo del subnav
 * (`SearchSubnav`), el campo de `.search-query-field` con su radio 12, y el ancho
 * de `.search-content`, `min(100%, 1040px)` con 16 de aire —10 en celular—.
 * Antes esta ruta heredaba el fallback compartido y dibujaba publicaciones, que
 * es justo una de las cuatro pestañas y no la que abre por defecto.
 */
const PESTANAS = [64, 78, 86, 70];

export default function Loading() {
  return (
    <main className="searchSkel" aria-hidden="true">
      <div className="searchSkelTabs">
        {PESTANAS.map((ancho) => (
          <SkeletonBlock key={ancho} width={ancho} height={14} radius={6} />
        ))}
      </div>

      <div className="searchSkelContent">
        <div className="searchSkelQuery">
          {/* El campo se lleva el ancho sobrante en su propio envoltorio: el
              bloque trae `flex-shrink: 0` en línea y pelearse con eso desde
              fuera sale peor que darle un padre que sí crece. */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <SkeletonBlock height={38} radius={12} />
          </div>
          <SkeletonBlock width={104} height={32} radius={999} />
        </div>

        <ListSkeleton rows={7} avatarSize={44} maxWidth={1040} padding="0" />
      </div>

      <style>{`
        .searchSkel {
          width: 100%;
          display: grid;
          justify-items: center;
        }
        .searchSkelTabs {
          width: min(100%, 1040px);
          min-height: 52px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 18px;
          padding: 0 8px 10px;
          box-sizing: border-box;
        }
        .searchSkelContent {
          width: min(100%, 1040px);
          display: grid;
          gap: 8px;
          padding: 0 16px;
          box-sizing: border-box;
        }
        .searchSkelQuery {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        @media (max-width: 768px) {
          .searchSkelTabs {
            min-height: 56px;
            gap: 9px;
            padding: 0 10px 10px;
          }
          .searchSkelContent {
            padding: 0 10px;
            gap: 12px;
          }
        }
      `}</style>
    </main>
  );
}
