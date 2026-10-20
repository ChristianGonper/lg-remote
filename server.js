#!/usr/bin/env node
'use strict';
/*
 * Mando web para TV LG webOS. Arranca:  node server.js
 * Abre en el navegador:  http://127.0.0.1:8765
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const { LGTV } = require('./lib/lgtv');
const wol = require('./lib/wol');
const { createCaster, parseYouTube } = require('./lib/cast');
const castHttp = require('./lib/cast-http');

const DIR = __dirname;

// ---------- Configuración: config.json + variables de entorno ----------
function loadConfig() {
  let file = {};
  const cfgPath = process.env.CONFIG || path.join(DIR, 'config.json');
  if (fs.existsSync(cfgPath)) {
    try { file = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { console.error('config.json inválido:', e.message); }
  }
  const env = process.env;
  const bool = (v) => (v === undefined ? undefined : /^(1|true|yes|si|sí)$/i.test(v));
  const cfg = {
    tvIp: env.TV_IP || file.tvIp || '192.168.1.39',
    tvPort: Number(env.TV_PORT || file.tvPort) || undefined,
    secure: bool(env.TV_SECURE) ?? file.secure ?? false,
    mac: env.TV_MAC || file.mac || '',
    host: env.HOST || file.host || '0.0.0.0',
    port: Number(env.PORT || file.port) || 8765,
    stateFile: env.STATE_FILE || file.stateFile || path.join(DIR, 'tv-state.json'),
    wolAddresses: (env.WOL_ADDRESSES && env.WOL_ADDRESSES.split(',')) || file.wolAddresses || null,
    ytSearch: env.YT_SEARCH || file.ytSearch || '',
    wolPorts: (env.WOL_PORTS && env.WOL_PORTS.split(',').map(Number)) || file.wolPorts || [9, 7],
    castHost: env.CAST_HOST || file.castHost || '',
    castMaxMb: Number(env.CAST_MAX_MB || file.castMaxMb) || 2048,
    castDir: env.CAST_DIR || file.castDir || path.join(os.tmpdir(), 'lg-remote-cast'),
    castTtlHours: Number(env.CAST_TTL_HOURS || file.castTtlHours) || 12,
    castDryRun: bool(env.CAST_DRY_RUN) ?? file.castDryRun ?? false,
  };
  if (!cfg.wolAddresses) cfg.wolAddresses = ['255.255.255.255', wol.subnetBroadcast(cfg.tvIp), cfg.tvIp].filter(Boolean);
  if (!path.isAbsolute(cfg.stateFile)) cfg.stateFile = path.join(DIR, cfg.stateFile);
  if (!path.isAbsolute(cfg.castDir)) cfg.castDir = path.join(DIR, cfg.castDir);
  const bound = castHttp.listenHost(cfg.host);
  if (bound !== cfg.host) {
    console.warn('HOST', cfg.host, 'no sirve: la tele no tiene IPv6. Escuchando en', bound);
    cfg.host = bound;
  }
  if (cfg.castHost && !castHttp.isIPv4(cfg.castHost)) {
    console.warn('castHost ignorado (tiene que ser IPv4):', cfg.castHost);
    cfg.castHost = '';
  }
  return cfg;
}
const cfg = loadConfig();

// ---------- Estado persistente (client-key y MACs) junto al script ----------
function loadState() {
  try { return JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8')); } catch (_) { return {}; }
}
const persisted = loadState();
const tvState = persisted[cfg.tvIp] || (persisted[cfg.tvIp] = {});
function saveState() {
  try {
    fs.writeFileSync(cfg.stateFile + '.tmp', JSON.stringify(persisted, null, 2) + '\n');
    fs.renameSync(cfg.stateFile + '.tmp', cfg.stateFile);
  } catch (e) { console.error('No se pudo guardar', cfg.stateFile, e.message); }
}

// ---------- Cliente TV ----------
const tv = new LGTV({ host: cfg.tvIp, port: cfg.tvPort, secure: cfg.secure, clientKey: tvState.clientKey });
const live = { status: { state: 'disconnected', detail: '' }, volume: null, info: {}, lastWol: null };

tv.on('status', (s) => {
  live.status = s;
  log('estado:', s.state, s.detail || '');
  broadcast({ event: 'status', ...publicStatus() });
});
tv.on('key', (key) => {
  if (key) tvState.clientKey = key; else delete tvState.clientKey;
  saveState();
  log(key ? 'client-key guardada en ' + cfg.stateFile : 'client-key borrada');
});
tv.on('macs', (macs) => {
  tvState.macs = macs;
  saveState();
  log('MAC aprendidas de la TV:', JSON.stringify(macs));
  broadcast({ event: 'status', ...publicStatus() });
});
// Registro de los últimos errores de la TV (respuesta cruda incluida): GET /api/log
const errLog = [];
tv.on('requestError', (e) => {
  const entry = { at: new Date().toISOString(), uri: e.uri, payload: e.payload, error: e.error, raw: e.raw };
  errLog.push(entry);
  if (errLog.length > 50) errLog.shift();
  log('ERROR TV', e.uri, JSON.stringify(e.payload), '->', e.error, e.raw ? JSON.stringify(e.raw) : '');
});
tv.on('volume', (v) => { live.volume = v; broadcast({ event: 'volume', ...v }); });
tv.on('info', (i) => { Object.assign(live.info, i); broadcast({ event: 'status', ...publicStatus() }); });

function macList() {
  if (cfg.mac) return [cfg.mac];
  const m = tvState.macs || {};
  return [m.wifi, m.wired].filter(Boolean);
}

function publicStatus() {
  return {
    state: live.status.state,
    detail: live.status.detail,
    tvIp: cfg.tvIp,
    url: tv.url,
    paired: !!tvState.clientKey,
    macs: macList(),
    macSource: cfg.mac ? 'config' : (macList().length ? 'TV' : 'ninguna'),
    model: live.info.modelName || null,
    firmware: live.info.sw ? live.info.sw.major_ver + '.' + live.info.sw.minor_ver : null,
    volume: live.volume,
    lastWol: live.lastWol,
    castHost: advertiseHost(),
    cast: publicCast(),
  };
}

function log(...a) { console.log(new Date().toLocaleTimeString('es-ES'), ...a); }

// ---------- Acciones ----------
const SSAP = {
  volumeUp: 'audio/volumeUp',
  volumeDown: 'audio/volumeDown',
  channelUp: 'tv/channelUp',
  channelDown: 'tv/channelDown',
  powerOff: 'system/turnOff',
  toast: 'system.notifications/createToast',
};
const MEDIA = { PLAY: 'play', PAUSE: 'pause', STOP: 'stop', REWIND: 'rewind', FASTFORWARD: 'fastForward' };
const BUTTON_RE = /^[A-Z0-9_]{1,24}$/;

// ---------- Entradas, apps y texto con alternativas para webOS 2 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e) => (e && e.message) || String(e);

/** Petición con un reintento si la TV responde 500 (en webOS 2 algunos servicios fallan de forma transitoria). */
async function req(uri, payload) {
  try { return await tv.request(uri, payload); } catch (e) {
    if (e.code !== 500) throw e;
    await sleep(400);
    return tv.request(uri, payload);
  }
}

