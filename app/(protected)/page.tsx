"use client";

import type { CSSProperties } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import HomePostsFeed from "./HomePostsFeed";

export default function GroupsHome() {
  const { user, loading, startAuthTransition } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      startAuthTransition("exiting");
      router.replace("/login?next=%2F");
    }
  }, [loading, user, router, startAuthTransition]);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const pageWrap: CSSProperties = {
    padding: "12px 0 calc(118px + env(safe-area-inset-bottom))",
    background: "transparent",
    minHeight: "100vh",
    color: "#fff",
    fontFamily: fontStack,
    width: "100%",
    boxSizing: "border-box",
  };

  const container: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    margin: 0,
    padding: 0,
    boxSizing: "border-box",
  };

  const feedWrap: CSSProperties = {
    marginTop: 0,
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
  };

  if (loading || !user) {
    return null;
  }

  return (
    <main style={pageWrap}>
      <div style={container}>
        <div style={feedWrap}>
          <HomePostsFeed currentUserId={user.uid} />
        </div>
      </div>
    </main>
  );
}