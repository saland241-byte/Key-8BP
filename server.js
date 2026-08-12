const WebSocket = require('ws');
const fs   = require('fs');
const path = require('path');

// ── Keys ──────────────────────────────────────────────────────────────────────
// 50 normal keys — 3-day validity
// 50 normal keys — 7-day validity
const VALID_KEYS = [
  // --- 3-day keys (50) ---
  'jpSQwj', 'qTZfQW', 'iUiZMM', 'loNviy', 'JyQ1yZ',
  'RlIIdp', 'MErqJo', 'Y1xBS1', 'm4Wluq', '4Zncmt',
  'lN7YiE', '13OsnH', '3QhNYL', '0HLPk1', 'pwDg6c',
  '4IfTSi', '8Rm2dw', '9Fbh1G', '04fBOW', 'uNoUt2',
  'dcYGu8', 'Nj8pG3', '3V8eIw', 'FNR1k8', 'mbrwdk',
  'ZCQBcu', 'hfdFia', 'Uu7HXH', 'n9JJpT', 'ge90N9',
  'EXnyLf', 'hELl7d', '6V4V9r', 'sUGwSW', 'QHBUGo',
  'VvdseY', 'SIjPsR', 'BuTTis', 'FvZlKZ', 'r4owCj',
  '4Q8wfi', 'U1GUlO', 'YiVOdF', 'BBszUL', '7g4MoS',
  'kAosGm', 'nBvDzE', 'wasWV5', 'gnJuZE', 'eHCgt9',
  // --- 7-day keys (50) ---
  'UXyK9A', 'AGpJI7', 'jxq3Qo', 'InY34q', 'LS9b8m',
  'Xm2fQG', 'E89Ckm', 'RyPipn', 'ayDbbq', '2mNTBx',
  'T85Sts', 'QRmhPd', 'zBKwUa', 'QPzsW9', 'sSbrTG',
  'z2pn6L', 'wrZhmY', 'OlO1mR', 'TMIWnT', 'eInmX0',
  'Fr1hCg', '9gHrHO', 'S1rQn5', '8NfTTE', 'vlnaln',
  'xuu88U', 'xm8pU4', 'vJrLsD', 'O9wp3H', 'k8eiNw',
  'OgBocK', '7flBnA', '8um4XU', 'RxNwl2', 'ph4qX2',
  '0uPGIn', 'CH3eop', 'ynelRA', 'qeFes8', 'VepsZh',
  'Nv2adX', 'W8r4ER', 'NhshKY', 'KWsZby', 'Gtjqgk',
  'OKIZ2z', 'DVpPDL', '2BNurh', 'l1wGKN', 'fqnQx5',
];