// Apps que son entradas externas (para deducir la lista de entradas desde listLaunchPoints)
const INPUT_APP_RE = /^com\.webos\.app\.(hdmi\d*|externalinput\..+|livetv)$/;
function inputIdFromAppId(appId) {
  let m = /^com\.webos\.app\.hdmi(\d+)$/.exec(appId);
  if (m) return 'HDMI_' + m[1];
  m = /^com\.webos\.app\.externalinput\.(av|scart|component|comp)(\d*)$/.exec(appId);
  if (m) return ({ av: 'AV', scart: 'SCART', component: 'COMP', comp: 'COMP' })[m[1]] + '_' + (m[2] || '1');
  return '';
}
function appIdFromInputId(id) {
  const m = /^HDMI_?(\d+)$/i.exec(id);
  return m ? 'com.webos.app.hdmi' + m[1] : '';
}
const inputApps = new Map(); // inputId -> appId (de la última lista)

function normalizeLaunchPoints(r) {
  const list = (r && (r.launchPoints || r.apps)) || [];
  return list
    .filter((p) => p && (p.id || p.appId) && p.visible !== false)
    .map((p) => ({ id: String(p.id || p.appId), title: String(p.title || p.id || p.appId) }));
}

async function launchPoints() {
  const errors = [];
  for (const [uri, payload] of [['com.webos.applicationManager/listLaunchPoints', {}], ['com.webos.applicationManager/listApps', {}]]) {
    try {
      const pts = normalizeLaunchPoints(await req(uri, payload));
      if (pts.length) return pts;
      errors.push(uri + ': lista vacía');
    } catch (e) { errors.push(errMsg(e)); }
  }
  throw new Error('no se pudo leer la lista de apps: ' + errors.join(' | '));
}

