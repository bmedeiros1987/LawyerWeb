"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Link2, MessageCircle, Unlink, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";

type Connection = {
  id: string;
  displayName: string | null;
  status: string;
  externalIdentity: string | null;
  connectedAt: string | null;
} | null;

type Identity = {
  status: string;
  displayName: string | null;
  verifiedAt: string | null;
} | null;

export function WhatsAppAgentSettings({
  workspaceId,
  canManage,
  connection,
  identity,
  enabled,
}: {
  workspaceId: string;
  canManage: boolean;
  connection: Connection;
  identity: Identity;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [deepLink, setDeepLink] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [copied, setCopied] = useState("");

  async function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy("configure");
    setError("");
    setWebhookUrl("");
    setVerifyToken("");
    const fd = new FormData(form);
    const response = await fetch("/api/integrations/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        accessToken: String(fd.get("accessToken") || ""),
        appSecret: String(fd.get("appSecret") || ""),
        phoneNumberId: String(fd.get("phoneNumberId") || ""),
        graphVersion: String(fd.get("graphVersion") || ""),
      }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setError(data.error ?? "Não foi possível configurar o WhatsApp.");
      return;
    }
    form.reset();
    setWebhookUrl(data.webhookUrl ?? "");
    setVerifyToken(data.verifyToken ?? "");
    router.refresh();
  }

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    const response = await fetch("/api/integrations/whatsapp", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    setBusy("");
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível desconectar o WhatsApp.");
      return;
    }
    setDeepLink("");
    setWebhookUrl("");
    setVerifyToken("");
    router.refresh();
  }

  async function pair() {
    setBusy("pair");
    setError("");
    setDeepLink("");
    const response = await fetch("/api/integrations/whatsapp/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setError(data.error ?? "Não foi possível gerar o pareamento.");
      return;
    }
    if (data.paired) {
      router.refresh();
      return;
    }
    setDeepLink(data.deepLink ?? "");
    setExpiresAt(data.expiresAt ?? "");
  }

  async function unpair() {
    setBusy("unpair");
    setError("");
    const response = await fetch("/api/integrations/whatsapp/pair", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    setBusy("");
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível remover o vínculo.");
      return;
    }
    setDeepLink("");
    router.refresh();
  }

  async function toggle(next: boolean) {
    setBusy("toggle");
    setError("");
    const response = await fetch("/api/agent/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, channel: "WHATSAPP", enabled: next, mode: "ASSIST" }),
    });
    setBusy("");
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível alterar o canal.");
      return;
    }
    router.refresh();
  }

  async function copy(value: string, key: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1400);
  }

  const connected = connection?.status === "CONNECTED";
  const pending = connection?.status === "PENDING";
  const paired = identity?.status === "VERIFIED";

  return <section className="panel whatsapp-agent-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">Canal oficial</span><h2>WhatsApp Business Cloud</h2></div>
      {connected
        ? <span className="status-pill success"><CheckCircle2 size={11}/>{connection?.displayName ?? "Conectado"}</span>
        : pending
          ? <span className="status-pill quiet">Aguardando webhook</span>
          : <span className="status-pill quiet">Não configurado</span>}
    </div>

    <div className="agent-channel-safety">
      <MessageCircle size={17}/>
      <div>
        <strong>Uso individual, com pareamento.</strong>
        <span>O agente responde somente ao WhatsApp do próprio usuário pareado. Esta integração não cria envio autônomo para clientes ou terceiros.</span>
      </div>
    </div>

    {!connected && canManage && <form className="quick-form whatsapp-cloud-form" onSubmit={configure}>
      <div className="quick-form-grid">
        <label><span>ID do número no WhatsApp</span><input name="phoneNumberId" required inputMode="numeric" autoComplete="off"/></label>
        <label><span>Versão da API Graph</span><input name="graphVersion" required placeholder="vXX.X" autoComplete="off"/></label>
      </div>
      <label><span>Token de acesso</span><input name="accessToken" type="password" required autoComplete="new-password"/></label>
      <label><span>Segredo do aplicativo</span><input name="appSecret" type="password" required autoComplete="new-password"/></label>
      <p className="form-hint">Os segredos são enviados apenas ao servidor MBLZ e armazenados criptografados. A versão da Graph API é informada pelo administrador conforme o app configurado na Meta.</p>
      <button className="form-submit" disabled={busy === "configure"}><MessageCircle size={15}/>{busy === "configure" ? "Validando…" : pending ? "Configurar novamente" : "Configurar WhatsApp Cloud"}</button>
    </form>}

    {!connected && !canManage && <div className="mini-empty">O responsável pelo workspace precisa concluir a configuração do WhatsApp Business Cloud.</div>}

    {webhookUrl && verifyToken && <div className="whatsapp-webhook-card">
      <div>
        <strong>Finalize o webhook na Meta</strong>
        <span>Cadastre a URL de retorno (callback) e o token abaixo no painel do WhatsApp Business e habilite o evento de mensagens. O token de verificação é exibido somente nesta configuração.</span>
      </div>
      <label><span>URL de retorno (callback)</span><div><code>{webhookUrl}</code><button type="button" aria-label="Copiar URL de retorno (callback)" onClick={() => copy(webhookUrl, "url")}><Copy size={13}/>{copied === "url" ? "Copiado" : "Copiar"}</button></div></label>
      <label><span>Token de verificação</span><div><code>{verifyToken}</code><button type="button" aria-label="Copiar token de verificação" onClick={() => copy(verifyToken, "token")}><Copy size={13}/>{copied === "token" ? "Copiado" : "Copiar"}</button></div></label>
    </div>}

    {connected && <div className="telegram-user-link">
      <div className="telegram-link-copy">
        <span className="agent-channel-icon"><MessageCircle size={18}/></span>
        <div>
          <strong>{paired ? "Seu WhatsApp está vinculado" : "Vincule seu WhatsApp"}</strong>
          <span>{paired ? `Conectado como ${identity?.displayName ?? "usuário WhatsApp"}.` : "O link temporário associa somente o seu número ao seu usuário MBLZ."}</span>
        </div>
      </div>

      {paired
        ? <div className="telegram-paired-actions">
            <label className="agent-switch" title="Ativar ou desativar respostas pelo WhatsApp">
              <input type="checkbox" checked={enabled} disabled={busy === "toggle"} onChange={e => toggle(e.target.checked)}/><i/>
            </label>
            <button className="ghost-button" disabled={busy === "unpair"} onClick={unpair}><Unlink size={14}/>Remover vínculo</button>
          </div>
        : <button className="new-button" disabled={busy === "pair"} onClick={pair}><Link2 size={14}/>{busy === "pair" ? "Gerando…" : "Conectar meu WhatsApp"}</button>}
    </div>}

    {deepLink && <div className="telegram-pair-card">
      <div><strong>Link de pareamento pronto</strong><span>Abra o WhatsApp e envie a mensagem já preenchida. O link expira {expiresAt ? new Date(expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "em 15 minutos"}.</span></div>
      <a className="new-button" href={deepLink} target="_blank" rel="noopener noreferrer">Abrir WhatsApp <ExternalLink size={14}/></a>
    </div>}

    {connection && canManage && <div className="telegram-admin-footer">
      <span>Canal do workspace: <strong>{connection.displayName ?? connection.externalIdentity}</strong></span>
      <button className="danger-button" disabled={busy === "disconnect"} onClick={disconnect}><Unplug size={14}/>Desconectar WhatsApp</button>
    </div>}

    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
