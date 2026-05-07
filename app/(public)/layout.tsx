"use client";

import { usePathname } from "next/navigation";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <>
      <style jsx global>{`
        .publicAuthRouteTransition {
          width: 100%;
          min-height: 100dvh;
          animation: publicAuthSlideIn 240ms ease-out both;
          will-change: transform;
        }

        @keyframes publicAuthSlideIn {
          from {
            transform: translateX(22px);
          }

          to {
            transform: translateX(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .publicAuthRouteTransition {
            animation: none;
          }
        }
      `}</style>

      <div key={pathname} className="publicAuthRouteTransition">
        {children}
      </div>
    </>
  );
}