async function getApps() {
  const apps = await launchPoints();
  return { apps: apps.sort((x, y) => x.title.localeCompare(y.title, 'es')) };
}

async function getInputs() {
  let first;
  try {
    const r = await req('tv/getExternalInputList');
    const devs = (r.devices || r.inputList || r.externalInputList || []).filter((d) => d && (d.id || d.appId));
    if (devs.length) {
      const devices = devs.map((d) => {
        const id = String(d.id || inputIdFromAppId(d.appId) || d.appId);
        const appId = d.appId ? String(d.appId) : appIdFromInputId(id);
        if (appId) inputApps.set(id, appId);
        return { id, label: String(d.label || d.name || id), connected: d.connected, appId };
      });
      return { devices, via: 'getExternalInputList' };
    }
    first = new Error('getExternalInputList devolvió una lista vacía');
  } catch (e) { first = e; }
  // Alternativa: deducir las entradas de las apps HDMI/AV que aparecen en listLaunchPoints
  try {
    const devices = (await launchPoints())
      .filter((p) => INPUT_APP_RE.test(p.id) && p.id !== 'com.webos.app.livetv')
      .map((p) => {
        const id = inputIdFromAppId(p.id) || p.id;
        inputApps.set(id, p.id);
        return { id, label: p.title, appId: p.id };
      });
    if (devices.length) return { devices, via: 'listLaunchPoints', warning: errMsg(first) };
  } catch (e) { throw new Error(errMsg(first) + ' | ' + errMsg(e)); }
  throw first;
}

async function switchInput(id, appId) {
  if (!id && !appId) throw new Error('falta la entrada');
  appId = appId || inputApps.get(id) || appIdFromInputId(id) || (/^com\./.test(id) ? id : '');
  let first;
  if (id && !/^com\./.test(id)) {
    try { return { via: 'switchInput', ...(await req('tv/switchInput', { inputId: id })) }; } catch (e) { first = e; }
  }
  // Alternativa (fiable en webOS 2): abrir la app de la entrada, p. ej. com.webos.app.hdmi1
  if (appId) {
    try { return { via: 'launch', appId, ...(await launchApp(appId)) }; } catch (e) {
      throw new Error((first ? errMsg(first) + ' | ' : '') + errMsg(e));
    }
  }
  throw first || new Error('entrada desconocida: ' + id);
}

async function launchApp(id, params) {
  if (!id) throw new Error('falta el id de la app');
  const payload = params ? { id, params } : { id };
  try { return await req('system.launcher/launch', payload); } catch (e) {
    try { return await tv.request('com.webos.applicationManager/launch', payload); } catch (_) { throw e; }
  }
}

