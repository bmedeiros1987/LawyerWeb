// Typed wrappers over the Tauri commands defined in src-tauri/src/lib.rs.
// The UI never talks to a network server: `invoke` is in-process IPC.
import { invoke } from "@tauri-apps/api/core";

export type Client = {
  id: string; type: "INDIVIDUAL" | "LEGAL_ENTITY"; name: string; legal_name: string | null;
  cpf_cnpj: string | null; email: string | null; phone: string | null; status: "ACTIVE" | "ARCHIVED";
  notes: string | null; created_at: string; updated_at: string; matter_count?: number; document_count?: number;
};
export type Matter = {
  id: string; client_id: string; client_name?: string; number: string | null; title: string; type: string;
  practice_area: string | null; court: string | null; jurisdiction: string | null; status: "ACTIVE" | "ARCHIVED";
  notes: string | null; created_at: string; updated_at: string; document_count?: number;
};
export type Doc = {
  id: string; client_id: string; matter_id: string | null; name: string; relative_path: string;
  original_name: string | null; size_bytes: number; sha256: string; created_at: string;
  client_name?: string; matter_title?: string | null; matter_number?: string | null;
};
export type RootCheck = { root: string; exists: boolean; total: number; found: number; missing: number; missing_samples: string[] };
export type Status = {
  ready: boolean; error: string | null; app_version: string; postgres_version: string | null; postgres_port: number | null;
  state_dir: string | null; database_dir: string | null; documents_root: string | null; documents_check: RootCheck | null;
  counts: { clients: number; matters: number; documents: number } | null; schema_version: number;
};
export type BackupReport = { path: string; bytes: number; includes_documents: boolean; counts: Record<string, number>; documents_bytes: number; verified: boolean };
export type Manifest = { format: string; format_version: number; schema_version: number; created_at: string; app_version: string; includes_documents: boolean; counts: Record<string, number>; documents_bytes: number };
export type RestoreReport = { restored_from: string; safety_backup: string; counts: Record<string, number>; includes_documents: boolean; documents_root: string | null; documents_written: number; documents_already_present: number };

export type ClientInput = { type: string; name: string; legal_name?: string; cpf_cnpj?: string; email?: string; phone?: string; notes?: string };
export type MatterInput = { client_id: string; number?: string; title: string; type?: string; practice_area?: string; court?: string; jurisdiction?: string; notes?: string };

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Não foi possível concluir a operação.";
}

export const api = {
  status: () => invoke<Status>("app_status"),
  listClients: (query: string, includeArchived: boolean) => invoke<Client[]>("list_clients", { query: query || null, includeArchived }),
  getClient: (id: string) => invoke<Client>("get_client", { id }),
  createClient: (input: ClientInput) => invoke<Client>("create_client", { input }),
  updateClient: (id: string, input: ClientInput) => invoke<Client>("update_client", { id, input }),
  setClientStatus: (id: string, status: string) => invoke<Client>("set_client_status", { id, status }),
  listMatters: (clientId: string | null, query: string, includeArchived: boolean) =>
    invoke<Matter[]>("list_matters", { clientId, query: query || null, includeArchived }),
  createMatter: (input: MatterInput) => invoke<Matter>("create_matter", { input }),
  updateMatter: (id: string, input: MatterInput) => invoke<Matter>("update_matter", { id, input }),
  setMatterStatus: (id: string, status: string) => invoke<Matter>("set_matter_status", { id, status }),
  listDocuments: (clientId: string | null, matterId: string | null) => invoke<Doc[]>("list_documents", { clientId, matterId }),
  importDocument: (source: string, clientId: string, matterId: string | null, name: string | null) =>
    invoke<Doc>("import_document", { source, clientId, matterId, name }),
  openDocument: (id: string) => invoke<void>("open_document", { id }),
  revealDocument: (id: string) => invoke<void>("reveal_document", { id }),
  checkDocumentsRoot: (path: string) => invoke<RootCheck>("check_documents_root", { path }),
  setDocumentsRoot: (path: string, force: boolean) => invoke<RootCheck>("set_documents_root", { path, force }),
  createBackup: (dest: string, includeDocuments: boolean) => invoke<BackupReport>("create_backup", { dest, includeDocuments }),
  verifyBackup: (path: string) => invoke<Manifest>("verify_backup", { path }),
  restoreBackup: (path: string, documentsTarget: string | null) => invoke<RestoreReport>("restore_backup", { path, documentsTarget }),
  pickFolder: (title: string) => invoke<string | null>("pick_folder", { title }),
  pickFile: (title: string, backupOnly: boolean) => invoke<string | null>("pick_file", { title, backupOnly }),
  pickBackupDestination: (defaultName: string) => invoke<string | null>("pick_backup_destination", { defaultName }),
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR");
}
