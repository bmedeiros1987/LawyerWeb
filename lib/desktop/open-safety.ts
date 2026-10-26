// Safety gate for files the operating system asks LawyerMind to open (PDF and DOCX only).
// The Rust shell only filters lexically; this module is the authority and runs BEFORE any import:
//   * path rules (absolute, no "..", no device/UNC/stream/reserved names on Windows, no control chars);
//   * the final path component must be a regular file, never a symbolic link, FIFO, device or folder;
//   * content sniffing (a ".docx" that is really a legacy .doc or random bytes is refused);
//   * DOCX: the ZIP central directory is inspected without decompressing anything beyond small relationship
//     files (entry count, declared sizes, compression ratio, encryption, traversal names, macros, ActiveX);
//   * PDF: a bounded scan for active content tokens (best effort, NOT an antivirus).
// Nothing here executes, renders, opens in another program or sends a file anywhere.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";

export const OPEN_LIMITS = {
  maxPathLength: 4096,
  maxFileBytes: 300 * 1024 ** 2,
  maxEntries: 5000,
  maxEntryBytes: 100 * 1024 ** 2,
  maxTotalUncompressed: 400 * 1024 ** 2,
  bombMinEntryBytes: 10 * 1024 ** 2,
  bombEntryRatio: 100,
  bombTotalRatio: 1000,
  maxSmallPartBytes: 1024 ** 2,
  maxRelationshipParts: 200,
  pdfScanBytes: 64 * 1024 ** 2,
};
export type OpenLimits = typeof OPEN_LIMITS;

export type Finding = { severity: "block" | "warn"; code: string; message: string };
export type Assessment = {
  input: string; ok: boolean; kind: "pdf" | "docx" | null; path: string | null; name: string; size: number; sha256: string | null; findings: Finding[];
};

const block = (code: string, message: string): Finding => ({ severity: "block", code, message });
const warn = (code: string, message: string): Finding => ({ severity: "warn", code, message });

export function lexicalCheck(input: string, platform: NodeJS.Platform = process.platform, limits = OPEN_LIMITS): Finding | null {
  if (!input) return block("empty", "Caminho vazio.");
  if (input.length > limits.maxPathLength) return block("too-long", "Caminho longo demais.");
  if (/[\u0000-\u001f\u007f]/.test(input)) return block("control-chars", "O caminho contém caracteres de controle.");
  const win = platform === "win32";
  if (win) {
    if (/^\\\\[?.]\\/.test(input) || /^\/\/[?.]\//.test(input)) return block("device-path", "Caminhos de dispositivo do Windows não são aceitos.");
    if (/^(\\\\|\/\/)/.test(input)) return block("network-path", "Arquivos em compartilhamento de rede (UNC) não são abertos automaticamente. Copie o arquivo para este computador.");
    if (!/^[A-Za-z]:[\\/]/.test(input)) return block("not-absolute", "O caminho precisa ser absoluto.");
  } else if (!input.startsWith("/")) return block("not-absolute", "O caminho precisa ser absoluto.");
  const rest = win ? input.slice(2) : input;
  if (win && rest.includes(":")) return block("stream-suffix", "Nomes com fluxo alternativo (:) não são aceitos.");
  const segments = rest.split(/[\\/]/).filter(Boolean);
  if (segments.includes("..")) return block("parent-segment", "O caminho contém '..'.");
  if (win) {
    if (segments.some(s => /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s.split(".")[0]))) return block("reserved-name", "Nome reservado do Windows.");
    const last = segments.at(-1) ?? "";
    if (/[. ]$/.test(last)) return block("trailing-dot-space", "Nome terminado em ponto ou espaço.");
  }
  const last = segments.at(-1) ?? "", dot = last.lastIndexOf(".");
  const ext = dot > 0 ? last.slice(dot + 1).toLowerCase() : "";
  if (ext === "doc") return block("legacy-doc", "O formato .doc (Word 97-2003) não é aberto pelo LawyerMind: a compatibilidade não foi comprovada. Salve como .docx no Word e abra de novo.");
  if (ext !== "pdf" && ext !== "docx") return block("extension", "Somente PDF e DOCX são abertos.");
  return null;
}