async function foregroundApp() {
  try {
    const r = await tv.request('com.webos.applicationManager/getForegroundAppInfo');
    return r.appId || null;
  } catch (_) { return null; }
}
const isYouTube = (appId) => /^youtube\./i.test(appId || '');

/**
 * YouTube en webOS 2 (app antigua youtube.leanback.v4) usa su propio teclado en pantalla, no el IME
 * del sistema: com.webos.service.ime/insertText responde OK pero no escribe nada. Lo que sí acepta
 * es (re)lanzarla con params.contentTarget. Formatos (según fuentes, ver README):
 *   q    -> "q=<texto>"                                   (inAppSearchParams de la app Cobalt moderna)
 *   url  -> "https://www.youtube.com/tv?launch=search&q=<texto>"  (app web antigua: contentTarget = URL completa)
 *   hash -> "https://www.youtube.com/tv#/search?q=<texto>"
 *   auto -> se deduce de deeplinkingParams / inAppSearchParams que la propia TV da en listApps.
 * Se puede forzar con cfg.ytSearch / YT_SEARCH (q|url|hash o una plantilla con {q}).
 */
const YT_ID = 'youtube.leanback.v4';
const YT_TEMPLATES = {
  q: { key: 'contentTarget', tpl: 'q={q}' },
  url: { key: 'contentTarget', tpl: 'https://www.youtube.com/tv?launch=search&q={q}' },
  hash: { key: 'contentTarget', tpl: 'https://www.youtube.com/tv#/search?q={q}' },
};
let ytInfoCache = null;
async function youtubeAppInfo() {
  if (ytInfoCache) return ytInfoCache;
  const r = await req('com.webos.applicationManager/listApps');
  const app = (r.apps || []).find((x) => isYouTube(x.id));
  if (!app) throw new Error('YouTube no aparece en listApps');
  const parse = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (_) { return null; } };
  ytInfoCache = { id: app.id, version: app.version, type: app.type, main: app.main,
    deeplinkingParams: parse(app.deeplinkingParams), inAppSearchParams: parse(app.inAppSearchParams) };
  return ytInfoCache;
}
async function youtubeTemplate(variant) {
  const v = variant && variant !== 'auto' ? variant : (cfg.ytSearch || 'auto');
  if (YT_TEMPLATES[v]) return { ...YT_TEMPLATES[v], variant: v };
  if (v.includes('{q}')) return { key: 'contentTarget', tpl: v, variant: 'custom' };
  // auto
  try {
    const info = await youtubeAppInfo();
    const isp = info.inAppSearchParams;
    if (isp) {
      const key = Object.keys(isp).find((k) => typeof isp[k] === 'string' && isp[k].includes('$SEARCH_KEYWORD'));
      if (key) return { key, tpl: isp[key].replace('$SEARCH_KEYWORD', '{q}'), variant: 'auto:inAppSearchParams' };
    }
    const dl = info.deeplinkingParams && info.deeplinkingParams.contentTarget;
    if (typeof dl === 'string' && /^https?:/.test(dl)) return { ...YT_TEMPLATES.url, variant: 'auto:url' };
    return { ...YT_TEMPLATES.q, variant: 'auto:q' };
  } catch (_) {
    // En webOS 2 la app es la web antigua: lo más probable es que espere la URL completa
    return { ...YT_TEMPLATES.url, variant: 'auto:url (sin info de la app)' };
  }
}
async function youtubeSearch(text, fg, variant) {
  const id = isYouTube(fg) ? fg : YT_ID;
  const t = await youtubeTemplate(variant);
  const target = t.tpl.replace('{q}', encodeURIComponent(text));
  await launchApp(id, { [t.key]: target });
  log('búsqueda YouTube', t.variant, t.key + '=' + target);
  return { via: 'youtube', appId: id, variant: t.variant, [t.key]: target };
}

