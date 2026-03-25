"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "../../lib/firebase";
import HomePostsFeed from "./HomePostsFeed";

export default function GroupsHome() {
  const [user, setUser] = useState<User | null>(null);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const pageWrap: React.CSSProperties = {
    padding: "12px 0 calc(118px + env(safe-area-inset-bottom))",
    background: "#000",
    minHeight: "100vh",
    color: "#fff",
    fontFamily: fontStack,
    width: "100%",
    boxSizing: "border-box",
  };

  const container: React.CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    margin: 0,
    padding: 0,
    boxSizing: "border-box",
  };

  const feedWrap: React.CSSProperties = {
    marginTop: 16,
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
    });

    return () => unsub();
  }, []);

  return (
    <main style={pageWrap}>
      <div style={container}>
        <div style={feedWrap}>
          <HomePostsFeed currentUserId={user?.uid ?? null} />
        </div>
      </div>
    </main>
  );
}