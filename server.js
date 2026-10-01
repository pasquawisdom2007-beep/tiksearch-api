'use strict';
const express = require('express');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
puppeteer.use(Stealth());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';          // set this on Render
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
const CACHE_TTL = 10 * 60 * 1000;
const MAX_MB = 60;

const app = express();
const cache = new Map();                            // q -> {ts, results}
let browserP = null;
let busy = 0;

// ── keys + site ─────────────────────────────────────────────────────────
const crypto = require('crypto');
const path = require('path');
const SECRET = process.env.SECRET || crypto.randomBytes(16).toString('hex');
app.set('trust proxy', 1);
const sig = id => crypto.createHmac('sha256', SECRET).update(id).digest('hex').slice(0, 16);
const mkKey = () => { const id = crypto.randomBytes(8).toString('hex'); return `pasqua_${id}_${sig(id)}`; };
function validKey(k) {
  if (API_KEY && k === API_KEY) return 'master';
  const m = /^pasqua_([0-9a-f]{16})_([0-9a-f]{16})$/.exec(k || '');
  return m && m[2] === sig(m[1]) ? 'user' : false;
}
const hits = new Map();
const limit = (k, max, ms) => { const n = Date.now(); let h = hits.get(k); if (!h || n > h.r) h = { c: 0, r: n + ms }; h.c++; hits.set(k, h); return h.c <= max; };
const page = f => (req, res) => res.sendFile(path.join(__dirname, f));
app.get('/', page('index.html'));
app.get('/finder', page('finder.html'));
app.get('/keys', page('keys.html'));
app.get('/style.css', page('style.css'));
app.get('/app.js', page('app.js'));
app.post('/keygen', (req, res) => {
  if (process.env.KEYGEN_OPEN === 'false') return res.status(403).json({ status: false, error: 'key generation closed' });
  if (!limit('kg' + req.ip, 5, 3600000)) return res.status(429).json({ status: false, error: 'too many keys, try later' });
  res.json({ status: true, key: mkKey() });
});
app.use(['/search', '/download', '/video'], (req, res, next) => {
  const k = req.get('x-api-key') || req.query.apikey;
  const t = validKey(k);
  if (!t) return res.status(401).json({ status: false, error: 'invalid api key' });
  if (t === 'user' && !limit('k' + k, 40, 60000)) return res.status(429).json({ status: false, error: 'rate limit: 40 per minute' });
  next();
});

// ── browser (one shared instance) ───────────────────────────────────────
function getBrowser() {
  if (!browserP) {
    browserP = puppeteer.launch({
      headless: 'new',
      executablePath: CHROME,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    }).catch(e => { browserP = null; throw e; });
  }
  return browserP;
}

// ── search ──────────────────────────────────────────────────────────────
function shape(it) {
  const a = it.author || {};
  const s = it.stats || {};
  if (!it.id || !a.uniqueId) return null;
  return {
    id: it.id,
    title: String(it.desc || 'TikTok Video').slice(0, 120),
    author: a.nickname || a.uniqueId,
    username: a.uniqueId,
    duration: Number(it.video?.duration || 0),
    plays: Number(s.playCount || 0),
    likes: Number(s.diggCount || 0),
    cover: it.video?.cover || null,
    url: `https://www.tiktok.com/@${a.uniqueId}/video/${it.id}`,
  };
}

async function browserSearch(q) {
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.results;

  if (busy >= 2) throw new Error('busy, try again in a few seconds');
  busy++;
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const wait = page.waitForResponse(
      r => r.url().includes('/api/search/general/full/') || r.url().includes('/api/search/item/full/'),
      { timeout: 12000 }
    );
    await page.goto(`https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}`,
      { waitUntil: 'domcontentloaded', timeout: 12000 });
    const json = await (await wait).json();
    const results = (json.data || json.item_list || [])
      .map(x => shape(x.item || x))
      .filter(Boolean);
    if (results.length) cache.set(key, { ts: Date.now(), results });
    return results;
  } finally {
    busy--;
    if (page) await page.close().catch(() => {});
  }
}

