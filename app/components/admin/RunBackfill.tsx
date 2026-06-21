"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export default function RunBackfill() {
  const [status, setStatus] = useState<string>("");
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setStatus("Ejecutando backfill...");
    try {
      const fn = httpsCallable(functions, "backfillSavedPosts");
      const result = await fn({});
      setStatus(JSON.stringify(result.data, null, 2));
    } catch (err) {
      setStatus(String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: "monospace", color: "#fff", background: "#111", borderRadius: 12 }}>
      <p style={{ marginBottom: 12, fontWeight: 600 }}>Backfill savedPosts</p>
      <button
        onClick={run}
        disabled={running}
        style={{
          padding: "8px 16px",
          background: running ? "#444" : "#a855f7",
          border: "none",
          borderRadius: 8,
          color: "#fff",
          cursor: running ? "default" : "pointer",
          fontSize: 14,
        }}
      >
        {running ? "Ejecutando..." : "Ejecutar backfill"}
      </button>
      {status && (
        <pre style={{ marginTop: 16, fontSize: 12, whiteSpace: "pre-wrap", color: "#a3e635" }}>
          {status}
        </pre>
      )}
    </div>
  );
}
