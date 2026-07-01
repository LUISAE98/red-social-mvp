"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

const DURATION = 1000;
const INNER_SIZE = 46;
const RING_R = 26;
const STROKE = 3;
const RING_SIZE = RING_R * 2 + STROKE * 2;
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

export default function ScrollToTopFAB() {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pressing, setPressing] = useState(false);
  const [exiting, setExiting] = useState(false);

  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitingRef = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      if (exitingRef.current) return;
      setVisible(window.scrollY > 300);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const startPress = () => {
    if (exitingRef.current) return;
    setPressing(true);
    startTimeRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - (startTimeRef.current ?? now);
      const p = Math.min(elapsed / DURATION, 1);
      setProgress(p);

      if (p < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
        setPressing(false);
        setProgress(0);
        rafRef.current = null;
        exitingRef.current = true;
        setExiting(true);
        exitTimerRef.current = setTimeout(() => {
          exitingRef.current = false;
          setExiting(false);
          setVisible(false);
        }, 380);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
  };

  const cancelPress = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPressing(false);
    setProgress(0);
  };

  if (!visible) return null;

  const dashoffset = CIRCUMFERENCE * (1 - progress);
  const cx = RING_SIZE / 2;
  const cy = RING_SIZE / 2;

  // transform is intentionally omitted here — the CSS animations own it
  // (they include translateX(-50%) in every keyframe to keep centering).
  const fabWrap: CSSProperties = {
    position: "fixed",
    bottom: "calc(54px + env(safe-area-inset-bottom))",
    left: "50%",
    zIndex: 8000,
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    cursor: "pointer",
  };

  const innerCircle: CSSProperties = {
    position: "absolute",
    width: INNER_SIZE,
    height: INNER_SIZE,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #a855ff, #7c3aed)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 18px rgba(168,85,255,0.45)",
    transform: pressing ? "scale(0.93)" : "scale(1)",
    transition: "transform 0.1s ease",
  };

  return (
    <>
      <style>{`
        .stf-fab { display: none; }
        @media (max-width: 768px) { .stf-fab { display: flex; } }

        @keyframes stfSlideIn {
          from { transform: translateX(-50%) translateY(80px); opacity: 0; }
          to   { transform: translateX(-50%) translateY(0);    opacity: 1; }
        }
        @keyframes stfPopOut {
          0%   { transform: translateX(-50%) scale(1);    opacity: 1; }
          45%  { transform: translateX(-50%) scale(1.25); opacity: 1; }
          100% { transform: translateX(-50%) scale(0);    opacity: 0; }
        }

        .stf-enter {
          animation: stfSlideIn 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
        .stf-exit {
          animation: stfPopOut 0.32s ease-in both;
        }
      `}</style>
      <div
        className={`stf-fab ${exiting ? "stf-exit" : "stf-enter"}`}
        style={fabWrap}
        onMouseDown={startPress}
        onMouseUp={cancelPress}
        onMouseLeave={cancelPress}
        onTouchStart={(e) => {
          e.preventDefault();
          startPress();
        }}
        onTouchEnd={cancelPress}
        onTouchCancel={cancelPress}
      >
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          style={{ position: "absolute", transform: "rotate(-90deg)" }}
          aria-hidden="true"
        >
          {pressing && (
            <>
              <circle
                cx={cx}
                cy={cy}
                r={RING_R}
                fill="none"
                stroke="rgba(168,85,255,0.18)"
                strokeWidth={STROKE}
              />
              <circle
                cx={cx}
                cy={cy}
                r={RING_R}
                fill="none"
                stroke="#a855ff"
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={dashoffset}
              />
            </>
          )}
        </svg>

        <div style={innerCircle}>
          <svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffffff"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </div>
      </div>
    </>
  );
}