// ── fallback: tikwm (used when the browser search is blocked) ───────────
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' };
const abs = u => (u && u.startsWith('/') ? 'https://www.tikwm.com' + u : u);
async function tikwm(p) {
  const r = await fetch('https://www.tikwm.com/api/' + p, { headers: UA, signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.msg || 'tikwm error');
  return j.data;
}
async function tikwmSearch(q) {
  const d = await tikwm('feed/search?count=12&keywords=' + encodeURIComponent(q));
  return (d.videos || []).map(v => ({
    id: String(v.video_id), title: String(v.title || 'TikTok Video').slice(0, 120),
    author: v.author?.nickname || v.author?.unique_id || 'Unknown', username: v.author?.unique_id || '',
    duration: v.duration || 0, plays: v.play_count || 0, likes: v.digg_count || 0, cover: abs(v.cover) || null,
    url: `https://www.tiktok.com/@${v.author?.unique_id}/video/${v.video_id}`, direct: abs(v.play) || null,
  }));
}
let bFail = 0, bSkip = 0;
async function search(q) {
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.results;
  let results = [];
  if (Date.now() > bSkip) {
    try { results = await browserSearch(q); bFail = 0; }
    catch (e) { console.error('[browser]', e.message); if (++bFail >= 2) { bFail = 0; bSkip = Date.now() + 600000; } }
  }
  if (!results.length) {
    try { results = await tikwmSearch(q); } catch (e) { console.error('[tikwm]', e.message); }
  }
  if (results.length) cache.set(key, { ts: Date.now(), results });
  return results;
}

// ── download via yt-dlp ─────────────────────────────────────────────────
const TT_URL = /^https:\/\/(www\.|vm\.|vt\.|m\.)?tiktok\.com\//i;

function download(url) {
  return new Promise((resolve, reject) => {
    if (!TT_URL.test(url)) return reject(new Error('not a tiktok url'));
    const p = spawn('yt-dlp', ['-f', 'mp4/best', '--no-playlist', '--no-warnings', '-o', '-', url]);
    const chunks = []; let size = 0; let err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout')); }, 60000);
    p.stdout.on('data', d => {
      size += d.length;
      if (size > MAX_MB * 1024 * 1024) { p.kill('SIGKILL'); return reject(new Error('too large')); }
      chunks.push(d);
    });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && size > 10 * 1024) resolve(Buffer.concat(chunks));
      else reject(new Error(err.split('\n').filter(Boolean).pop() || `yt-dlp exit ${code}`));
    });
    p.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

async function fetchMp4(u) {
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(60000) });
  const b = Buffer.from(await r.arrayBuffer());
  if (!r.ok || b.length < 10240 || b.length > MAX_MB * 1048576) throw new Error('direct download failed');
  return b;
}
async function downloadAny(r) {
  if (!TT_URL.test(r.url)) throw new Error('not a tiktok url');
  if (r.direct) { try { return await fetchMp4(r.direct); } catch (e) { console.error('[direct]', e.message); } }
  try { return await download(r.url); } catch (e) { console.error('[yt-dlp]', e.message); }
  const d = await tikwm('?url=' + encodeURIComponent(r.url));
  if (!d.play) throw new Error('no direct link');
  return fetchMp4(abs(d.play));
}

// ── routes ──────────────────────────────────────────────────────────────
// GET /search?q=ronaldo edit        -> JSON list
app.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (!q) return res.status(400).json({ status: false, error: 'q required' });
  try {
    const results = await search(q);
    if (!results.length) return res.status(502).json({ status: false, error: 'no results (search blocked or empty)' });
    res.json({ status: true, count: results.length, results });
  } catch (e) { res.status(502).json({ status: false, error: e.message }); }
});

// GET /download?url=<tiktok video url>  -> mp4
app.get('/download', async (req, res) => {
  try {
    const buf = await downloadAny({ url: String(req.query.url || '') });
    res.set('Content-Type', 'video/mp4').send(buf);
  } catch (e) { res.status(502).json({ status: false, error: e.message }); }
});

// GET /video?q=ronaldo edit  -> mp4 of first result that downloads (what the bot uses)
app.get('/video', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (!q) return res.status(400).json({ status: false, error: 'q required' });
  try {
    const results = await search(q);
    if (!results.length) return res.status(404).json({ status: false, error: 'no results' });
    for (const r of results.slice(0, 5)) {
      try {
        const buf = await downloadAny(r);
        res.set({
          'Content-Type': 'video/mp4',
          'X-Title': encodeURIComponent(r.title),
          'X-Author': encodeURIComponent(r.author),
          'X-Duration': r.duration, 'X-Plays': r.plays, 'X-Likes': r.likes,
          'Access-Control-Expose-Headers': 'X-Title,X-Author,X-Duration,X-Plays,X-Likes',
        });
        return res.send(buf);
      } catch (_) { /* try next */ }
    }
    res.status(502).json({ status: false, error: 'all downloads failed' });
  } catch (e) { res.status(502).json({ status: false, error: e.message }); }
});

app.listen(PORT, () => console.log(`tiksearch-api on :${PORT}`));
