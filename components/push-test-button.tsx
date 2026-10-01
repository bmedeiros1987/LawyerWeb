"use client";
import { useState } from "react";
import { Send } from "lucide-react";

type Result = {
  vapidConfigured?: boolean; reason?: string | null; subscriptions?: number; accepted?: number; failed?: number; removed?: number;
  failureStatusCodes?: number[]; error?: string;
};

function describe(status: number, r: Result) {
  if (status === 401) return "Entre no MBLZ para testar.";
  if (status === 429 || r.error) return r.error ?? "Não foi possível testar agora.";
  if (r.reason === "VAPID_NOT_CONFIGURED") return "O servidor não tem as chaves VAPID configuradas: nenhum push pode ser enviado.";
  if (r.reason === "NO_SUBSCRIPTIONS") return "Nenhum aparelho está registrado para você. Toque em “Ativar push” neste aparelho e tente de novo.";
  if ((r.accepted ?? 0) > 0) return `O serviço de push aceitou o envio para ${r.accepted} aparelho(s). Confirme agora: a notificação deve aparecer em instantes. O servidor não consegue ver se ela foi exibida.`;
  if ((r.removed ?? 0) > 0) return "O registro deste aparelho expirou e foi removido. Toque em “Ativar push” novamente.";
  return `O serviço de push recusou o envio${r.failureStatusCodes?.length ? ` (código ${r.failureStatusCodes.join(", ")})` : ""}.`;
}

export function PushTestButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function test() {
    setWorking(true); setMessage(null);
    try {
      const response = await fetch("/api/push/test", { method: "POST" });
      const body = await response.json().catch(() => ({})) as Result;
      setMessage(describe(response.status, body));
    } catch {
      setMessage("Sem conexão com o servidor.");
    } finally {
      setWorking(false);
    }
  }

  return <span style={{ display: "inline-flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
    <button className="new-button" onClick={test} disabled={working}><Send size={15}/>{working ? "Enviando…" : "Testar push"}</button>
    {message ? <small role="status" style={{ maxWidth: 320 }}>{message}</small> : null}
  </span>;
}
