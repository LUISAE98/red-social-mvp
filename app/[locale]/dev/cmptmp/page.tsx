"use client";
import SessionIntro from "@/app/[locale]/egress/session/SessionIntro";
import GreetingDownloadPreview from "../video-icons/GreetingDownloadPreview";
export default function P() {
  return (<>
    <style>{`#desktop-refresh-splash{display:none !important} body{margin:0}`}</style>
    <div style={{ background: "#000", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ color: "#0f0", fontSize: 18, padding: 4, fontFamily: "monospace" }}>1) SESSION INTRO (referencia real):</div>
      <div style={{ width: 960, height: 540, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "relative", width: 1920, height: 1080, transform: "scale(0.5)", transformOrigin: "top left" }}>
          <SessionIntro avatarUrl={null} name="Sofía Márquez" />
        </div>
      </div>
      <div style={{ color: "#ff0", fontSize: 18, padding: 4, fontFamily: "monospace" }}>2) GREETING horizontal (mío):</div>
      <div style={{ width: 960, height: 540, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "relative", width: 1920, height: 1080, transform: "scale(0.5)", transformOrigin: "top left" }}>
          <GreetingDownloadPreview orientation="horizontal" name="Sofía Márquez" serviceLabel="Saludo" holdIntro />
        </div>
      </div>
    </div>
  </>);
}
