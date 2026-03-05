/**
 * Mini Mezmo Log Export Tool
 *
 * A standalone dev utility that provides a web UI for downloading logs
 * from the Mezmo (LogDNA) Export API v2 between two timestamps.
 *
 * Usage:  cd mezmo-utility && npm start
 *    or:  node --env-file=.env mezmo-logs.mjs  (from this directory)
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = parseInt(process.env.MEZMO_PORT || "3456", 10);
const DEFAULT_API_KEY = process.env.MEZMO_API_KEY || "";
const MEZMO_BASE = "https://api.logdna.com";
const MAX_PAGE_SIZE = 10_000;

/** @type {Map<string, { filename: string, content: string }>} */
const downloads = new Map();

const COMPACT_STRIP_FIELDS = new Set([
  "_line", "message",
  "_key", "_account", "_bid", "_cluster",
  "_file", "_ingester", "_ip", "_logtype",
  "_mezmo_line_size", "_originating_user_agent",
  "_search_index",
]);

function compactLine(line) {
  const out = {};
  for (const [k, v] of Object.entries(line)) {
    if (!COMPACT_STRIP_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

// ─── HTML UI ────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mezmo Log Export</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
  background: #1a1b26;
  color: #c0caf5;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  padding: 40px 20px;
}

.container { width: 100%; max-width: 640px; }

header { margin-bottom: 32px; }
h1 { color: #7aa2f7; font-size: 24px; margin-bottom: 4px; }
.subtitle { color: #565f89; font-size: 14px; }

form { display: flex; flex-direction: column; gap: 16px; }

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.form-group { display: flex; flex-direction: column; gap: 4px; }

label {
  font-size: 13px;
  color: #7982a9;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.hint { font-weight: 400; text-transform: none; color: #565f89; }

input {
  background: #24283b;
  border: 1px solid #3b4261;
  color: #c0caf5;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}

input:focus { border-color: #7aa2f7; }
input::placeholder { color: #565f89; }

input[type="datetime-local"]::-webkit-calendar-picker-indicator {
  filter: invert(0.7);
}

details.filters {
  background: #24283b;
  border-radius: 8px;
  padding: 12px 16px;
  border: 1px solid #3b4261;
}

details.filters summary {
  cursor: pointer;
  color: #7982a9;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
}

details.filters[open] summary { margin-bottom: 12px; }
details.filters .form-row { margin-top: 8px; }

button {
  background: #7aa2f7;
  color: #1a1b26;
  border: none;
  padding: 12px 24px;
  border-radius: 6px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s, opacity 0.2s;
  margin-top: 8px;
}

button:hover { background: #89b4fa; }
button:disabled { opacity: 0.5; cursor: not-allowed; }

.status {
  margin-top: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #24283b;
  border-radius: 8px;
  border: 1px solid #3b4261;
}

.hidden { display: none !important; }

.spinner {
  width: 20px; height: 20px;
  border: 2px solid #3b4261;
  border-top-color: #7aa2f7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }

.result {
  margin-top: 16px;
  padding: 16px;
  background: #1e2030;
  border-radius: 8px;
  border: 1px solid #3b4261;
  font-size: 14px;
}

.result.success { border-color: #9ece6a; color: #9ece6a; }
.result.error   { border-color: #f7768e; color: #f7768e; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Mezmo Log Export</h1>
    <p class="subtitle">Export logs from Mezmo (LogDNA) API v2</p>
  </header>

  <form id="exportForm">
    <div class="form-row">
      <div class="form-group">
        <label for="from">From</label>
        <input type="datetime-local" id="from" required>
      </div>
      <div class="form-group">
        <label for="to">To</label>
        <input type="datetime-local" id="to" required>
      </div>
    </div>

    <div class="form-group">
      <label for="apiKey">API Key <span class="hint" id="keyHint"></span></label>
      <input type="password" id="apiKey" placeholder="Leave blank to use server default">
    </div>

    <details class="filters">
      <summary>Filters (optional)</summary>
      <div class="form-row">
        <div class="form-group">
          <label for="apps">Apps</label>
          <input type="text" id="apps" placeholder="Comma-separated app names">
        </div>
        <div class="form-group">
          <label for="hosts">Hosts</label>
          <input type="text" id="hosts" placeholder="Comma-separated hostnames">
        </div>
      </div>
      <div class="form-row" style="margin-top: 8px;">
        <div class="form-group">
          <label for="levels">Levels</label>
          <input type="text" id="levels" placeholder="e.g. error,warn,info">
        </div>
        <div class="form-group">
          <label for="query">Search Query</label>
          <input type="text" id="query" placeholder="Lucene search query">
        </div>
      </div>
    </details>

    <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="compact" checked>
      <span style="font-size:14px">Compact output <span class="hint">(strip Mezmo metadata &amp; duplicate fields)</span></span>
    </label>

    <button type="submit" id="exportBtn">Export Logs</button>
  </form>

  <div id="status" class="status hidden">
    <div class="spinner"></div>
    <span id="statusText"></span>
  </div>

  <div id="result" class="result hidden"></div>
</div>

<script>
const form = document.getElementById("exportForm");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const resultEl = document.getElementById("result");
const exportBtn = document.getElementById("exportBtn");
const keyHint = document.getElementById("keyHint");

function pad(n) { return String(n).padStart(2, "0"); }

function toLocalISO(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
    + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function init() {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  document.getElementById("to").value = toLocalISO(now);
  document.getElementById("from").value = toLocalISO(hourAgo);

  fetch("/api/has-key")
    .then(r => r.json())
    .then(d => { if (d.hasKey) keyHint.textContent = "(server default available)"; })
    .catch(() => {});
}

function showResult(type, message) {
  resultEl.className = "result " + type;
  resultEl.textContent = message;
  resultEl.classList.remove("hidden");
}

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const fromVal = document.getElementById("from").value;
  const toVal = document.getElementById("to").value;
  if (!fromVal || !toVal) return;

  const fromUnix = Math.floor(new Date(fromVal).getTime() / 1000);
  const toUnix = Math.floor(new Date(toVal).getTime() / 1000);

  if (fromUnix >= toUnix) {
    showResult("error", '"From" must be before "To"');
    return;
  }

  const params = new URLSearchParams();
  params.set("from", fromUnix);
  params.set("to", toUnix);

  const apiKey = document.getElementById("apiKey").value.trim();
  if (apiKey) params.set("apiKey", apiKey);

  for (const id of ["apps", "hosts", "levels", "query"]) {
    const v = document.getElementById(id).value.trim();
    if (v) params.set(id, v);
  }

  if (document.getElementById("compact").checked) params.set("compact", "1");

  exportBtn.disabled = true;
  statusEl.classList.remove("hidden");
  resultEl.classList.add("hidden");
  statusText.textContent = "Connecting...";

  const es = new EventSource("/api/export?" + params);

  es.addEventListener("progress", (e) => {
    const d = JSON.parse(e.data);
    statusText.textContent = "Fetching page " + d.page + "... (" + d.totalLines.toLocaleString() + " lines so far)";
  });

  es.addEventListener("complete", (e) => {
    es.close();
    const d = JSON.parse(e.data);
    statusEl.classList.add("hidden");
    exportBtn.disabled = false;
    showResult("success",
      "Done! " + d.totalLines.toLocaleString() + " lines across " + d.pages + " page(s). Downloading " + d.filename + "...");
    window.location.href = "/api/download?token=" + d.token;
  });

  es.addEventListener("error", (e) => {
    es.close();
    statusEl.classList.add("hidden");
    exportBtn.disabled = false;
    if (e.data) {
      try { showResult("error", JSON.parse(e.data).message); return; } catch {}
    }
    showResult("error", "Connection lost or server error");
  });
});

init();
</script>
</body>
</html>`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function formatDateForFilename(date) {
  return date.toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "");
}

// ─── Routes ─────────────────────────────────────────────────────────────────

async function handleExport(req, res, params) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const apiKey = (params.get("apiKey") || DEFAULT_API_KEY).trim();
  if (!apiKey) {
    sendSSE(res, "error", { message: "No API key provided" });
    res.end();
    return;
  }

  const masked = apiKey.slice(0, 4) + "..." + apiKey.slice(-4);
  console.log(`[mezmo-logs] Using service key: ${masked} (${apiKey.length} chars)`);

  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) {
    sendSSE(res, "error", { message: "Missing from/to timestamps" });
    res.end();
    return;
  }

  const compact = params.get("compact") === "1";
  const apps = params.get("apps");
  const hosts = params.get("hosts");
  const levels = params.get("levels");
  const query = params.get("query");

  const allLines = [];
  let page = 1;
  let paginationId = null;
  let aborted = false;

  req.on("close", () => {
    aborted = true;
  });

  try {
    while (!aborted) {
      sendSSE(res, "progress", { page, totalLines: allLines.length });

      const qp = new URLSearchParams();
      qp.set("from", from);
      qp.set("to", to);
      qp.set("size", String(MAX_PAGE_SIZE));
      qp.set("prefer", "head");
      if (apps) qp.set("apps", apps);
      if (hosts) qp.set("hosts", hosts);
      if (levels) qp.set("levels", levels);
      if (query) qp.set("query", query);
      if (paginationId) qp.set("pagination_id", paginationId);

      const url = `${MEZMO_BASE}/v2/export?${qp}`;
      if (page === 1) console.log(`[mezmo-logs] GET ${url.replace(apiKey, "***")}`);

      // sts_ keys = newer platform access tokens → "Authorization: Token <key>"
      // Legacy keys → servicekey header + Basic auth fallback
      const headers = apiKey.startsWith("sts_")
        ? { Authorization: `Token ${apiKey}` }
        : {
            servicekey: apiKey,
            Authorization: `Basic ${Buffer.from(apiKey + ":").toString("base64")}`,
          };

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const text = await response.text();
        sendSSE(res, "error", {
          message: `Mezmo API ${response.status}: ${text}`,
        });
        res.end();
        return;
      }

      const data = await response.json();
      const lines = data.lines || [];
      allLines.push(...lines);

      if (lines.length < MAX_PAGE_SIZE || !data.pagination_id) {
        break;
      }

      paginationId = data.pagination_id;
      page++;
    }

    if (aborted) return;

    const token = randomUUID();
    const fromDate = formatDateForFilename(new Date(parseInt(from) * 1000));
    const toDate = formatDateForFilename(new Date(parseInt(to) * 1000));
    const filename = `mezmo-${fromDate}_to_${toDate}.log`;

    const content = allLines.map((l) => JSON.stringify(compact ? compactLine(l) : l)).join("\n");
    downloads.set(token, { filename, content });

    // Auto-cleanup after 5 minutes
    setTimeout(() => downloads.delete(token), 5 * 60 * 1000);

    sendSSE(res, "complete", {
      token,
      filename,
      totalLines: allLines.length,
      pages: page,
    });
  } catch (err) {
    sendSSE(res, "error", { message: err.message });
  } finally {
    res.end();
  }
}

function handleDownload(_req, res, params) {
  const token = params.get("token");
  const entry = downloads.get(token);
  if (!entry) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Download expired or not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${entry.filename}"`,
    "Content-Length": Buffer.byteLength(entry.content, "utf-8"),
    "Cache-Control": "no-store",
  });
  res.end(entry.content);
  downloads.delete(token);
}

// ─── Server ─────────────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/has-key") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ hasKey: !!DEFAULT_API_KEY }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/export") {
    await handleExport(req, res, url.searchParams);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/download") {
    handleDownload(req, res, url.searchParams);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}

const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`[mezmo-logs] Listening on http://localhost:${PORT}`);
});
