"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { REVIEW_PATH, drainPendingOpens, listenForOpens } from "./open-client";

/** Mounted in the signed-in desktop layout: when the OS hands LawyerMind a file, take the user to the review screen. */
export function DesktopOpenWatcher() {
  const router = useRouter(), pathname = usePathname();
  useEffect(() => {
    let alive = true;
    const check = async () => { const list = await drainPendingOpens(); if (alive && list.length && pathname !== REVIEW_PATH) router.push(REVIEW_PATH); };
    void check();
    const off = listenForOpens(() => void check());
    return () => { alive = false; off(); };
  }, [pathname, router]);
  return null;
}
