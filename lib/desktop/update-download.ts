// Downloads an update package into a staging folder and verifies SHA-256 and the minisign signature.
// It never installs, executes or opens the file, and never touches user documents or the database.
import fs from "node:fs";
import crypto from "node:crypto";
import { DesktopError } from "./env";
import { containedPath, ensureContainedDir, fsyncDir, fsyncFile, realDir } from "./paths";
import { parsePublicKey, parseSignature, verifySignature } from "./minisign";
import { MAX_PACKAGE_BYTES, type UpdatePackage } from "./update-manifest";

const LEGACY_ED_LIMIT = 128 * 1024 * 1024; // legacy "Ed" signs the whole message, which must fit in memory

export type VerifiedPackage = { path: string; name: string; target: string; size: number; sha256: string; signatureVerified: true; keyId: string; verifiedAt: string };

const allowedHost = (host: string) => host === "github.com" || host.endsWith(".githubusercontent.com");

export async function downloadVerifiedPackage(input: {
  pkg: UpdatePackage; tag: string; publicKey: string | undefined; stagingRoot: string;
  fetcher?: typeof fetch; now?: () => number; timeoutMs?: number;
}): Promise<VerifiedPackage> {
  const { pkg } = input, fetcher = input.fetcher ?? fetch;
  if (!input.publicKey) throw new DesktopError("Chave pública de atualização não configurada neste aplicativo. Nada foi baixado.", 503, "updater-not-configured");
  let key, sig;
  try { key = parsePublicKey(input.publicKey); sig = parseSignature(pkg.signature); }
  catch (error) { throw new DesktopError(error instanceof Error ? error.message : "Assinatura inválida.", 422, "signature-format"); }
  if (!sig.keyId.equals(key.keyId)) throw new DesktopError("A assinatura foi feita por outra chave.", 422, "signature-key");
  if (sig.algorithm === "Ed" && pkg.size > LEGACY_ED_LIMIT) throw new DesktopError("Assinatura legada não suportada para pacote deste tamanho.", 422, "signature-algorithm");

  const root = realDir(input.stagingRoot);
  const dir = ensureContainedDir(root, `v-${input.tag.replace(/[^0-9A-Za-z.-]/g, "_")}`);
  const target = containedPath(dir, pkg.name, "absent");
  const partial = containedPath(dir, `.${pkg.name}.${crypto.randomUUID()}.part`, "absent");

  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 30 * 60_000);
  let fd: number | null = null;
  try {
    const response = await fetcher(pkg.url, { redirect: "follow", signal: controller.signal, cache: "no-store", headers: { "User-Agent": "LawyerMind-updater" } });
    if (response.url) { const u = new URL(response.url); if (u.protocol !== "https:" || !allowedHost(u.hostname)) throw new DesktopError("Destino inesperado.", 502, "unexpected-host"); }
    if (!response.ok || !response.body) throw new DesktopError(`O download respondeu HTTP ${response.status}.`, 502, "http");
    const declared = Number(response.headers.get("content-length") ?? pkg.size);
    if (declared !== pkg.size) throw new DesktopError("Tamanho anunciado diverge do manifesto.", 422, "size");

    const sha = crypto.createHash("sha256"), blake = crypto.createHash("blake2b512"), chunks: Buffer[] = [];
    fd = fs.openSync(partial, "wx", 0o600);
    const reader = response.body.getReader(); let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        total += value.byteLength;
        if (total > pkg.size || total > MAX_PACKAGE_BYTES) throw new DesktopError("O pacote excede o tamanho do manifesto.", 422, "size");
        sha.update(value); blake.update(value); fs.writeSync(fd, value);
        if (sig.algorithm === "Ed") chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    if (total !== pkg.size) throw new DesktopError("O pacote baixado está incompleto.", 422, "size");
    fs.fsyncSync(fd); fs.closeSync(fd); fd = null;

    const digest = sha.digest("hex");
    if (digest !== pkg.sha256) throw new DesktopError("SHA-256 não confere com o manifesto. O arquivo foi descartado.", 422, "checksum");
    const valid = verifySignature(key, sig, sig.algorithm === "ED" ? { blake2b512: blake.digest() } : { bytes: Buffer.concat(chunks) });
    if (!valid) throw new DesktopError("Assinatura inválida. O arquivo foi descartado.", 422, "signature");

    fs.linkSync(partial, target); // exclusive: fails if the name already exists
    fsyncFile(target); fsyncDir(dir);
    const record: VerifiedPackage = { path: target, name: pkg.name, target: pkg.target, size: total, sha256: digest, signatureVerified: true, keyId: key.keyId.toString("hex"), verifiedAt: new Date((input.now ?? Date.now)()).toISOString() };
    fs.writeFileSync(containedPath(dir, `${pkg.name}.verified.json`, "absent"), JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return record;
  } catch (error) {
    if (error instanceof DesktopError) throw error;
    throw new DesktopError(controller.signal.aborted ? "O download excedeu o tempo limite." : "O download falhou. Nada foi instalado.", 502, "download");
  } finally {
    clearTimeout(timer);
    if (fd !== null) try { fs.closeSync(fd); } catch { /* already closed */ }
    fs.rmSync(partial, { force: true });
  }
}
