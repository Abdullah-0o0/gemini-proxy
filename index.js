// index.js — Secure Gemini reverse proxy
// Node >= 18 required (uses built-in fetch)

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ─── The API key lives ONLY here, server-side ──────────────────────────────
// It is never forwarded to the client or logged anywhere.
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;
const PROXY_SECRET    = process.env.PROXY_SECRET;    // your own shared secret
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const TIMEOUT_MS      = 30_000;

if (!GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY in environment. Aborting.');
  process.exit(1);
}

// ─── 1. Security headers (XSS, no-sniff, frameguard, etc.) ────────────────
app.use(helmet());

// ─── 2. CORS — restrict to your known frontends in production ─────────────
//
//   In development, allowedOrigins can be ['*'], but in production
//   you MUST list your actual domains. Wildcards defeat CORS entirely.
//
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',');

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server calls (no origin header) and listed origins
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} is not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-proxy-secret'],
}));

// ─── 3. JSON body parser ──────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ─── 4. Rate limiter — critical when behind Ngrok (public URL) ────────────
//
//   Without this, anyone who discovers your Ngrok URL can exhaust
//   your Gemini quota in minutes.
//
app.use('/v1', rateLimit({
  windowMs: 60 * 1000,   // 1 minute window
  max: 60,               // 60 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Please slow down.' },
}));

// ─── 5. Optional proxy-level auth ─────────────────────────────────────────
//
//   Your frontend sends an agreed-upon secret header.
//   This prevents random internet traffic via Ngrok from hitting your proxy.
//   Generate with: openssl rand -hex 32
//
function requireProxySecret(req, res, next) {
  if (!PROXY_SECRET) return next(); // skip if not configured (dev mode)
  if (req.headers['x-proxy-secret'] !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorised: invalid proxy secret.' });
  }
  next();
}

// ─── Hop-by-hop headers that must never be forwarded ──────────────────────
const HOP_BY_HOP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade',
]);

// ─── Health check (no auth required) ──────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Main proxy route ──────────────────────────────────────────────────────
app.all('/v1/*', requireProxySecret, async (req, res) => {

  // FIX: req.url preserves query strings (?key=val). req.path strips them.
  const targetUrl = `${GEMINI_BASE_URL}${req.url}`;

  // Strip hop-by-hop headers, then inject the real API key.
  // The client never sees or touches the key — it only knows the proxy secret.
  const headers = Object.fromEntries(
    Object.entries(req.headers)
      .filter(([k]) => !HOP_BY_HOP.has(k.toLowerCase()))
  );
  headers['x-goog-api-key'] = GEMINI_API_KEY; // Gemini's preferred key header
  delete headers['x-proxy-secret'];            // don't forward our internal secret
  delete headers['content-length'];            // Yeh line add karni hai

  // Only send a body on methods that support one
  const bodyMethods = new Set(['POST', 'PUT', 'PATCH']);
  const body = bodyMethods.has(req.method) && Object.keys(req.body || {}).length > 0
    ? JSON.stringify(req.body)
    : undefined;

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(targetUrl, {
      method:  req.method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    const data        = await upstream.text();

    res.status(upstream.status).set('Content-Type', contentType).send(data);

  } catch (err) {
    clearTimeout(timer);

    if (err.name === 'AbortError') {
      return res.status(504).json({
        error: 'Gateway Timeout',
        message: `Upstream did not respond within ${TIMEOUT_MS / 1000}s.`,
      });
    }

    console.error('[Proxy] Upstream fetch failed:', err.message);
    res.status(502).json({
      error: 'Bad Gateway',
      message: 'Could not reach the Gemini API.',
    });
  }
});

// ─── 404 catch-all ────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

app.listen(PORT, () => {
  console.log(`Gemini proxy running → http://localhost:${PORT}`);
  console.log(`Forwarding /v1/* → ${GEMINI_BASE_URL}`);
});
