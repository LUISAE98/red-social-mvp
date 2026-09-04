"use client";

import { useEffect, useRef, type CSSProperties, type Touch as ReactTouch } from "react";

type Props = {
  src: string;
  alt: string;
  onClose: () => void;
  onZoomStateChange?: (isZoomed: boolean) => void;
  onPinchStateChange?: (isPinching: boolean) => void;
  swipeAxis?: "horizontal" | "vertical" | null;
  disableMinHeight?: boolean;
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

export default function PostPinchZoomImage({
  src,
  alt,
  onClose,
  onZoomStateChange,
  onPinchStateChange,
  swipeAxis = null,
  disableMinHeight = false,
}: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

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
  });

  function applyTransform(animate = false) {
    const img = imageRef.current;
    if (!img) return;

    const gesture = gestureRef.current;

    img.style.transition = animate ? "transform 160ms ease" : "none";
    img.style.transform = `translate3d(${gesture.x}px, ${gesture.y}px, 0) scale(${gesture.scale})`;
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

  useEffect(() => {
    const gesture = gestureRef.current;
    gesture.scale = 1;
    gesture.x = 0;
    gesture.y = 0;
    applyTransform(false);
    onZoomStateChange?.(false);
    onPinchStateChange?.(false);
  }, [src, onZoomStateChange, onPinchStateChange]);

  const frameStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    touchAction: "none",
    background: "#000",
  };

  const imgStyle: CSSProperties = {
    display: "block",
    width: "100%",
    height: "100%",
    minHeight: disableMinHeight ? undefined : "var(--vb-alto-pantalla)",
    objectFit: "contain",
    background: "#000",
    transform: "translate3d(0px, 0px, 0) scale(1)",
    transformOrigin: "center center",
    willChange: "transform",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
    imageRendering: "auto",
  };

  return (
    <div
      ref={frameRef}
      style={frameStyle}
      onTouchStart={(event) => {
        const gesture = gestureRef.current;

        if (event.touches.length === 1) {
          const touch = event.touches[0]!;

          gesture.startTouchX = touch.clientX;
          gesture.startTouchY = touch.clientY;
          gesture.startX = gesture.x;
          gesture.startY = gesture.y;
          gesture.isDragging = true;
          gesture.isPinching = false;
        }

        if (event.touches.length === 2) {
          event.preventDefault();
          onPinchStateChange?.(true);

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
            gesture.startScale * (distance / Math.max(gesture.startDistance, 1)),
            1,
            4
          );

          const scaleRatio = nextScale / gesture.startScale;

          const pointX = gesture.startMidX - centerX - gesture.startX;
          const pointY = gesture.startMidY - centerY - gesture.startY;

          gesture.scale = nextScale;
          onZoomStateChange?.(nextScale > 1.02);
          gesture.x =
            gesture.startX +
            (midpoint.x - gesture.startMidX) -
            pointX * (scaleRatio - 1);

          gesture.y =
            gesture.startY +
            (midpoint.y - gesture.startMidY) -
            pointY * (scaleRatio - 1);

          clampPosition();
          applyTransform(false);
          return;
        }

        if (event.touches.length === 1 && gesture.isDragging) {
          const touch = event.touches[0]!;
          const deltaX = touch.clientX - gesture.startTouchX;
          const deltaY = touch.clientY - gesture.startTouchY;

          if (gesture.scale > 1) {
            event.preventDefault();

            gesture.x = gesture.startX + deltaX;
            gesture.y = gesture.startY + deltaY;

            clampPosition();
            applyTransform(false);
            return;
          }

if (deltaY > 0 && swipeAxis !== "horizontal") {
  gesture.y = deltaY;
  applyTransform(false);
}
        }
      }}
      onTouchEnd={() => {
        const gesture = gestureRef.current;

        if (gesture.scale <= 1.02 && gesture.y > 120) {
          onClose();
          return;
        }

        if (gesture.scale <= 1.02) {
          gesture.scale = 1;
          gesture.x = 0;
          gesture.y = 0;
          onZoomStateChange?.(false);
        } else {
          onZoomStateChange?.(true);
        }

        onPinchStateChange?.(false);

        clampPosition();
        gesture.isDragging = false;
        gesture.isPinching = false;
        applyTransform(true);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imageRef} src={src} alt={alt} draggable={false} style={imgStyle} />
    </div>
  );
}