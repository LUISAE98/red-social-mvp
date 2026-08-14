"use client";
import { useDirectionFactor } from "@/lib/i18n/useDirectionFactor";
/* eslint-disable react-hooks/refs */

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import StoryViewer, { desktopPanelSize } from "./StoryViewer";

const VIBRA_RING = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";
const LABELS: Record<StoryType, string> = { saludo: "Saludo", consejo: "Consejo" };
const FONT = 'inherit';
const NEXT_SCALE = 0.82;
const NEXT_GAP = 20;

export type CarouselGroup = {
  key: string;
  stories: StoryDoc[];
  startIndex: number;
  thumbnailUrl: string | null;
  info: { displayName: string | null; photoURL: string | null };
};

type Props = {
  groups: CarouselGroup[];
  initialGroupIndex: number;
  onClose: () => void;
  onStoryViewed: (storyId: string) => void;
};

type Phase = "idle" | "to-next" | "to-prev";

function GroupPreview({ group }: { group: CarouselGroup }) {
  const type = (group.stories[0]?.type ?? "saludo") as StoryType;
  const { photoURL, displayName } = group.info;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#111" }}>
      {group.thumbnailUrl && (
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: `url(${group.thumbnailUrl})`,
          backgroundSize: "cover", backgroundPosition: "center",
          filter: "blur(8px) brightness(0.55)", transform: "scale(1.08)",
        }} />
      )}
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <div style={{ position: "relative", width: 52, height: 52 }}>
          <div style={{ position: "absolute", inset: 5, borderRadius: "50%", overflow: "hidden" }}>
            {photoURL
              ? <Image src={photoURL} alt="" fill style={{ objectFit: "cover" }} />
              : <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.15)" }} />
            }
          </div>
          <div style={{
            position: "absolute", inset: 0, borderRadius: "50%", background: VIBRA_RING,
            WebkitMaskImage: "radial-gradient(farthest-side, transparent calc(100% - 3px), white calc(100% - 3px))",
            maskImage: "radial-gradient(farthest-side, transparent calc(100% - 3px), white calc(100% - 3px))",
          }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <span style={{ color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: FONT, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>
            {displayName ?? ""}
          </span>
          <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, fontFamily: FONT }}>
            {LABELS[type]}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function HomeStoryCarouselDesktop({
  groups: groupsProp,
  initialGroupIndex,
  onClose,
  onStoryViewed,
}: Props) {
  // Freeze groups at mount so live Firestore updates don't shift indices mid-session
  const groups = useRef(groupsProp).current;

  // +1 / -1 según el sentido de lectura. Este carrusel no tiene gesto, pero sí dos
  // capas que hay que voltear a la vez: la imagen (translateX) y su área clicable,
  // que se posiciona aparte porque un transform no mueve la caja del DOM.
  const dirX = useDirectionFactor();

  const [activeIdx, setActiveIdx] = useState(initialGroupIndex);
  const [phase, setPhase] = useState<Phase>("idle");
  const [panelSize, setPanelSize] = useState(desktopPanelSize);
  const animatingRef = useRef(false);

  useEffect(() => {
    const update = () => setPanelSize(desktopPanelSize());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const { width: PW, height: PH } = panelSize;
  const offsetX = Math.round(PW / 2 + NEXT_GAP + (PW * NEXT_SCALE) / 2);

  const advance = () => {
    if (animatingRef.current) return;
    if (activeIdx >= groups.length - 1) { onClose(); return; }
    animatingRef.current = true;
    setPhase("to-next");
    setTimeout(() => {
      setActiveIdx((i) => i + 1);
      setPhase("idle");
      animatingRef.current = false;
    }, 370);
  };

  const goBack = () => {
    if (animatingRef.current) return;
    if (activeIdx <= 0) return;
    animatingRef.current = true;
    setPhase("to-prev");
    setTimeout(() => {
      setActiveIdx((i) => i - 1);
      setPhase("idle");
      animatingRef.current = false;
    }, 370);
  };

  const prevGroup = activeIdx > 0 ? groups[activeIdx - 1] : null;
  const activeGroup = groups[activeIdx];
  const nextGroup = activeIdx < groups.length - 1 ? groups[activeIdx + 1] : null;

  if (!activeGroup) return null;

  // ── Per-slot CSS ──────────────────────────────────────────────────────────
  // transition:"none" when idle so positions snap instantly on index change (no reverse animation)
  const tr = phase !== "idle"
    ? "transform 0.37s cubic-bezier(0.4,0,0.2,1), opacity 0.37s ease"
    : "none";

  function panelStyle(slot: "left" | "active" | "right"): React.CSSProperties {
    let tx = 0, sc = 1, op = 1, zIndex = 2;

    if (slot === "left") {
      zIndex = phase === "to-prev" ? 3 : 1;
      if (phase === "idle")    { tx = -offsetX;        sc = NEXT_SCALE;       op = 0.82; }
      if (phase === "to-next") { tx = -offsetX * 1.8;  sc = NEXT_SCALE * 0.5; op = 0;    }
      if (phase === "to-prev") { tx = 0;               sc = 1;                op = 1;    }
    }
    if (slot === "active") {
      zIndex = 2;
      if (phase === "idle")    { tx = 0;        sc = 1;          op = 1;    }
      if (phase === "to-next") { tx = -offsetX; sc = NEXT_SCALE; op = 0.82; }
      if (phase === "to-prev") { tx = offsetX;  sc = NEXT_SCALE; op = 0.82; }
    }
    if (slot === "right") {
      zIndex = phase === "to-next" ? 3 : 1;
      if (phase === "idle")    { tx = offsetX;        sc = NEXT_SCALE;       op = 0.82; }
      if (phase === "to-next") { tx = 0;              sc = 1;                op = 1;    }
      if (phase === "to-prev") { tx = offsetX * 1.8;  sc = NEXT_SCALE * 0.5; op = 0;    }
    }

    return {
      position: "absolute", width: PW, height: PH,
      borderRadius: 18, overflow: "hidden",
      // El sentido lo pone --vb-dir/dirX: en RTL la vista previa "anterior" va a
      // la derecha. El área clicable de abajo se voltea con el MISMO factor, o el
      // clic se quedaría donde ya no está la imagen.
      transform: `translateX(${tx * dirX}px) scale(${sc})`,
      opacity: op, transition: tr,
      willChange: "transform, opacity", zIndex,
    };
  }

  // Hit-area: transparent clickable div positioned at the preview's VISUAL coordinates.
  // CSS transforms don't affect the DOM bounding box, so we position this independently.
  const previewHitW = Math.round(PW * NEXT_SCALE);
  const previewHitH = Math.round(PH * NEXT_SCALE);
  function hitAreaStyle(side: "left" | "right"): React.CSSProperties {
    const dx = (side === "left" ? -offsetX : offsetX) * dirX;
    const marginLeft = Math.round(dx - previewHitW / 2);
    return {
      position: "absolute",
      left: "50%", top: "50%",
      width: previewHitW, height: previewHitH,
      marginLeft, marginTop: Math.round(-previewHitH / 2),
      borderRadius: 16, cursor: "pointer", zIndex: 4,
    };
  }

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.88)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      {/* Panel container — sized to the active panel, centered by flex parent */}
      <div style={{ position: "relative", width: PW, height: PH }} onClick={(e) => e.stopPropagation()}>

        {/* Previous group — left side */}
        {prevGroup && (
          <div style={panelStyle("left")}>
            <GroupPreview group={prevGroup} />
          </div>
        )}

        {/* Active story */}
        <div style={panelStyle("active")}>
          <StoryViewer
            key={activeIdx}
            stories={activeGroup.stories}
            initialIndex={activeGroup.startIndex}
            contained
            onClose={advance}
            onPrevGroup={goBack}
            onStoryViewed={onStoryViewed}
            onCloseCarousel={onClose}
          />
        </div>

        {/* Next group — right side */}
        {nextGroup && (
          <div style={panelStyle("right")}>
            <GroupPreview group={nextGroup} />
          </div>
        )}
      </div>

      {/* Left hit area (prev group click) */}
      {prevGroup && phase === "idle" && (
        <div onClick={(e) => { e.stopPropagation(); goBack(); }} style={hitAreaStyle("left")} />
      )}

      {/* Right hit area (next group click) */}
      {nextGroup && phase === "idle" && (
        <div onClick={(e) => { e.stopPropagation(); advance(); }} style={hitAreaStyle("right")} />
      )}
    </div>,
    document.body,
  );
}
