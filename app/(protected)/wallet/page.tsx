"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WalletIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/wallet/finanzas");
  }, [router]);

  return null;
}