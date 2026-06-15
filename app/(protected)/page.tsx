"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import HomePostsFeed from "./HomePostsFeed";
import HomeStoriesRow from "@/app/components/Stories/HomeStoriesRow";
import RefreshableArea from "@/components/refresh/RefreshableArea";

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
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

const pageWrap: CSSProperties = {
  padding: "0 0 calc(118px + env(safe-area-inset-bottom))",
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
    maxWidth: 720,
    marginLeft: "auto",
    marginRight: "auto",
    boxSizing: "border-box",
  };

  const refreshRef = useRef<() => Promise<void>>(async () => {});

  if (loading || !user) {
    return null;
  }

  return (
    <main style={pageWrap}>
      <div style={container}>
        <div style={feedWrap}>
          <RefreshableArea onRefresh={() => refreshRef.current()}>
            <HomeStoriesRow currentUserId={user.uid} />
            <HomePostsFeed currentUserId={user.uid} refreshRef={refreshRef} />
          </RefreshableArea>
        </div>
      </div>
    </main>
  );
}