const KEY_DAYS = {
  // 3-day keys
  'jpSQwj': 3, 'qTZfQW': 3, 'iUiZMM': 3, 'loNviy': 3, 'JyQ1yZ': 3,
  'RlIIdp': 3, 'MErqJo': 3, 'Y1xBS1': 3, 'm4Wluq': 3, '4Zncmt': 3,
  'lN7YiE': 3, '13OsnH': 3, '3QhNYL': 3, '0HLPk1': 3, 'pwDg6c': 3,
  '4IfTSi': 3, '8Rm2dw': 3, '9Fbh1G': 3, '04fBOW': 3, 'uNoUt2': 3,
  'dcYGu8': 3, 'Nj8pG3': 3, '3V8eIw': 3, 'FNR1k8': 3, 'mbrwdk': 3,
  'ZCQBcu': 3, 'hfdFia': 3, 'Uu7HXH': 3, 'n9JJpT': 3, 'ge90N9': 3,
  'EXnyLf': 3, 'hELl7d': 3, '6V4V9r': 3, 'sUGwSW': 3, 'QHBUGo': 3,
  'VvdseY': 3, 'SIjPsR': 3, 'BuTTis': 3, 'FvZlKZ': 3, 'r4owCj': 3,
  '4Q8wfi': 3, 'U1GUlO': 3, 'YiVOdF': 3, 'BBszUL': 3, '7g4MoS': 3,
  'kAosGm': 3, 'nBvDzE': 3, 'wasWV5': 3, 'gnJuZE': 3, 'eHCgt9': 3,
  // 7-day keys
  'UXyK9A': 7, 'AGpJI7': 7, 'jxq3Qo': 7, 'InY34q': 7, 'LS9b8m': 7,
  'Xm2fQG': 7, 'E89Ckm': 7, 'RyPipn': 7, 'ayDbbq': 7, '2mNTBx': 7,
  'T85Sts': 7, 'QRmhPd': 7, 'zBKwUa': 7, 'QPzsW9': 7, 'sSbrTG': 7,
  'z2pn6L': 7, 'wrZhmY': 7, 'OlO1mR': 7, 'TMIWnT': 7, 'eInmX0': 7,
  'Fr1hCg': 7, '9gHrHO': 7, 'S1rQn5': 7, '8NfTTE': 7, 'vlnaln': 7,
  'xuu88U': 7, 'xm8pU4': 7, 'vJrLsD': 7, 'O9wp3H': 7, 'k8eiNw': 7,
  'OgBocK': 7, '7flBnA': 7, '8um4XU': 7, 'RxNwl2': 7, 'ph4qX2': 7,
  '0uPGIn': 7, 'CH3eop': 7, 'ynelRA': 7, 'qeFes8': 7, 'VepsZh': 7,
  'Nv2adX': 7, 'W8r4ER': 7, 'NhshKY': 7, 'KWsZby': 7, 'Gtjqgk': 7,
  'OKIZ2z': 7, 'DVpPDL': 7, '2BNurh': 7, 'l1wGKN': 7, 'fqnQx5': 7,
};

// ── Free shared keys (no HWID binding) ───────────────────────────────────────
// Countdown starts on first activation; once expired nobody can use the key.
// 2 shared keys — 7-day timer
// 3 shared keys — 3-day timer
const FREE_KEYS = [
  'j4VN2j', 'zT5GDq',   // 7-day shared
  'pTqFpj', 'sa22IK', 'vU5d0B', // 3-day shared
];

// Per-key duration for free keys (days)
const FREE_KEY_DAYS_MAP = {
  'j4VN2j': 7, 'zT5GDq': 7,
  'pTqFpj': 3, 'sa22IK': 3, 'vU5d0B': 3,
};

// Legacy scalar kept for the self-heal function (uses longest duration as safe default)
const FREE_KEY_DAYS = 7;

// ── Anti-bruteforce state (in-memory, resets on restart) ─────────────────────
//
//  rateLimitMap  : ip → { count, windowStart }
//    - Tracks how many auth attempts an IP made in the current 60-second window.
//    - Resets the window automatically once 60 s have elapsed.
//    - If count > MAX_ATTEMPTS_PER_MIN the connection is rejected immediately.
//
//  lockoutMap    : ip → bannedUntil (ms timestamp)
//    - After LOCKOUT_THRESHOLD total failures the IP is banned for LOCKOUT_MS.
//    - Checked before rate-limit so banned IPs are rejected in one branch.
//
//  failureMap    : ip → total failure count (lifetime, resets on server restart)
//    - Incremented on every wrong key / bad payload.
//    - Used to trigger the lockout once threshold is reached.

const MAX_ATTEMPTS_PER_MIN  = 5;       // requests per 60 s window
const LOCKOUT_THRESHOLD     = 10;      // failures before 1-hour ban
const LOCKOUT_MS            = 60 * 60 * 1000;   // 1 hour
const FAIL_DELAY_MS         = 1000;    // artificial delay per failed attempt

const rateLimitMap = new Map();   // ip → { count, windowStart }
const lockoutMap   = new Map();   // ip → bannedUntil
const failureMap   = new Map();   // ip → failCount

function getIP(ws, req) {
  // Railway sets X-Forwarded-For; fall back to socket remote address
  const fwd = req && req.headers && req.headers['x-forwarded-for'];
  return fwd ? fwd.split(',')[0].trim() : (req && req.socket && req.socket.remoteAddress) || 'unknown';
}

