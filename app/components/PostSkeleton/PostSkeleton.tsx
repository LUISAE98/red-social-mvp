"use client";

// Skeleton de carga para tarjetas de post. Color base igual al skeleton de
// historias del home (rgba(255,255,255,0.07)), con una onda shimmer sutil.
// Se dibuja "como si el post tuviera imagen" (bloque de media grande).
// Reutilizable por todos los feeds (home, perfil, comunidad, guardados, búsqueda).

export function PostSkeleton() {
  return (
    <div className="vb-post-skel">
      <style jsx>{`
        .vb-post-skel {
          width: 100%;
          box-sizing: border-box;
          padding: 14px 14px 16px;
          margin-bottom: 12px;
        }
        .vb-post-skel-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }
        .vb-post-skel-lines {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .vb-skel-avatar {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .vb-skel-line {
          height: 12px;
          border-radius: 6px;
        }
        .vb-skel-text {
          height: 11px;
          border-radius: 6px;
          margin-bottom: 9px;
        }
        .vb-skel-media {
          width: 100%;
          aspect-ratio: 16 / 10;
          /* Fallback si aspect-ratio no aplica (iOS viejo): alto mínimo garantizado. */
          min-height: 200px;
          border-radius: 16px;
          margin-top: 4px;
        }
      `}</style>

      <div className="vb-post-skel-head">
        <div className="vb-skel vb-skel-avatar" />
        <div className="vb-post-skel-lines">
          <div className="vb-skel vb-skel-line" style={{ width: "42%" }} />
          <div className="vb-skel vb-skel-line" style={{ width: "26%", height: 9 }} />
        </div>
      </div>

      <div className="vb-skel vb-skel-text" style={{ width: "92%" }} />
      <div className="vb-skel vb-skel-text" style={{ width: "68%" }} />

      <div className="vb-skel vb-skel-media" />
    </div>
  );
}

// Lista de N skeletons (para llenar el viewport mientras carga el feed).
export function PostSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <PostSkeleton key={i} />
      ))}
    </>
  );
}

export default PostSkeleton;