type Zip = yauzl.ZipFile;
const openZip = (fd: number) => new Promise<Zip>((resolve, reject) =>
  yauzl.fromFd(fd, { lazyEntries: true, autoClose: false, validateEntrySizes: true, decodeStrings: true, strictFileNames: true }, (e, z) => e || !z ? reject(e ?? new Error("zip")) : resolve(z)));

function readSmall(zip: Zip, entry: yauzl.Entry, max: number): Promise<string> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (e, stream) => {
    if (e || !stream) return reject(e ?? new Error("stream"));
    const chunks: Buffer[] = []; let total = 0;
    stream.on("data", (c: Buffer) => { total += c.length; if (total > max) { stream.destroy(); reject(new Error("too-big")); } else chunks.push(c); });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  }));
}

/** Takes ownership of `fd`: yauzl closes it with the archive, and it is closed here when the archive cannot be opened. */
export async function inspectDocx(fd: number, fileSize: number, limits = OPEN_LIMITS): Promise<Finding[]> {
  const findings: Finding[] = [];
  let zip: Zip;
  try { zip = await openZip(fd); }
  catch { try { fs.closeSync(fd); } catch { /* already closed */ } return [block("malformed", "O arquivo não é um DOCX válido (estrutura ZIP ilegível, truncada ou com nomes inseguros).")]; }
  const names = new Set<string>(); const rels: yauzl.Entry[] = []; let contentTypes: yauzl.Entry | null = null;
  let count = 0, total = 0, hardStop = false;
  await new Promise<void>(resolve => {
    zip.on("error", () => { findings.push(block("malformed", "O arquivo ZIP está corrompido.")); resolve(); });
    zip.on("end", () => resolve());
    zip.on("entry", (entry: yauzl.Entry) => {
      if (hardStop) return;
      const stop = (f: Finding) => { findings.push(f); hardStop = true; zip.close(); resolve(); };
      if (++count > limits.maxEntries) return stop(block("too-many-entries", "O DOCX tem entradas demais."));
      names.add(entry.fileName);
      if (entry.isEncrypted()) return stop(block("encrypted", "O DOCX está criptografado."));
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) return stop(block("compression", "Método de compressão não suportado."));
      if (entry.uncompressedSize > limits.maxEntryBytes) return stop(block("zip-bomb", "Uma parte do DOCX declara tamanho descomprimido excessivo."));
      total += entry.uncompressedSize;
      if (total > limits.maxTotalUncompressed || (fileSize > 0 && total / fileSize > limits.bombTotalRatio)) return stop(block("zip-bomb", "O DOCX declara conteúdo descomprimido desproporcional ao arquivo (possível bomba de compressão)."));
      if (entry.uncompressedSize > limits.bombMinEntryBytes && entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > limits.bombEntryRatio) return stop(block("zip-bomb", "Razão de compressão suspeita (possível bomba de compressão)."));
      if (entry.fileName === "[Content_Types].xml") contentTypes = entry;
      if (entry.fileName.endsWith(".rels") && rels.length < limits.maxRelationshipParts) rels.push(entry);
      zip.readEntry();
    });
    zip.readEntry();
  });
  if (hardStop || findings.some(f => f.severity === "block")) return findings;

  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) findings.push(block("not-docx", "O arquivo é um ZIP, mas não contém as partes de um documento Word (.docx)."));
  if ([...names].some(n => /(^|\/)vbaProject\.bin$/i.test(n) || /(^|\/)vbaData\.xml$/i.test(n))) findings.push(block("macros", "O documento contém macros (VBA). O LawyerMind não executa macros e não importa documentos que as contenham."));
  if ([...names].some(n => /(^|\/)activeX\//i.test(n))) findings.push(block("activex", "O documento contém controles ActiveX, que não são abertos."));
  if ([...names].some(n => /(^|\/)embeddings\//i.test(n))) findings.push(warn("embedded-objects", "O documento contém objetos incorporados. Eles não são abertos nem executados."));

  try {
    const ct = contentTypes as yauzl.Entry | null;
    if (ct && /macroEnabled/i.test(await readSmall(zip, ct, limits.maxSmallPartBytes))) findings.push(block("macros", "O tipo do documento é habilitado para macros (.docm)."));
    let external = 0;
    for (const e of rels) {
      const xml = await readSmall(zip, e, limits.maxSmallPartBytes);
      for (const m of xml.matchAll(/<Relationship\b[^>]*>/gi)) {
        if (!/TargetMode\s*=\s*"External"/i.test(m[0])) continue;
        const type = /Type\s*=\s*"([^"]*)"/i.exec(m[0])?.[1] ?? "";
        if (!/\/hyperlink$/i.test(type)) external++; // ordinary hyperlinks are fine; templates, images, frames are not
      }
    }
    if (external) findings.push(warn("external-content", `O documento referencia ${external} recurso(s) externo(s) (modelo, imagem, quadro). O LawyerMind não os baixa nem carrega.`));
  } catch { findings.push(block("malformed", "Uma parte interna do DOCX está corrompida ou grande demais.")); }
  finally { zip.close(); }
  return findings;
}

const PDF_TOKENS: [RegExp, Finding][] = [
  [/\/(JavaScript|JS)(?![A-Za-z0-9])/, warn("pdf-javascript", "O PDF contém JavaScript. O LawyerMind não o executa; outros leitores podem executar se você abrir a cópia neles.")],
  [/\/Launch(?![A-Za-z0-9])/, warn("pdf-launch", "O PDF contém uma ação de iniciar programa (Launch). Ela não é executada.")],
  [/\/(OpenAction|AA)(?![A-Za-z0-9])/, warn("pdf-auto-action", "O PDF define ação automática ao abrir. Ela não é executada.")],
  [/\/EmbeddedFile(?![A-Za-z0-9])/, warn("pdf-embedded-file", "O PDF contém arquivo(s) anexado(s). Eles não são extraídos nem abertos.")],
  [/\/(RichMedia|XFA)(?![A-Za-z0-9])/, warn("pdf-rich-content", "O PDF contém mídia ou formulário dinâmico (RichMedia/XFA), que não são abertos.")],
  [/\/Encrypt(?![A-Za-z0-9])/, warn("pdf-encrypted", "O PDF parece protegido por senha: o texto pode não ser pesquisável.")],
];

export function scanPdf(fd: number, size: number, limits = OPEN_LIMITS): Finding[] {
  const findings: Finding[] = [];
  const buf = Buffer.alloc(1024 ** 2); const seen = new Set<string>();
  let pos = 0, carry = "";
  const limit = Math.min(size, limits.pdfScanBytes);
  while (pos < limit) {
    const n = fs.readSync(fd, buf, 0, Math.min(buf.length, limit - pos), pos);
    if (n <= 0) break;
    const text = carry + buf.toString("latin1", 0, n);
    for (const [re, f] of PDF_TOKENS) if (!seen.has(f.code) && re.test(text)) { seen.add(f.code); findings.push(f); }
    carry = text.slice(-32); pos += n;
  }
  if (size > limit) findings.push(warn("partial-scan", `Verificação parcial: só os primeiros ${Math.round(limit / 1024 ** 2)} MiB foram examinados.`));
  const tail = Buffer.alloc(Math.min(1024, size)); fs.readSync(fd, tail, 0, tail.length, Math.max(0, size - tail.length));
  if (!tail.toString("latin1").includes("%%EOF")) findings.push(warn("pdf-truncated", "O PDF não tem o marcador de fim (%%EOF): pode estar truncado ou malformado."));
  findings.push(warn("scan-note", "A verificação é uma varredura simples e não substitui um antivírus."));
  return findings;
}

function hashFd(fd: number, size: number): string {
  const h = crypto.createHash("sha256"), buf = Buffer.alloc(1024 ** 2); let pos = 0;
  while (pos < size) { const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos); if (n <= 0) break; h.update(buf.subarray(0, n)); pos += n; }
  return h.digest("hex");
}

