"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type WalletVisibilityCache = {
  ownerId: string | null;
  hasWallet: boolean;
  loaded: boolean;
};

let walletVisibilityCache: WalletVisibilityCache = {
  ownerId: null,
  hasWallet: false,
  loaded: false,
};

async function ownerHasAnyActiveGroupServices(ownerId: string): Promise<boolean> {
  const q = query(
    collection(db, "groups"),
    where("ownerId", "==", ownerId),
    limit(20)
  );

  const snap = await getDocs(q);

  return snap.docs.some((docSnap) => {
    const data = docSnap.data() as {
      offerings?: Array<{
        enabled?: boolean;
      }> | null;
      greetingsEnabled?: boolean;
      adviceEnabled?: boolean;
      customClassEnabled?: boolean;
      digitalMeetGreetEnabled?: boolean;
      monetization?: {
        greetingsEnabled?: boolean;
        adviceEnabled?: boolean;
        customClassEnabled?: boolean;
        digitalMeetGreetEnabled?: boolean;
      } | null;
    };

    const offeringsActive =
      Array.isArray(data.offerings) &&
      data.offerings.some((item) => item?.enabled === true);

    const legacyFlagsActive =
      data.greetingsEnabled === true ||
      data.adviceEnabled === true ||
      data.customClassEnabled === true ||
      data.digitalMeetGreetEnabled === true;

    const monetizationFlagsActive =
      data.monetization?.greetingsEnabled === true ||
      data.monetization?.adviceEnabled === true ||
      data.monetization?.customClassEnabled === true ||
      data.monetization?.digitalMeetGreetEnabled === true;

    return offeringsActive || legacyFlagsActive || monetizationFlagsActive;
  });
}

async function ownerHasProfileActiveServices(ownerId: string): Promise<boolean> {
  const userSnap = await getDoc(doc(db, "users", ownerId));
  if (!userSnap.exists()) return false;

  const data = userSnap.data() as {
    offerings?: Array<{ enabled?: boolean }> | null;
    monetization?: {
      greetingsEnabled?: boolean;
      adviceEnabled?: boolean;
      customClassEnabled?: boolean;
      digitalMeetGreetEnabled?: boolean;
      donationsEnabled?: boolean;
    } | null;
  };

  const offeringsActive =
    Array.isArray(data.offerings) &&
    data.offerings.some((item) => item?.enabled === true);

  const monetizationFlagsActive =
    data.monetization?.greetingsEnabled === true ||
    data.monetization?.adviceEnabled === true ||
    data.monetization?.customClassEnabled === true ||
    data.monetization?.digitalMeetGreetEnabled === true;

  return offeringsActive || monetizationFlagsActive;
}

async function ownerHasEverHadServiceRequest(ownerId: string): Promise<boolean> {
  const requestCollections = [
    "greetingRequests",
    "meetGreetRequests",
    "exclusiveSessionRequests",
  ];

  const checks = await Promise.all(
    requestCollections.map((col) =>
      getDocs(
        query(collection(db, col), where("creatorId", "==", ownerId), limit(1))
      )
    )
  );

  return checks.some((snap) => !snap.empty);
}

export function useWalletVisibility(ownerId?: string | null) {
  const [hasWallet, setHasWallet] = useState(() => {
    if (ownerId && walletVisibilityCache.ownerId === ownerId) {
      return walletVisibilityCache.hasWallet;
    }

    return false;
  });

  const [loaded, setLoaded] = useState(() => {
    return !!ownerId && walletVisibilityCache.ownerId === ownerId
      ? walletVisibilityCache.loaded
      : false;
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!ownerId) {
        walletVisibilityCache = {
          ownerId: null,
          hasWallet: false,
          loaded: true,
        };

        if (!cancelled) {
          setHasWallet(false);
          setLoaded(true);
        }

        return;
      }

      if (
        walletVisibilityCache.ownerId === ownerId &&
        walletVisibilityCache.loaded
      ) {
        if (!cancelled) {
          setHasWallet(walletVisibilityCache.hasWallet);
          setLoaded(true);
        }

        return;
      }

      if (!cancelled) {
        setLoaded(false);
      }

      try {
        const [hasGroupServices, hasProfileServices, hasEverHadRequest] =
          await Promise.all([
            ownerHasAnyActiveGroupServices(ownerId),
            ownerHasProfileActiveServices(ownerId),
            ownerHasEverHadServiceRequest(ownerId),
          ]);

        const nextHasWallet =
          hasGroupServices || hasProfileServices || hasEverHadRequest;

        walletVisibilityCache = {
          ownerId,
          hasWallet: nextHasWallet,
          loaded: true,
        };

        if (!cancelled) {
          setHasWallet(nextHasWallet);
          setLoaded(true);
        }
      } catch {
        walletVisibilityCache = {
          ownerId,
          hasWallet: false,
          loaded: true,
        };

        if (!cancelled) {
          setHasWallet(false);
          setLoaded(true);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  return {
    hasWallet,
    loaded,
  };
}
