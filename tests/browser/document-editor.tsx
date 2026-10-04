import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DocumentDraftEditor } from "../../components/document-draft-editor";
import { DocumentStatusAction } from "../../components/legal-status-actions";
import "../../app/globals.css";

type Fixture = { version: number; status: string; body: string; approvals: number[]; conflicts: number };
const fixture: Fixture = { version: 1, status: "APPROVED", body: "Texto sintético inicial", approvals: [], conflicts: 0 };
(window as Window & { draftFixture?: Fixture }).draftFixture = fixture;
window.fetch = async (url, init) => {
  if (init?.method === "PATCH") {
    const input = JSON.parse(String(init.body));
    fixture.approvals.push(input.expectedVersion);
    if (input.expectedVersion !== fixture.version) { fixture.conflicts++; return Response.json({ error: "Versão mudou" }, { status: 409 }); }
    fixture.status = input.status;
    return Response.json({ document: fixture });
  }
  if (init?.method === "POST") throw new Error("Unexpected save in state-sync fixture");
  return Response.json({ body: fixture.body, version: fixture.version, currentVersion: fixture.version, status: fixture.status });
};
function FixturePage() {
  const [server, setServer] = useState({ version: fixture.version, status: fixture.status });
  useEffect(() => {
    const refresh = () => setServer({ version: fixture.version, status: fixture.status });
    window.addEventListener("fixture:refresh", refresh);
    return () => window.removeEventListener("fixture:refresh", refresh);
  }, []);
  return <main className="app-frame" style={{ display: "block", padding: 24 }}>
    <h1>Revisão sintética</h1>
    <DocumentStatusAction id="synthetic-document" workspaceId="synthetic-workspace" status={server.status} currentVersion={server.version}/>
    <DocumentDraftEditor documentId="synthetic-document" workspaceId="synthetic-workspace" userId="synthetic-user" canEdit serverStatus={server.status} serverVersion={server.version}/>
  </main>;
}
createRoot(document.getElementById("root")!).render(<FixturePage/>);
