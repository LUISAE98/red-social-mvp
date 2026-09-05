"use client";

// Skeleton de fila para los resultados de búsqueda (perfiles / comunidades).
// Usa la base de vibra_style.md (.vb-skel + onda vbSkelWave). La lista se desvanece
// (fade-out) cuando `fading` es true (skeletons sobrantes que no se usaron).

export function SearchRowSkeletonList({
  count,
  fading = false,
}: {
  count: number;
  fading?: boolean;
}) {
  if (count <= 0) return null;
  return (
    <>
      <style>{`
        .vb-search-skel-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          transition: opacity 420ms ease;
        }
        @media (max-width: 640px) {
          .vb-search-skel-row { padding: 10px 12px; }
        }
        .vb-search-skel-avatar { width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0; }
        .vb-search-skel-lines { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
        .vb-search-skel-line { height: 12px; border-radius: 6px; }
      `}</style>

      {Array.from({ length: count }).map((_, i) => (
        <div
          key={`search-skel-${i}`}
          className="vb-search-skel-row"
          style={{ opacity: fading ? 0 : 1 }}
          aria-hidden="true"
        >
          <span className="vb-skel vb-search-skel-avatar" />
          <div className="vb-search-skel-lines">
            <span className="vb-skel vb-search-skel-line" style={{ width: "44%" }} />
            <span className="vb-skel vb-search-skel-line" style={{ width: "28%" }} />
          </div>
        </div>
      ))}
    </>
  );
}

export default SearchRowSkeletonList;
