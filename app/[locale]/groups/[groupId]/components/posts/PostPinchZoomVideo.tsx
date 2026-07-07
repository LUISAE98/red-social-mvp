"use client";

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Touch as ReactTouch,
} from "react";

type Props = {
  children: ReactNode;
  resetKey: string;
  onClose?: () => void;
  onZoomStateChange?: (isZoomed: boolean) => void;
  onPinchStateChange?: (isPinching: boolean) => void;
  swipeAxis?: "horizontal" | "vertical" | null;
};

type GestureState = {
  scale: number;
  x: number;
  y: number;
  startScale: number;
  startX: number;
  startY: number;
  startTouchX: number;
  startTouchY: number;
  startDistance: number;
  startMidX: number;
  startMidY: number;
  isPinching: boolean;
  isDragging: boolean;
  lastZoomed: boolean;
  lastPinching: boolean;
};

function getDistance(a: ReactTouch, b: ReactTouch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function getMidpoint(a: ReactTouch, b: ReactTouch) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function PostPinchZoomVideo({
  children,
  resetKey,
  onZoomStateChange,
  onPinchStateChange,
}: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const gestureRef = useRef<GestureState>({
    scale: 1,
    x: 0,
    y: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    startTouchX: 0,
    startTouchY: 0,
    startDistance: 0,
    startMidX: 0,
    startMidY: 0,
    isPinching: false,
    isDragging: false,
    lastZoomed: false,
    lastPinching: false,
  });

  function setZoomedState(isZoomed: boolean) {
    const gesture = gestureRef.current;
    if (gesture.lastZoomed === isZoomed) return;

    gesture.lastZoomed = isZoomed;
    onZoomStateChange?.(isZoomed);
  }

  function setPinchingState(isPinching: boolean) {
    const gesture = gestureRef.current;
    if (gesture.lastPinching === isPinching) return;

    gesture.lastPinching = isPinching;
    onPinchStateChange?.(isPinching);
  }

  function applyTransform(animate = false) {
    const content = contentRef.current;
    if (!content) return;

    const gesture = gestureRef.current;
    content.style.transition = animate ? "transform 160ms ease" : "none";
    content.style.transform = `translate3d(${gesture.x}px, ${gesture.y}px, 0) scale(${gesture.scale})`;
  }

  function clampPosition() {
    const frame = frameRef.current;
    if (!frame) return;

    const gesture = gestureRef.current;
    const rect = frame.getBoundingClientRect();

    if (gesture.scale <= 1) {
      gesture.scale = 1;
      gesture.x = 0;
      gesture.y = 0;
      return;
    }

    const maxX = ((gesture.scale - 1) * rect.width) / 2;
    const maxY = ((gesture.scale - 1) * rect.height) / 2;

    gesture.x = clamp(gesture.x, -maxX, maxX);
    gesture.y = clamp(gesture.y, -maxY, maxY);
  }

  function resetTransform(animate = false) {
    const gesture = gestureRef.current;

    gesture.scale = 1;
    gesture.x = 0;
    gesture.y = 0;
    gesture.startScale = 1;
    gesture.startX = 0;
    gesture.startY = 0;
    gesture.startDistance = 0;
    gesture.isPinching = false;
    gesture.isDragging = false;

    setZoomedState(false);
    setPinchingState(false);
    applyTransform(animate);
  }

  useEffect(() => {
    resetTransform(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const frameStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    touchAction: "none",
    background: "#000",
  };

  const contentStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#000",
    transform: "translate3d(0px, 0px, 0) scale(1)",
    transformOrigin: "center center",
    willChange: "transform",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
  };

  return (
    <div
      ref={frameRef}
      style={frameStyle}
      onTouchStart={(event) => {
        const gesture = gestureRef.current;

        if (event.touches.length === 2) {
          event.preventDefault();

          const firstTouch = event.touches[0]!;
          const secondTouch = event.touches[1]!;
          const midpoint = getMidpoint(firstTouch, secondTouch);

          gesture.startDistance = getDistance(firstTouch, secondTouch);
          gesture.startScale = gesture.scale;
          gesture.startX = gesture.x;
          gesture.startY = gesture.y;
          gesture.startMidX = midpoint.x;
          gesture.startMidY = midpoint.y;
          gesture.isPinching = true;
          gesture.isDragging = false;

          setPinchingState(true);
          return;
        }

        if (event.touches.length === 1 && gesture.scale > 1.02) {
          const touch = event.touches[0]!;

          gesture.startTouchX = touch.clientX;
          gesture.startTouchY = touch.clientY;
          gesture.startX = gesture.x;
          gesture.startY = gesture.y;
          gesture.isDragging = true;
          gesture.isPinching = false;
        }
      }}
      onTouchMove={(event) => {
        const gesture = gestureRef.current;
        const frame = frameRef.current;
        if (!frame) return;

        if (event.touches.length === 2) {
          event.preventDefault();

          const firstTouch = event.touches[0]!;
          const secondTouch = event.touches[1]!;
          const midpoint = getMidpoint(firstTouch, secondTouch);
          const distance = getDistance(firstTouch, secondTouch);

          const rect = frame.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          const nextScale = clamp(
            gesture.startScale *
              (distance / Math.max(gesture.startDistance, 1)),
            1,
            4,
          );

          const scaleRatio = nextScale / Math.max(gesture.startScale, 1);
          const pointX = gesture.startMidX - centerX - gesture.startX;
          const pointY = gesture.startMidY - centerY - gesture.startY;

          gesture.scale = nextScale;
          gesture.x =
            gesture.startX +
            (midpoint.x - gesture.startMidX) -
            pointX * (scaleRatio - 1);
          gesture.y =
            gesture.startY +
            (midpoint.y - gesture.startMidY) -
            pointY * (scaleRatio - 1);

          clampPosition();
          setZoomedState(nextScale > 1.02);
          applyTransform(false);
          return;
        }

        if (
          event.touches.length === 1 &&
          gesture.isDragging &&
          gesture.scale > 1.02
        ) {
          event.preventDefault();

          const touch = event.touches[0]!;
          const deltaX = touch.clientX - gesture.startTouchX;
          const deltaY = touch.clientY - gesture.startTouchY;

          gesture.x = gesture.startX + deltaX;
          gesture.y = gesture.startY + deltaY;

          clampPosition();
          applyTransform(false);
        }
      }}
      onTouchEnd={() => {
        const gesture = gestureRef.current;

        if (gesture.scale <= 1.02) {
          resetTransform(true);
          return;
        }

        clampPosition();
        gesture.isDragging = false;
        gesture.isPinching = false;
        setZoomedState(true);
        setPinchingState(false);
        applyTransform(true);
      }}
      onTouchCancel={() => {
        const gesture = gestureRef.current;

        gesture.isDragging = false;
        gesture.isPinching = false;
        setPinchingState(false);

        if (gesture.scale <= 1.02) {
          resetTransform(true);
          return;
        }

        clampPosition();
        applyTransform(true);
      }}
    >
      <div ref={contentRef} style={contentStyle}>
        {children}
      </div>
    </div>
  );
}
