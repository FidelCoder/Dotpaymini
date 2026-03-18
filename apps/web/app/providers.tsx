"use client";

import { useEffect } from "react";
import { MiniKit } from "@worldcoin/minikit-js";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    MiniKit.install();
  }, []);

  return <>{children}</>;
}