/** Reads (never writes) one candidate and reports whether it may be offered for import. */
export async function assessOpenCandidate(input: string, opts: { platform?: NodeJS.Platform; limits?: OpenLimits } = {}): Promise<Assessment> {
  const limits = opts.limits ?? OPEN_LIMITS;
  const base: Assessment = { input, ok: false, kind: null, path: null, name: path.basename(input.replace(/\\/g, "/")), size: 0, sha256: null, findings: [] };
  const lex = lexicalCheck(input, opts.platform, limits);
  if (lex) return { ...base, findings: [lex] };
  const ext = path.extname(input).toLowerCase();
  const kind = ext === ".pdf" ? "pdf" : "docx";
  let real: string;
  try {
    const st = fs.lstatSync(input);
    if (st.isSymbolicLink()) return { ...base, kind, findings: [block("symlink", "O arquivo é um atalho simbólico (link). Por segurança ele não é aberto; abra o arquivo de destino diretamente.")] };
    if (!st.isFile()) return { ...base, kind, findings: [block("not-regular", "Não é um arquivo comum (pasta, dispositivo ou fila).")] };
    real = path.join(fs.realpathSync.native(path.dirname(input)), path.basename(input));
  } catch { return { ...base, kind, findings: [block("unreadable", "O arquivo não existe ou não pôde ser lido.")] }; }

  let fd: number;
  try { fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)); }
  catch { return { ...base, kind, findings: [block("unreadable", "O arquivo não pôde ser aberto para leitura.")] }; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ...base, kind, findings: [block("not-regular", "Não é um arquivo comum.")] };
    const out: Assessment = { ...base, kind, path: real, size: st.size };
    if (st.size === 0) return { ...out, findings: [block("empty", "O arquivo está vazio.")] };
    if (st.size > limits.maxFileBytes) return { ...out, findings: [block("too-large", `Arquivo maior que ${Math.round(limits.maxFileBytes / 1024 ** 2)} MiB.`)] };
    const head = Buffer.alloc(1024); const n = fs.readSync(fd, head, 0, 1024, 0); const h = head.subarray(0, n);
    const ole = h.subarray(0, 8).equals(Buffer.from("D0CF11E0A1B11AE1", "hex"));
    if (kind === "pdf" && !h.includes("%PDF-")) return { ...out, findings: [block("type-mismatch", ole ? "O conteúdo é um arquivo do Office antigo, não um PDF." : "O conteúdo não é um PDF válido (cabeçalho %PDF- ausente).")] };
    if (kind === "docx" && !(h[0] === 0x50 && h[1] === 0x4b && h[2] === 3 && h[3] === 4)) return { ...out, findings: [block("type-mismatch", ole ? "Este arquivo é um documento do Word antigo (.doc) ou protegido por senha, não um DOCX. Salve como .docx no Word." : "O conteúdo não é um DOCX válido.")] };
    let findings: Finding[];
    if (kind === "docx") {
      // The ZIP reader owns (and closes) the descriptor it is given, so it gets its own, on the very same file.
      let zipFd: number;
      try { zipFd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)); }
      catch { return { ...out, findings: [block("unreadable", "O arquivo não pôde ser aberto para leitura.")] }; }
      const second = fs.fstatSync(zipFd);
      if (second.ino !== st.ino || second.dev !== st.dev || second.size !== st.size) { fs.closeSync(zipFd); return { ...out, findings: [block("changed", "O arquivo mudou durante a verificação. Tente novamente.")] }; }
      findings = await inspectDocx(zipFd, st.size, limits);
    } else findings = scanPdf(fd, st.size, limits);
    const blocked = findings.some(f => f.severity === "block");
    const sha256 = blocked ? null : hashFd(fd, st.size);
    const after = fs.fstatSync(fd);
    if (after.size !== st.size || after.mtimeMs !== st.mtimeMs) return { ...out, findings: [block("changed", "O arquivo mudou durante a verificação. Tente novamente.")] };
    return { ...out, ok: !blocked, sha256, findings };
  } finally { fs.closeSync(fd); }
}