async function doAction(a) {
  switch (a.type) {
    case 'button':
      if (!BUTTON_RE.test(a.name || '')) throw new Error('nombre de tecla inválido');
      await tv.button(a.name);
      return { sent: a.name };
    case 'ssap': {
      const uri = SSAP[a.cmd];
      if (!uri) throw new Error('comando desconocido: ' + a.cmd);
      return tv.request(uri, a.cmd === 'toast' ? { message: String(a.message || 'Mando web conectado') } : {});
    }
    case 'media': {
      // Primero la API media.controls; si falla, la tecla equivalente por el pointer socket.
      const name = String(a.name || '').toUpperCase();
      if (!MEDIA[name]) throw new Error('tecla multimedia desconocida');
      try { return await tv.request('media.controls/' + MEDIA[name]); } catch (_) { await tv.button(name); return { sent: name, via: 'pointer' }; }
    }
    case 'mute': {
      let muted = live.volume && live.volume.muted;
      if (muted === undefined || muted === null) {
        try { muted = (await tv.request('audio/getStatus')).mute; } catch (_) { /* nada */ }
      }
      try {
        await tv.request('audio/setMute', { mute: !muted });
        return { muted: !muted };
      } catch (_) {
        await tv.button('MUTE');
        return { sent: 'MUTE', via: 'pointer' };
      }
    }
    case 'powerOn': {
      const macs = macList();
      const r = await wol.wake(macs, { addresses: cfg.wolAddresses, ports: cfg.wolPorts });
      live.lastWol = { at: Date.now(), macs, ...r };
      log('Wake-on-LAN enviado a', macs.join(', '), '->', cfg.wolAddresses.join(', '), r.errors.length ? r.errors : '');
      // Intentar reconectar enseguida varias veces mientras la TV arranca
      [1500, 4000, 8000].forEach((t) => setTimeout(() => tv.reconnectNow(), t));
      return live.lastWol;
    }
    case 'screenOff':
      // webOS < 4 usa com.webos.service.tv.power; webOS >= 4 com.webos.service.tvpower/power
      try { return await tv.request('com.webos.service.tv.power/turnOffScreen'); } catch (_) { return tv.request('com.webos.service.tvpower/power/turnOffScreen'); }
    case 'screenOn':
      try { return await tv.request('com.webos.service.tv.power/turnOnScreen'); } catch (_) { return tv.request('com.webos.service.tvpower/power/turnOnScreen'); }
    case 'inputs':
      return getInputs();
    case 'input':
      return switchInput(String(a.id || ''), a.appId ? String(a.appId) : '');
    case 'apps':
      return getApps();
    case 'launch':
      return launchApp(String(a.id || ''));
    case 'liveTv':
      return launchApp('com.webos.app.livetv');
    case 'ytInfo': // diagnóstico de solo lectura: cómo declara la app de YouTube sus deep links
      ytInfoCache = null;
      return youtubeAppInfo();
    case 'foreground':
      return { appId: await foregroundApp() };
    case 'text': {
      const text = String(a.text || '');
      if (!text) throw new Error('texto vacío');
      // a.mode: 'auto' (por defecto) | 'ime' | 'youtube'
      const mode = a.mode || 'auto';
      const fg = mode === 'ime' ? null : await foregroundApp();
      if (mode === 'youtube' || (mode === 'auto' && isYouTube(fg))) return youtubeSearch(text, fg, a.variant);
      await tv.request('com.webos.service.ime/insertText', { text, replace: 0 });
      return { via: 'ime', foreground: fg };
    }
    case 'enter': {
      // En YouTube (teclado propio de la app) sendEnterKey no hace nada: se pulsa OK por el pointer socket.
      const fg = await foregroundApp();
      if (isYouTube(fg)) { await tv.button('ENTER'); return { via: 'pointer', foreground: fg }; }
      try { return { via: 'ime', ...(await tv.request('com.webos.service.ime/sendEnterKey')) }; } catch (_) { await tv.button('ENTER'); return { via: 'pointer' }; }
    }
    case 'delete':
      return tv.request('com.webos.service.ime/deleteCharacters', { count: Math.max(1, Math.min(200, Number(a.count) || 1)) });
    case 'move':
      await tv.move(Number(a.dx) || 0, Number(a.dy) || 0, a.down);
      return {};
    case 'click':
      await tv.click();
      return {};
    case 'scroll':
      await tv.scroll(Number(a.dx) || 0, Number(a.dy) || 0);
      return {};
    case 'reconnect':
      tv.reconnectNow();
      return {};
    case 'status':
      return publicStatus();
    case 'cast':
      return castMedia(a);
    case 'castControl':
      return castControl(a);
    default:
      throw new Error('acción desconocida: ' + a.type);
  }
}

