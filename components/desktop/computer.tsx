"use client";
import { FormEvent, useState } from "react";
import { ArchiveRestore, DatabaseBackup, FolderOpen, HardDrive, KeyRound, ShieldCheck, UsersRound } from "lucide-react";
import { pickFile, pickFolder, pickSave, postJson } from "./native";
import "./desktop.css";

type Check = { root: string; exists: boolean; total: number; found: number; missing: number; missingSamples: string[]; links: number; linkSamples: string[]; syncFolder: string | null };
type Account = { user_id: string; email: string; name: string | null; is_owner: boolean; created_at: string; locked: boolean; me: boolean };
type Props = { owner: boolean; version: string; databaseDir: string; backupsDir: string; documentsRoot: string; check: Check | null; accounts: Account[] };

function Note({ m }: { m: { text: string; tone?: "ok" | "warn" } | null }) {
  return m ? <p className={"desktop-note " + (m.tone ?? "")} role="status">{m.text}</p> : null;
}

const fmtBytes = (n: number) => n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export function DesktopComputer(p: Props) {
  const [busy, setBusy] = useState(false);
  const run = async (set: (m: { text: string; tone?: "ok" | "warn" } | null) => void, fn: () => Promise<void>) => {
    setBusy(true); set(null);
    try { await fn(); } catch (e) { set({ text: (e as Error).message, tone: "warn" }); } finally { setBusy(false); }
  };

  // relocation
  const [relMsg, setRelMsg] = useState<{ text: string; tone?: "ok" | "warn" } | null>(null);
  const [candidate, setCandidate] = useState<Check | null>(null);
  const [force, setForce] = useState(false);
  const chooseRoot = () => run(setRelMsg, async () => {
    const dir = await pickFolder("Nova localização das cópias de trabalho"); if (!dir) return;
    setForce(false); setCandidate(await postJson<Check>("/api/desktop/storage/check", { path: dir }));
  });
  const applyRoot = () => run(setRelMsg, async () => {
    const r = await postJson<Check>("/api/desktop/storage/root", { path: candidate!.root, force });
    setCandidate(null); setRelMsg({ text: `Pasta aplicada: ${r.found} de ${r.total} cópia(s) encontradas.`, tone: "ok" }); window.location.reload();
  });

  // backup
  const [includeDocs, setIncludeDocs] = useState(true);
  const [bkMsg, setBkMsg] = useState<{ text: string; tone?: "ok" | "warn" } | null>(null);
  const doBackup = () => run(setBkMsg, async () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const dest = await pickSave("Salvar backup", `lawyermind-${stamp}.lawyermind-backup`, true); if (!dest) return;
    const r = await postJson<{ path: string; bytes: number; includes_documents: boolean; documents: number; syncFolder: string | null }>("/api/desktop/backup", { dest, includeDocuments: includeDocs });
    setBkMsg({ text: `Backup verificado: ${r.path} (${fmtBytes(r.bytes)}). ${r.includes_documents ? `${r.documents} cópia(s) de trabalho incluídas.` : "Somente banco: as cópias de trabalho NÃO foram incluídas."}${r.syncFolder ? ` Salvo em pasta sincronizada ("${r.syncFolder}"): aguarde a sincronização terminar antes de usar o arquivo em outro computador.` : ""}`, tone: "ok" });
  });

  // restore
  const [rsMsg, setRsMsg] = useState<{ text: string; tone?: "ok" | "warn" } | null>(null);
  const [backup, setBackup] = useState<{ path: string; created_at: string; includes_documents: boolean; counts: Record<string, number>; documents: number } | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const chooseBackup = () => run(setRsMsg, async () => {
    setBackup(null); setTarget(null); setTyped("");
    const f = await pickFile("Escolher backup", true); if (!f) return;
    const m = await postJson<{ created_at: string; includes_documents: boolean; counts: Record<string, number>; documents: number }>("/api/desktop/backup/verify", { path: f });
    setBackup({ path: f, ...m });
  });
  const chooseTarget = () => run(setRsMsg, async () => { const d = await pickFolder("Pasta VAZIA para as cópias de trabalho restauradas"); if (d) setTarget(d); });
  const doRestore = () => run(setRsMsg, async () => {
    const r = await postJson<{ safety_backup: string; next: string }>("/api/desktop/backup/restore", { path: backup!.path, documentsTarget: backup!.includes_documents ? target : null, confirmation: "RESTAURAR" });
    setRsMsg({ text: `Restauração concluída. Backup de segurança do estado anterior: ${r.safety_backup}. Entre novamente.`, tone: "ok" });
    setTimeout(() => { window.location.href = r.next; }, 2500);
  });

  // accounts
  const [acMsg, setAcMsg] = useState<{ text: string; tone?: "ok" | "warn" } | null>(null);
  const createAccount = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = e.currentTarget; run(setAcMsg, async () => {
    await postJson("/api/desktop/accounts", Object.fromEntries(new FormData(form)));
    form.reset(); setAcMsg({ text: "Conta criada. Ela começa sem workspace e não vê os dados de outras contas.", tone: "ok" }); window.location.reload();
  }); };
  const resetPassword = (id: string) => run(setAcMsg, async () => {
    const pw = window.prompt("Nova senha para esta conta (mínimo 12 caracteres):"); if (!pw) return;
    await postJson(`/api/desktop/accounts/${id}/password`, { password: pw }); setAcMsg({ text: "Senha redefinida e sessões encerradas.", tone: "ok" });
  });
  const [pwMsg, setPwMsg] = useState<{ text: string; tone?: "ok" | "warn" } | null>(null);
  const changePassword = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = e.currentTarget; run(setPwMsg, async () => {
    await postJson("/api/desktop/auth/password", Object.fromEntries(new FormData(form)));
    window.location.href = "/login";
  }); };

  return <div className="page-stack">
    <section className="page-header"><div><span className="eyebrow">LawyerMind Desktop {p.version}</span><h1>Computador</h1><p>Onde ficam os dados, cópias de trabalho, backup e contas locais. Nada aqui usa a internet.</p></div></section>
    <div className="desktop-grid">
      <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Armazenamento</span><h2>Onde estão os dados</h2></div><HardDrive size={18}/></div>
        <dl className="detail-list">
          <div><dt>Banco PostgreSQL ativo</dt><dd className="desktop-path">{p.databaseDir}</dd></div>
          <div><dt>Cópias de trabalho</dt><dd className="desktop-path">{p.documentsRoot}</dd></div>
          <div><dt>Backups automáticos de segurança</dt><dd className="desktop-path">{p.backupsDir}</dd></div>
          {p.check && <div><dt>Cópias encontradas</dt><dd>{p.check.found} de {p.check.total}</dd></div>}
        </dl>
        <p className="desktop-note warn">O banco ativo nunca deve ficar no Google Drive, iCloud, OneDrive ou Dropbox: o aplicativo se recusa a iniciar se detectar isso. Para levar dados a outro computador, use Backup.</p>
      </article>

      {p.owner && <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Cópias de trabalho</span><h2>Relocalizar pasta</h2></div><FolderOpen size={18}/></div>
        <p>O banco guarda apenas caminhos relativos a esta pasta. Se você a moveu ou trocou de disco, aponte a nova localização: o aplicativo confere os arquivos antes de aplicar e nunca move pastas sozinho. Pastas sincronizadas são recusadas.</p>
        {p.check && p.check.missing > 0 && <p className="desktop-note warn">{p.check.missing} cópia(s) não estão na pasta atual.</p>}
        {p.check && p.check.links > 0 && <p className="desktop-note warn">{p.check.links} cópia(s) passam por link simbólico, junção ou hard link e ficam bloqueadas (ex.: {p.check.linkSamples[0]}).</p>}
        <div className="desktop-actions"><button className="desktop-secondary" onClick={chooseRoot} disabled={busy}><FolderOpen size={14}/>Escolher pasta…</button></div>
        {candidate && <div className="desktop-form">
          <span className="desktop-path">{candidate.root}</span>
          <p className={"desktop-note " + (candidate.missing ? "warn" : "ok")}>{candidate.found} de {candidate.total} cópia(s) encontradas nessa pasta.{candidate.syncFolder ? ` Pasta sincronizada ("${candidate.syncFolder}") — não permitida.` : ""}{candidate.links ? ` ${candidate.links} passam por link simbólico, junção ou hard link — não permitido.` : ""}</p>
          {candidate.missing > 0 && <label className="check-line" style={{ display: "flex", gap: 8, fontSize: 12 }}><input type="checkbox" style={{ width: "auto", height: "auto" }} checked={force} onChange={e => setForce(e.target.checked)}/>Usar mesmo assim (as ausentes ficarão indisponíveis)</label>}
          <div><button className="desktop-primary" onClick={applyRoot} disabled={busy || (candidate.missing > 0 && !force)}>Usar esta pasta</button></div>
        </div>}
        <Note m={relMsg}/>
      </article>}

      {p.owner && <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Proteção</span><h2>Backup</h2></div><DatabaseBackup size={18}/></div>
        <p>Um arquivo <b>.lawyermind-backup</b> com todos os registros deste computador (todas as contas e workspaces) lidos num instante consistente e, se marcado, as cópias de trabalho. Cada backup é relido e conferido por checksum. A pasta ativa do banco nunca é copiada.</p>
        <label className="check-line" style={{ display: "flex", gap: 8, fontSize: 12 }}><input type="checkbox" style={{ width: "auto", height: "auto" }} checked={includeDocs} onChange={e => setIncludeDocs(e.target.checked)}/>Incluir as cópias de trabalho dos documentos</label>
        <p className="desktop-note">{includeDocs ? "O backup incluirá banco + cópias de trabalho." : "O backup incluirá SOMENTE o banco; os arquivos dos documentos não entram."} Pode ser salvo numa pasta sincronizada; o arquivo não é criptografado.</p>
        <div className="desktop-actions"><button className="desktop-primary" onClick={doBackup} disabled={busy}>{busy ? "Aguarde…" : "Salvar backup…"}</button></div>
        <Note m={bkMsg}/>
      </article>}

      {p.owner && <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Proteção</span><h2>Restaurar</h2></div><ArchiveRestore size={18}/></div>
        <p>Substitui TODOS os registros deste computador pelos do backup. Antes, um backup de segurança do estado atual é salvo automaticamente. Nenhum arquivo existente é sobrescrito.</p>
        <div className="desktop-actions"><button className="desktop-secondary" onClick={chooseBackup} disabled={busy}><FolderOpen size={14}/>Escolher backup…</button></div>
        {backup && <div className="desktop-form">
          <span className="desktop-path">{backup.path}</span>
          <p className="desktop-note ok">Integridade verificada · criado em {new Date(backup.created_at).toLocaleString("pt-BR")} · {backup.counts["public.Client"] ?? 0} cliente(s), {backup.counts["public.Matter"] ?? 0} processo(s), {backup.counts["public.LegalDocument"] ?? 0} documento(s) · {backup.includes_documents ? `${backup.documents} cópia(s) incluídas` : "sem cópias de trabalho"}</p>
          {backup.includes_documents && <div className="desktop-actions"><button className="desktop-secondary" onClick={chooseTarget}><FolderOpen size={14}/>Pasta vazia para as cópias…</button>{target && <span className="desktop-path">{target}</span>}</div>}
          <label><span>Digite RESTAURAR para confirmar</span><input value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off"/></label>
          <div><button className="desktop-danger" onClick={doRestore} disabled={busy || typed !== "RESTAURAR" || (backup.includes_documents && !target)}>Restaurar</button></div>
        </div>}
        <Note m={rsMsg}/>
      </article>}

      {p.owner && <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Acesso</span><h2>Contas deste computador</h2></div><UsersRound size={18}/></div>
        <div className="desktop-rows">{p.accounts.map(a => <div key={a.user_id}><div><strong>{a.name ?? a.email}{a.is_owner ? " · proprietária" : ""}{a.me ? " (você)" : ""}</strong><small>{a.email}{a.locked ? " · bloqueada temporariamente" : ""}</small></div>{!a.is_owner && <button className="desktop-secondary" onClick={() => resetPassword(a.user_id)} disabled={busy}><KeyRound size={14}/>Redefinir senha</button>}</div>)}</div>
        <form className="desktop-form" onSubmit={createAccount}>
          <label><span>Nome</span><input name="name" required maxLength={80}/></label>
          <label><span>E-mail (login)</span><input name="email" type="email" required/></label>
          <label><span>Senha inicial (mínimo 12)</span><input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
          <div><button className="desktop-secondary" disabled={busy}>Criar conta local</button></div>
        </form>
        <Note m={acMsg}/>
      </article>}

      <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Acesso</span><h2>Minha senha</h2></div><ShieldCheck size={18}/></div>
        <form className="desktop-form" onSubmit={changePassword}>
          <label><span>Senha atual</span><input name="current" type="password" required autoComplete="current-password"/></label>
          <label><span>Nova senha</span><input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
          <label><span>Confirme</span><input name="passwordConfirmation" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
          <div><button className="desktop-secondary" disabled={busy}>Alterar senha</button></div>
        </form>
        <Note m={pwMsg}/>
      </article>
    </div>
  </div>;
}
