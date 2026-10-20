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
    wolPorts: (env.WOL_PORTS && env.WOL_PORTS.split(',').map(Number)) || file.wolPorts || [9, 7],
  };
  if (!cfg.wolAddresses) cfg.wolAddresses = ['255.255.255.255', wol.subnetBroadcast(cfg.tvIp), cfg.tvIp].filter(Boolean);
  if (!path.isAbsolute(cfg.stateFile)) cfg.stateFile = path.join(DIR, cfg.stateFile);
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
    case 'inputs': {
      const r = await tv.request('tv/getExternalInputList');
      return { devices: (r.devices || []).map((d) => ({ id: d.id, label: d.label || d.id, connected: d.connected, appId: d.appId })) };
    }
    case 'input':
      return tv.request('tv/switchInput', { inputId: String(a.id) });
    case 'apps': {
      const r = await tv.request('com.webos.applicationManager/listLaunchPoints');
      return { apps: (r.launchPoints || []).map((p) => ({ id: p.id, title: p.title })).sort((x, y) => String(x.title).localeCompare(String(y.title))) };
    }
    case 'launch':
      return tv.request('system.launcher/launch', { id: String(a.id) });
    case 'liveTv':
      return tv.request('system.launcher/launch', { id: 'com.webos.app.livetv' });
    case 'text':
      return tv.request('com.webos.service.ime/insertText', { text: String(a.text || ''), replace: 0 });
    case 'enter':
      return tv.request('com.webos.service.ime/sendEnterKey');
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
    default:
      throw new Error('acción desconocida: ' + a.type);
  }
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const PUB = path.join(DIR, 'public');

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/status') return sendJson(res, 200, publicStatus());
  if (url.pathname === '/api/action' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', async () => {
      try {
        const data = await doAction(JSON.parse(body || '{}'));
        sendJson(res, 200, { ok: true, data });
      } catch (e) {
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
      if (msg.id !== undefined) c.send(JSON.stringify({ id: msg.id, ok: false, error: e.message }));
    }
  });
});

server.listen(cfg.port, cfg.host, () => {
  log(`Mando LG en http://127.0.0.1:${cfg.port}  (TV ${cfg.tvIp}, ${tv.url})`);
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  if (cfg.host === '0.0.0.0' && ips.length) log('Desde otro dispositivo de la red:', ips.map((ip) => `http://${ip}:${cfg.port}`).join('  '));
  if (!tvState.clientKey) log('Primera vez: acepta el aviso que aparecerá en la TV.');
  tv.start();
});

function shutdown() { tv.stop(); server.close(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { doAction, cfg };
