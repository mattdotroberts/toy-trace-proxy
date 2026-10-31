// Toy Trace companion proxy.
// Receives {image: "<dataURL>"} from the app, asks the Thaura model to identify
// the toy, and returns JSON. The API key lives only on this server: either in
// the THAURA_API_KEY environment variable, or in /data/thaura_api_key, which is
// set once through /setup and survives redeploys.
// Zero dependencies: run with any Node 18+, no npm install needed.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || '/data';
const KEY_FILE = path.join(DATA_DIR, 'thaura_api_key');
const TOKEN_FILE = path.join(DATA_DIR, 'scan_token');
// The researched database (db.json) and a copy of the app page (app.html) live in
// this repo next to server.js. Updating the database is a one-file commit and
// redeploy; every copy of the app page picks it up at its next load via /db.
const DB_FILE = path.join(__dirname, 'db.json');
const APP_FILE = path.join(__dirname, 'app.html');

function readSecret(envName, file) {
  if (process.env[envName]) return process.env[envName].trim();
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
}
function getKey() { return readSecret('THAURA_API_KEY', KEY_FILE); }
function getScanToken() { return readSecret('SCAN_TOKEN', TOKEN_FILE); }

const SYSTEM_PROMPT = `You identify toys, dolls and children's products from photographs.
Look at the whole photo: the character's design, any printed text, logos, tags and packaging.
Pick the single most likely toy. Reply with JSON only, exactly this shape:
{"toy_name": string, "brand": string, "company": string, "confidence": number, "notes": string}
- toy_name: the specific product or character name, or "unknown".
- brand: the brand on the packaging or associated with the character, or "unknown".
- company: the manufacturer or licensor if you know it, else "unknown".
- confidence: 0 to 1. Below 0.5 whenever you are unsure.
- notes: one short sentence, at most, on what you can actually see that supports this.
Never invent a brand, character or company you cannot read or recognise. "unknown" is always acceptable.`;

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// One-time setup: store the API key (and optional scan token) under /data.
// Only works while no key exists yet, so the first person to set it wins.
function serveSetupForm(res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Toy Trace proxy setup</title></head>
<body style="font-family:sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem">
<h1>Toy Trace proxy setup</h1>
<p>Paste your Thaura API key once. It is stored on this server only, and this page stops working afterwards.</p>
${getKey() ? '<p style="color:green">A key is already configured. This page is closed.</p>' : `
<form id="f"><p><label>THAURA_API_KEY<br><input name="key" type="password" style="width:100%" required></label></p>
<p><label>SCAN_TOKEN (optional)<br><input name="scan_token" type="text" style="width:100%"></label></p>
<p><button style="padding:.6rem 1.2rem">Save</button></p></form>
<p id="msg"></p>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const r = await fetch('/setup', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({key: fd.get('key'), scan_token: fd.get('scan_token')})});
  const j = await r.json().catch(() => ({}));
  document.getElementById('msg').textContent = r.ok ? 'Saved. The proxy is live.' : ('Failed: ' + (j.error || r.status));
});
</script>`}
</body></html>`);
}

async function identify(req, res) {
  // Manual CORS so the static page can call this from any origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Scan-Token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  let body = '';
  let tooBig = false;
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 20 * 1024 * 1024) { tooBig = true; req.destroy(); }
  });
  req.on('end', async () => {
    if (tooBig) return;
    try {
      const url = new URL(req.url, 'http://x');

      if (url.pathname === '/health') {
        return json(res, 200, { ok: true, configured: !!getKey() });
      }

      if (url.pathname === '/setup' && req.method === 'GET') {
        return serveSetupForm(res);
      }

      if (url.pathname === '/setup' && req.method === 'POST') {
        if (getKey()) return json(res, 403, { error: 'A key is already configured. Delete /data/thaura_api_key on the server to reset.' });
        const { key, scan_token } = JSON.parse(body || '{}');
        if (!key || typeof key !== 'string' || key.length < 10) return json(res, 400, { error: 'Send {"key": "..."} with a valid Thaura API key.' });
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(KEY_FILE, key.trim() + '\n', { mode: 0o600 });
        if (scan_token) fs.writeFileSync(TOKEN_FILE, String(scan_token).trim() + '\n', { mode: 0o600 });
        return json(res, 200, { ok: true });
      }

      if (url.pathname === '/db' && req.method === 'GET') {
        try {
          const body = fs.readFileSync(DB_FILE);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
          return res.end(body);
        } catch { return json(res, 404, { error: 'No db.json found' }); }
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/app')) {
        try {
          const body = fs.readFileSync(APP_FILE);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          return res.end(body);
        } catch { return json(res, 404, { error: 'No app.html found' }); }
      }

      if (req.method !== 'POST' || url.pathname !== '/identify') {
        return json(res, 405, { error: 'POST /identify only' });
      }

      const { image } = JSON.parse(body || '{}');
      if (!image || !image.startsWith('data:image/')) {
        return json(res, 400, { error: 'Send {"image": "<data:image/... URL>"}' });
      }
      const token = getScanToken();
      if (token && req.headers['x-scan-token'] !== token) {
        return json(res, 401, { error: 'Bad token' });
      }
      const apiKey = getKey();
      if (!apiKey) return json(res, 503, { error: 'Proxy has no API key yet. Open /setup once.' });

      const r = await fetch('https://backend.thaura.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'thaura',
          response_format: { type: 'json_object' },
          max_tokens: 500,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Identify the toy in this photo.' },
                { type: 'image_url', image_url: { url: image } }
              ]
            }
          ]
        })
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return json(res, r.status, { error: (err.error && err.error.message) || `Thaura API error ${r.status}` });
      }
      const data = await r.json();
      const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      let parsed;
      try { parsed = JSON.parse(content); }
      catch { parsed = { toy_name: 'unknown', brand: 'unknown', company: 'unknown', confidence: 0, notes: 'The model did not return clean JSON.' }; }
      return json(res, 200, parsed);
    } catch (e) {
      return json(res, 500, { error: (e && e.message) || 'Unexpected error' });
    }
  });
}

const server = http.createServer(identify);
server.listen(PORT, () => {
  console.log(`Toy Trace proxy listening on port ${PORT}. Key ${getKey() ? 'loaded.' : 'not set yet: open /setup once.'}`);
});