function isLockedOut(ip) {
  const until = lockoutMap.get(ip);
  if (!until) return false;
  if (Date.now() < until) return true;
  lockoutMap.delete(ip);   // ban expired
  failureMap.delete(ip);
  return false;
}

function checkRateLimit(ip) {
  const now    = Date.now();
  const entry  = rateLimitMap.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > 60000) {
    // New window
    entry.count       = 1;
    entry.windowStart = now;
  } else {
    entry.count++;
  }
  rateLimitMap.set(ip, entry);
  return entry.count <= MAX_ATTEMPTS_PER_MIN;
}

function recordFailure(ip) {
  const n = (failureMap.get(ip) || 0) + 1;
  failureMap.set(ip, n);
  if (n >= LOCKOUT_THRESHOLD) {
    lockoutMap.set(ip, Date.now() + LOCKOUT_MS);
    console.log(`LOCKOUT: ${ip} banned for 1 hour after ${n} failures`);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Persistent key store ──────────────────────────────────────────────────────
const STORE_FILE = path.join(__dirname, 'keystore.json');

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE))
      return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch (e) { console.log('Keystore load failed:', e.message); }
  return {};
}

function saveStore(store) {
  try { fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8'); }
  catch (e) { console.log('Keystore save failed:', e.message); }
}

const keyStore = loadStore();
console.log(`Loaded ${Object.keys(keyStore).length} key bindings.`);

// ── Self-heal expiry timestamps on startup ────────────────────────────────────
(function selfHeal() {
  let n = 0;
  for (const [k, v] of Object.entries(keyStore)) {
    if (!v.activatedAt) continue;
    const days = v.free ? (FREE_KEY_DAYS_MAP[k] || FREE_KEY_DAYS) : (KEY_DAYS[k] || 7);
    const correct = computeExpiry(v.activatedAt, days);
    if (v.expiry !== correct) { v.expiry = correct; n++; }
  }
  if (n > 0) { saveStore(keyStore); console.log(`Self-healed ${n} expiry timestamps.`); }
})();

// ── Helpers ───────────────────────────────────────────────────────────────────
function xorEncrypt(data, key) {
  let r = '';
  for (let i = 0; i < data.length; i++)
    r += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return r;
}

function encryptResponse(obj, key) {
  const enc = xorEncrypt(JSON.stringify(obj), key);
  return JSON.stringify({ data: Buffer.from(enc, 'binary').toString('base64') });
}

function computeExpiry(activatedAtMs, days) {
  const d   = new Date(activatedAtMs + days * 86400000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

// ── Server ────────────────────────────────────────────────────────────────────
const ENC_KEY = 'JiM21rNU12eERlNmpqa3FuQks';
const PORT    = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT, clientTracking: true });
console.log('Server running on port ' + PORT);

wss.on('connection', (ws, req) => {
  const ip = getIP(ws, req);
  console.log(`Client connected: ${ip}`);

  ws.on('message', async (msg) => {
    try {
      // ── 1. Lockout check ───────────────────────────────────────────────────
      if (isLockedOut(ip)) {
        const until = new Date(lockoutMap.get(ip)).toUTCString();
        ws.send(encryptResponse({
          status: 'error',
          message: `Too many failed attempts. Try again after ${until}.`
        }, ENC_KEY));
        return;
      }

      // ── 2. Rate-limit check ────────────────────────────────────────────────
      if (!checkRateLimit(ip)) {
        ws.send(encryptResponse({
          status: 'error',
          message: 'Too many requests. Wait 1 minute and try again.'
        }, ENC_KEY));
        return;
      }

      const data = JSON.parse(msg);

      // ── 3. Register handshake ──────────────────────────────────────────────
      if (data.register) {
        ws.send(JSON.stringify({ success: true }));
        return;
      }

      // ── 4. Decrypt payload ─────────────────────────────────────────────────
      const decoded   = Buffer.from(data.data, 'base64').toString('binary');
      const decrypted = xorEncrypt(decoded, ENC_KEY);
      const payload   = JSON.parse(decrypted);

      const key     = payload.license_key;
      const hwid    = payload.hwid;
      const version = payload.version;

      console.log(`Auth attempt — Key: ${key} | IP: ${ip} | HWID: ${hwid}`);

      // ── 5. Basic sanity: key must be exactly 6 chars ───────────────────────
      if (!key || key.length !== 6) {
        await sleep(FAIL_DELAY_MS);
        recordFailure(ip);
        ws.send(encryptResponse({ status: 'error', message: 'Invalid key.' }, ENC_KEY));
        return;
      }

      // ── 6. Version check ───────────────────────────────────────────────────
      if (version !== '1.0') {
        ws.send(encryptResponse({
          status: 'error',
          message: 'Update required. Please get the latest version.'
        }, ENC_KEY));
        return;
      }

      // ── 7. Free key logic ──────────────────────────────────────────────────
      if (FREE_KEYS.includes(key)) {
        if (!keyStore[key]) {
          const activatedAt = Date.now();
          const days        = FREE_KEY_DAYS_MAP[key] || FREE_KEY_DAYS;
          const expiry      = computeExpiry(activatedAt, days);
          keyStore[key]     = { free: true, expiry, activatedAt };
          saveStore(keyStore);
          console.log(`FREE KEY ACTIVATED: ${key} (${days}d) expires ${expiry}`);
        } else {
          const expiry = new Date(keyStore[key].expiry.replace(' UTC','Z').replace(' ','T'));
          if (Date.now() > expiry) {
            await sleep(FAIL_DELAY_MS);
            recordFailure(ip);
            ws.send(encryptResponse({
              status: 'error',
              message: 'Free key expired. Contact @sahand on Telegram.'
            }, ENC_KEY));
            return;
          }
        }
        ws.send(encryptResponse({
          status: 'success',
          data: { expiry_date: keyStore[key].expiry, version: '1.0',
                   auth_token: 'token_free', license_key: key }
        }, ENC_KEY));
        return;
      }

      // ── 8. Normal key logic ────────────────────────────────────────────────
      if (!VALID_KEYS.includes(key)) {
        await sleep(FAIL_DELAY_MS);   // slow down wrong-key guesses
        recordFailure(ip);
        ws.send(encryptResponse({
          status: 'error',
          message: 'Invalid key. Contact @sahand on Telegram.'
        }, ENC_KEY));
        return;
      }

      if (!keyStore[key]) {
        const activatedAt = Date.now();
        const expiry      = computeExpiry(activatedAt, KEY_DAYS[key] || 30);
        keyStore[key]     = { hwid, expiry, activatedAt };
        saveStore(keyStore);
        console.log(`ACTIVATED: ${key} → HWID ${hwid}, expires ${expiry}`);
      } else {
        if (keyStore[key].hwid !== hwid) {
          await sleep(FAIL_DELAY_MS);
          recordFailure(ip);
          ws.send(encryptResponse({
            status: 'error',
            message: 'Key already activated on another device.'
          }, ENC_KEY));
          return;
        }
        const expiry = new Date(keyStore[key].expiry.replace(' UTC','Z').replace(' ','T'));
        if (Date.now() > expiry) {
          await sleep(FAIL_DELAY_MS);
          recordFailure(ip);
          ws.send(encryptResponse({
            status: 'error',
            message: 'Key expired. Contact @sahand on Telegram.'
          }, ENC_KEY));
          return;
        }
        console.log(`RE-LOGIN: ${key} OK`);
      }

      ws.send(encryptResponse({
        status: 'success',
        data: { expiry_date: keyStore[key].expiry, version: '1.0',
                 auth_token: 'token_abc', license_key: key }
      }, ENC_KEY));

    } catch (e) {
      console.log('Server error:', e.message);
    }
  });

  ws.on('close', () => console.log(`Client disconnected: ${ip}`));
});
