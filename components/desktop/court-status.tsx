"use client";
import { useEffect, useState } from "react";
import type { Source, SyncState } from "@/lib/desktop/court-sync";
import { postJson } from "./native";
import "./desktop.css";
import "./court-status.css";

type Status = { sources: Record<Source, SyncState> };
const when = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR", { timeZoneName: "short" }) : "Nunca";
export function DesktopCourtStatus({ matterId }: { matterId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const url = "/api/desktop/courts/" + encodeURIComponent(matterId);
  const load = async () => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Estado da sincronização indisponível.");
    setStatus(await response.json());
  };
  useEffect(() => { let active = true;
    fetch(url, { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Estado da sincronização indisponível.");
      const result = await response.json(); if (active) setStatus(result);
    }).catch(() => { if (active) setMessage("Estado da sincronização indisponível. Nenhum sucesso confirmado."); });
    return () => { active = false; };
  }, [url]);
  const check = async (source: Source) => {
    setBusy(true); setMessage("");
    try {
      const result = await postJson<{ skipped?: boolean }>(url, { source });
      setMessage(result.skipped ? "Este processo não é elegível para consulta externa." :
        "Consulta indisponível: integrações externas permanecem bloqueadas no desktop. Nenhuma comunicação foi consultada.");
      await load();
    } catch { setMessage("Não foi possível verificar o estado. Nenhum sucesso confirmado."); }
    finally { setBusy(false); }
  };
  return <article className="panel desktop-court-status">
    <h2>Sincronização com tribunais</h2>
    <p>Modo manual · consulta externa indisponível nesta versão. O computador desligado não monitora processos.
      DataJud e DJEN dependem da atualização e disponibilidade das fontes; não há garantia de cobertura ou tempo real.</p>
    <div className="desktop-court-sources">{(["DATAJUD", "DJEN"] as const).map(source => <section key={source}>
      <h3>CNJ / {source}</h3>
      <dl className="detail-list">
        <div><dt>Último sucesso completo</dt><dd>{status ? when(status.sources[source].lastSuccess) : "Não verificado"}</dd></div>
        <div><dt>Última tentativa local</dt><dd>{status ? when(status.sources[source].lastAttempt) : "Não verificado"}</dd></div>
        <div><dt>Estado</dt><dd>{status ? ({ never: "Nunca consultado", success: "Última consulta completa", partial: "Consulta incompleta", unavailable: "Indisponível" }[status.sources[source].status]) : "Carregando…"}</dd></div>
      </dl>
      <button className="desktop-secondary" disabled={busy || !status} onClick={() => check(source)}>Verificar disponibilidade de {source}</button>
    </section>)}</div>
    <p role="status">{message}</p>
    <p>A captura aparece na Caixa Jurídica. Um aviso interno não comprova push recebido no dispositivo.
      Push de dispositivo não foi ativado; nenhum prazo é criado automaticamente.</p>
  </article>;
}
