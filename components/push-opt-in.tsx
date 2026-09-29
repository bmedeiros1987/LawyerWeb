"use client";
import { useState } from "react";
import { BellRing } from "lucide-react";

function decodeKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushOptIn() {
  const [status, setStatus] = useState<"idle"|"working"|"on"|"blocked"|"error">("idle");

  async function enable() {
    setStatus("working");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Push not supported");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus("blocked"); return; }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("VAPID key is not configured");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(publicKey),
      });
      const json = subscription.toJSON();
      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint, keys: json.keys }),
      });
      if (!response.ok) throw new Error("Could not save subscription");
      setStatus("on");
    } catch {
      setStatus("error");
    }
  }

  const label = status === "working" ? "Ativando…" : status === "on" ? "Push ativo" : status === "blocked" ? "Permissão bloqueada" : status === "error" ? "Tentar novamente" : "Ativar push";
  return <button className={status === "on" ? "status-pill success" : "new-button"} onClick={enable} disabled={status === "working" || status === "on"}><BellRing size={15}/>{label}</button>;
}
