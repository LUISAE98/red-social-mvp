"use client";

import OwnerSidebar from "@/app/components/OwnerSidebar";

export default function GroupsMobilePage() {
  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "16px 16px 120px",
        color: "#fff",
      }}
    >
      <h2 style={{ marginBottom: 16 }}>Mis grupos</h2>

      <OwnerSidebar />
    </div>
  );
}