// ---------- Envío de medios (cast) por la LAN, solo IPv4 ----------
const castState = { current: null };
const castStore = castHttp.createCastStore({
  dir: cfg.castDir,
  maxBytes: cfg.castMaxMb * 1024 * 1024,
  ttlMs: cfg.castTtlHours * 3600 * 1000,
});
castStore.sweep();
const castSweep = setInterval(() => castStore.sweep(), 30 * 60 * 1000);
castSweep.unref();

let hostCache = { at: 0, ip: '' };
function advertiseHost() {
  if (cfg.castHost) return cfg.castHost;
  if (cfg.host !== '0.0.0.0' && castHttp.isIPv4(cfg.host)) return cfg.host;
  const now = Date.now();
  if (now - hostCache.at < 5000 && hostCache.ip) return hostCache.ip;
  const ip = castHttp.pickLanIPv4(os.networkInterfaces(), cfg.tvIp) || '127.0.0.1';
  hostCache = { at: now, ip };
  return ip;
}
function castFileUrl(meta) {
  return 'http://' + advertiseHost() + ':' + cfg.port + '/cast/' + meta.token + '/' + encodeURIComponent(meta.name);
}
function publicCast() {
  const c = castState.current;
  if (!c) return null;
  return { url: c.url, title: c.title, via: c.via, viaLabel: c.viaLabel, kind: c.kind, appId: c.appId, at: c.at, stopped: !!c.stopped };
}

const caster = createCaster({
  request: (uri, payload) => req(uri, payload),
  launch: (id, params) => launchApp(id, params),
  button: (name) => tv.button(name),
  log,
});

async function castMedia(a) {
  const dry = !!(a.dryRun || cfg.castDryRun);
  let youtubeTemplate = null;
  let youtubeAppId = null;
  if (!dry && parseYouTube(String(a.url || ''))) {
    try {
      const info = await youtubeAppInfo();
      const dl = info.deeplinkingParams && info.deeplinkingParams.contentTarget;
      if (typeof dl === 'string' && dl.includes('$CONTENTID')) youtubeTemplate = dl;
      if (info.id) youtubeAppId = info.id;
    } catch (_) { /* se usa la plantilla de la app web antigua */ }
  }
  const out = await caster.cast({
    url: a.url, title: a.title, mime: a.mime, bytes: a.bytes,
    method: a.method || 'auto', variant: a.variant || 'auto',
    dryRun: dry, advertiseHost: advertiseHost(), youtubeTemplate, youtubeAppId,
  });
  if (!dry) {
    castState.current = Object.assign({ at: Date.now(), stopped: false }, out);
    broadcast({ event: 'status', ...publicStatus() });
  }
  return out;
}

async function castControl(a) {
  const out = await caster.control({
    cmd: a.cmd,
    seconds: a.seconds != null ? a.seconds : a.position,
    session: castState.current,
  });
  if (String(a.cmd || '').toLowerCase() === 'stop' && castState.current) {
    castState.current.stopped = true;
    broadcast({ event: 'status', ...publicStatus() });
  }
  return out;
}

