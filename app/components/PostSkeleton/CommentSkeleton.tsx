"use client";

// Skeleton de carga para comentarios. Usa la MISMA base de estilo y animación
// registrada en vibra_style.md (clase `.vb-skel` + onda `vbSkelWave`), solo que
// con la forma de un comentario (avatar pequeño + líneas de nombre/texto).
// Reutilizable por el panel de comentarios (celular y laptop).

export function CommentSkeleton() {
  return (
    <div className="vb-cmt-skel">
      <style jsx>{`
        .vb-cmt-skel {
          display: flex;
          gap: 10px;
          width: 100%;
          box-sizing: border-box;
        }
        .vb-cmt-skel-col {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 7px;
          padding-top: 2px;
        }
        .vb-skel {
          background: linear-gradient(
            100deg,
            rgba(255, 255, 255, 0.05) 30%,
            rgba(255, 255, 255, 0.11) 50%,
            rgba(255, 255, 255, 0.05) 70%
          );
          background-size: 300% 100%;
          animation: vbSkelWave 1.6s ease-in-out infinite;
        }
        @keyframes vbSkelWave {
          0% {
            background-position: 180% 0;
          }
          100% {
            background-position: -80% 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .vb-skel {
            animation: none;
            background: rgba(255, 255, 255, 0.07);
          }
        }
        .vb-cmt-skel-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .vb-cmt-skel-line {
          height: 10px;
          border-radius: 6px;
        }
      `}</style>

      <div className="vb-skel vb-cmt-skel-avatar" />
      <div className="vb-cmt-skel-col">
        <div className="vb-skel vb-cmt-skel-line" style={{ width: "34%" }} />
        <div className="vb-skel vb-cmt-skel-line" style={{ width: "88%" }} />
        <div className="vb-skel vb-cmt-skel-line" style={{ width: "60%" }} />
      </div>
    </div>
  );
}

// Lista de N skeletons de comentario (para llenar mientras carga).
export function CommentSkeletonList({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <CommentSkeleton key={i} />
      ))}
    </>
  );
}

export default CommentSkeleton;
