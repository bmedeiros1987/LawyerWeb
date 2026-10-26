// Shows startup progress/errors. The shell navigates to the local server when ready.
(function () {
  const invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  async function tick() {
    if (!invoke) return;
    try {
      const s = await invoke("startup_status");
      document.getElementById("phase").textContent = s.phase || "Iniciando…";
      if (s.error) {
        document.getElementById("bar").hidden = true;
        document.getElementById("error").hidden = false;
        document.getElementById("message").textContent = s.error;
        document.getElementById("state").textContent = s.state_dir || "";
        return;
      }
    } catch (e) { /* not ready yet */ }
    setTimeout(tick, 600);
  }
  tick();
})();
