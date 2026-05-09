"use client";

import type React from "react";
import { useAuth } from "../providers";

export default function VibraGlobalBackground() {
  const { user, loading, authTransitionMode } = useAuth();

  const isLoggedIn = Boolean(user);

  const isGlobalLoading =
    loading ||
    authTransitionMode === "entering" ||
    authTransitionMode === "exiting";

  return (
    <>
      <style jsx global>{`
        .vibraGlobalBackground {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
          background-image:
            linear-gradient(
              rgba(0, 0, 0, var(--vibra-bg-darkness)),
              rgba(0, 0, 0, var(--vibra-bg-darkness))
            ),
            url("/background-vibra.png");
          background-size: cover;
          background-position: center bottom;
          background-repeat: no-repeat;
          transform: translate3d(0, 0, 0) scaleX(1) scaleY(1);
          transform-origin: center bottom;
          animation: vibraGlobalBackgroundSoftWave 18s ease-in-out infinite;
          will-change: transform;
          transition: filter 420ms ease, opacity 420ms ease;
          filter: brightness(var(--vibra-bg-brightness))
            saturate(var(--vibra-bg-saturation));
        }

        .vibraGlobalColorFilter {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background:
            linear-gradient(
              115deg,
              transparent 0%,
              rgba(79, 70, 255, 0.08) 36%,
              rgba(168, 85, 255, 0.075) 50%,
              rgba(255, 47, 179, 0.08) 64%,
              transparent 100%
            );
          mix-blend-mode: screen;
          opacity: var(--vibra-color-filter-opacity);
          animation: vibraGlobalColorFlow 9s ease-in-out infinite;
          transition: opacity 420ms ease;
        }

        .vibraGlobalParticles {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
          opacity: var(--vibra-particles-opacity);
          filter: brightness(var(--vibra-particles-brightness));
          transition: opacity 420ms ease, filter 420ms ease;
        }

        .vibraGlobalParticleMagnet {
          position: absolute;
          width: var(--vibra-size);
          height: var(--vibra-size);
          transform: translate3d(0, 0, 0);
          transition:
            transform var(--vibra-magnet-speed)
              cubic-bezier(0.16, 1, 0.3, 1);
          transition-delay: var(--vibra-magnet-delay);
          will-change: transform;
        }

        .vibraGlobalParticles.isLoading .vibraGlobalParticleMagnet {
          transform: translate3d(
            calc(var(--vibra-center-x) + var(--vibra-layer-x)),
            calc(var(--vibra-center-y) + var(--vibra-layer-y)),
            0
          );
        }

        .vibraGlobalParticleOrbit {
          position: absolute;
          inset: 0;
          transform-origin: center;
        }

        .vibraGlobalParticles.isLoading .vibraGlobalParticleOrbit {
          animation: vibraGlobalParticleOrbit var(--vibra-orbit-speed)
            linear infinite;
          animation-delay: var(--vibra-orbit-delay);
        }

        .vibraGlobalParticle {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          animation: vibraGlobalParticleFloat 8s ease-in-out infinite;
        }

        .vibraGlobalParticle.isGlowing::before {
          content: "";
          position: absolute;
          inset: -180%;
          border-radius: inherit;
          background: inherit;
          filter: blur(5px);
          opacity: 0.28;
        }

        .vibraGlobalParticle.isGlowing::after {
          content: "";
          position: absolute;
          inset: -320%;
          border-radius: inherit;
          background: inherit;
          filter: blur(9px);
          opacity: 0.09;
        }

        @keyframes vibraGlobalBackgroundSoftWave {
          0%, 100% {
            transform: translate3d(0, 0, 0) scaleX(1) scaleY(1);
          }

          50% {
            transform: translate3d(0, 2px, 0) scaleX(1.006) scaleY(0.988);
          }
        }

        @keyframes vibraGlobalColorFlow {
          0%, 100% {
            transform: translateX(-8%);
            opacity: calc(var(--vibra-color-filter-opacity) * 0.65);
          }

          50% {
            transform: translateX(8%);
            opacity: var(--vibra-color-filter-opacity);
          }
        }

        @keyframes vibraGlobalParticleFloat {
          0%, 100% {
            transform: translate3d(0, 0, 0);
            opacity: 0.35;
          }

          50% {
            transform: translate3d(
              var(--vibra-move-x),
              var(--vibra-move-y),
              0
            );
            opacity: 1;
          }
        }

        @keyframes vibraGlobalParticleOrbit {
          0% {
            transform:
              rotate(0deg)
              translateX(var(--vibra-orbit-radius))
              rotate(0deg);
          }

          100% {
            transform:
              rotate(var(--vibra-orbit-turn))
              translateX(var(--vibra-orbit-radius))
              rotate(calc(var(--vibra-orbit-turn) * -1));
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .vibraGlobalBackground,
          .vibraGlobalColorFilter,
          .vibraGlobalParticle,
          .vibraGlobalParticles.isLoading .vibraGlobalParticleOrbit {
            animation: none;
          }

          .vibraGlobalParticleMagnet {
            transition: none;
          }
        }
      `}</style>

      <div
        className="vibraGlobalBackground"
        aria-hidden="true"
        style={
          {
"--vibra-bg-darkness": isLoggedIn ? "0.68" : "0.28",
"--vibra-bg-brightness": isLoggedIn ? "0.58" : "0.88",
"--vibra-bg-saturation": isLoggedIn ? "0.75" : "0.95",
          } as React.CSSProperties
        }
      />

      <div
        className="vibraGlobalColorFilter"
        aria-hidden="true"
        style={
          {
            "--vibra-color-filter-opacity": isLoggedIn ? "0.18" : "0.45",
          } as React.CSSProperties
        }
      />

      <div
        className={`vibraGlobalParticles ${isGlobalLoading ? "isLoading" : ""}`}
        aria-hidden="true"
        style={
          {
"--vibra-particles-opacity": isGlobalLoading
  ? "1"
  : isLoggedIn
    ? "0.42"
    : "1",
"--vibra-particles-brightness": isGlobalLoading
  ? "1"
  : isLoggedIn
    ? "0.72"
    : "1",
          } as React.CSSProperties
        }
      >
        {Array.from({ length: 86 }).map((_, index) => {
          const randomA = Math.abs(Math.sin(index * 12.9898) * 43758.5453) % 1;
          const randomB = Math.abs(Math.sin(index * 78.233) * 24634.6345) % 1;
          const randomC = Math.abs(Math.sin(index * 39.425) * 12983.445) % 1;
          const randomD = Math.abs(Math.sin(index * 91.137) * 98765.4321) % 1;
          const randomE = Math.abs(Math.sin(index * 17.731) * 34567.8912) % 1;
          const randomF = Math.abs(Math.sin(index * 64.827) * 76543.2198) % 1;

          const isLowerParticle = index < 68;

          const left = randomA * 100;
          const top = isLowerParticle ? 50 + randomB * 46 : 4 + randomB * 36;

          const color =
            left > 62
              ? "rgba(79, 70, 255, 0.9)"
              : left > 38
                ? "rgba(168, 85, 255, 0.92)"
                : "rgba(255, 47, 179, 0.95)";

          const glow =
            left > 62
              ? "rgba(79, 70, 255, 0.9)"
              : left > 38
                ? "rgba(168, 85, 255, 0.9)"
                : "rgba(255, 47, 179, 0.95)";

          const size = isLowerParticle ? 2 + randomC * 4.2 : 1.4 + randomC * 2.2;

          const moveX = (randomD - 0.5) * 32;
          const moveY = (randomE - 0.5) * 42;

          const orbitRadius = 18 + randomF * 76;
const orbitSpeed = 0.65 + randomB * 1.25;
          const orbitTurn = randomD > 0.5 ? "360deg" : "-360deg";

          return (
            <span
              key={index}
              className="vibraGlobalParticleMagnet"
              style={
                {
                  left: `${left}%`,
                  top: `${top}%`,
                  "--vibra-size": `${size}px`,
                  "--vibra-center-x": `${50 - left}vw`,
                  "--vibra-center-y": `${50 - top}vh`,
                  "--vibra-layer-x": `${(randomD - 0.5) * 92}px`,
                  "--vibra-layer-y": `${(randomE - 0.5) * 72}px`,
                 "--vibra-magnet-speed": `${180 + randomC * 160}ms`,
"--vibra-magnet-delay": `${randomF * 45}ms`,
                  "--vibra-orbit-radius": `${orbitRadius}px`,
                  "--vibra-orbit-speed": `${orbitSpeed}s`,
                  "--vibra-orbit-delay": `${randomA * -4}s`,
                  "--vibra-orbit-turn": orbitTurn,
                } as React.CSSProperties
              }
            >
              <span className="vibraGlobalParticleOrbit">
                <span
                  className={`vibraGlobalParticle ${
                    randomC > 0.93 ? "isGlowing" : ""
                  }`}
                  style={
                    {
                      width: size,
                      height: size,
                      background: color,
                      boxShadow:
                        randomC > 0.93
                          ? `0 0 ${size * 1.8}px ${glow}`
                          : `0 0 ${size * 0.8}px ${glow}`,
                      filter:
                        randomC > 0.93
                          ? `brightness(${1.12 + randomB * 0.18})`
                          : "brightness(1)",
                      animationDelay: `${randomB * 4}s`,
                      animationDuration: `${7 + randomC * 6}s`,
                      opacity:
                        randomA > 0.72
                          ? 0.82
                          : isLowerParticle
                            ? 0.38 + randomC * 0.22
                            : 0.08 + randomC * 0.12,
                      "--vibra-move-x": `${moveX}px`,
                      "--vibra-move-y": `${moveY}px`,
                    } as React.CSSProperties
                  }
                />
              </span>
            </span>
          );
        })}
      </div>
    </>
  );
}