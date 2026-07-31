"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

const DURATION = 500;
const INNER_SIZE = 46;
const RING_R = 26;
const STROKE = 3;
const RING_SIZE = RING_R * 2 + STROKE * 2;
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

type ExitAnim = "pop" | "slide" | null;

export default function ScrollToTopFAB() {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pressing, setPressing] = useState(false);
  const [exitAnim, setExitAnim] = useState<ExitAnim>(null);

  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitingRef = useRef(false);
  const wasAboveThreshold = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      if (exitingRef.current) return;
      const aboveThreshold = window.scrollY > 300;

      if (aboveThreshold && !wasAboveThreshold.current) {
        wasAboveThreshold.current = true;
        setVisible(true);
      } else if (!aboveThreshold && wasAboveThreshold.current) {
        wasAboveThreshold.current = false;
        exitingRef.current = true;
        setExitAnim("slide");
        exitTimerRef.current = setTimeout(() => {
          exitingRef.current = false;
          setExitAnim(null);
          setVisible(false);
        }, 360);
      }
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
        wasAboveThreshold.current = false;
        setExitAnim("pop");
        exitTimerRef.current = setTimeout(() => {
          exitingRef.current = false;
          setExitAnim(null);
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

  const fabWrap: CSSProperties = {
    position: "fixed",
    bottom: "calc(54px + var(--vb-safe-bottom, 0px))",
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
    background: "linear-gradient(135deg, #a855f7, #7c3aed)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transform: pressing ? "scale(0.93)" : "scale(1)",
    transition: "transform 0.1s ease",
  };

  const animClass =
    exitAnim === "pop"
      ? "stf-exit-pop"
      : exitAnim === "slide"
        ? "stf-exit-slide"
        : "stf-enter";

  return (
    <>
      <style>{`
        .stf-fab { display: none; }
        @media (max-width: 768px) { .stf-fab { display: flex; } }

        @keyframes stfSlideIn {
          from { transform: translateX(-50%) translateY(80px); opacity: 0; }
          to   { transform: translateX(-50%) translateY(0);    opacity: 1; }
        }
        @keyframes stfSlideOut {
          from { transform: translateX(-50%) translateY(0);    opacity: 1; }
          to   { transform: translateX(-50%) translateY(80px); opacity: 0; }
        }
        @keyframes stfPopOut {
          0%   { transform: translateX(-50%) scale(1);    opacity: 1; }
          45%  { transform: translateX(-50%) scale(1.25); opacity: 1; }
          100% { transform: translateX(-50%) scale(0);    opacity: 0; }
        }

        .stf-enter     { animation: stfSlideIn  0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        .stf-exit-slide { animation: stfSlideOut 0.32s ease-in both; }
        .stf-exit-pop   { animation: stfPopOut   0.32s ease-in both; }
      `}</style>
      <div
        className={`stf-fab ${animClass}`}
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
                stroke="#a855f7"
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