function castUpload(req, res) {
  const u = new URL(req.url, 'http://x');
  const name = u.searchParams.get('name') || req.headers['x-filename'] || 'media.bin';
  if (/multipart\/form-data/i.test(req.headers['content-type'] || '')) {
    req.resume();
    return sendJson(res, 400, { ok: false, error: 'Sube el archivo en bruto (el botón de la página ya lo hace).' });
  }
  const len = Number(req.headers['content-length']);
  if (Number.isFinite(len) && len > castStore.maxBytes) {
    req.resume();
    return sendJson(res, 413, { ok: false, error: 'archivo demasiado grande (máximo ' + castStore.maxBytes + ' bytes)' });
  }
  castStore.save(req, { name, mime: req.headers['content-type'] }).then((meta) => {
    log('archivo para la tele', meta.name, meta.bytes, 'bytes →', castFileUrl(meta));
    sendJson(res, 200, { ok: true, data: Object.assign({}, meta, { url: castFileUrl(meta) }) });
  }).catch((e) => {
    log('subida fallida', e.message);
    sendJson(res, e.status || 400, { ok: false, error: e.message });
  });
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const PUB = path.join(DIR, 'public');

function sendJson(res, code, obj) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/status') return sendJson(res, 200, publicStatus());
  if (url.pathname === '/api/log') return sendJson(res, 200, { errors: errLog });
  if (url.pathname === '/api/cast' && req.method === 'GET') {
    return sendJson(res, 200, {
      host: advertiseHost(),
      maxBytes: castStore.maxBytes,
      cast: publicCast(),
      files: castStore.list().map((f) => Object.assign({}, f, { url: castFileUrl(f) })),
    });
  }
  if (url.pathname === '/api/cast/upload' && (req.method === 'PUT' || req.method === 'POST')) return castUpload(req, res);
  if ((req.url || '').split('?')[0].startsWith('/cast/')) return castHttp.serveCast(req, res, castStore);
  if (url.pathname === '/api/action' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', async () => {
      try {
        const data = await doAction(JSON.parse(body || '{}'));
        sendJson(res, 200, { ok: true, data });
      } catch (e) {
        log('acción fallida', body.slice(0, 200), '->', e.message);
        sendJson(res, 200, { ok: false, error: e.message });
      }
    });
    return;
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

// WebSocket navegador <-> servidor (baja latencia para touchpad y estado en vivo)
const wss = new WebSocket.Server({ server, path: '/ws' });
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s);
}
wss.on('connection', (c) => {
  c.send(JSON.stringify({ event: 'status', ...publicStatus() }));
  c.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    try {
      const data = await doAction(msg);
      if (msg.id !== undefined) c.send(JSON.stringify({ id: msg.id, ok: true, data }));
    } catch (e) {
      if (msg.type !== 'move' && msg.type !== 'scroll') log('acción fallida', msg.type, '->', e.message);
      if (msg.id !== undefined) c.send(JSON.stringify({ id: msg.id, ok: false, error: e.message }));
    }
  });
});

server.listen(cfg.port, cfg.host, () => {
  log(`Mando LG en http://127.0.0.1:${cfg.port}  (TV ${cfg.tvIp}, ${tv.url})`);
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  if (cfg.host === '0.0.0.0' && ips.length) log('Desde otro dispositivo de la red:', ips.map((ip) => `http://${ip}:${cfg.port}`).join('  '));
  log('Archivos para la tele (IPv4): http://' + advertiseHost() + ':' + cfg.port + '/cast/');
  if (cfg.castDryRun) log('CAST_DRY_RUN: los envíos no se mandan a la tele');
  if (!tvState.clientKey) log('Primera vez: acepta el aviso que aparecerá en la TV.');
  tv.start();
});

function shutdown() { clearInterval(castSweep); tv.stop(); server.close(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { doAction, cfg };
