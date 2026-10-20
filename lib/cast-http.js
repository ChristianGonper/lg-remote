'use strict';
/*
 * Sirve un archivo subido por HTTP/1.1 con Range, solo por IPv4.
 * La tele (webOS 2, sin IPv6 en el kernel) pide el archivo por la Wi-Fi y salta
 * con "Range: bytes=inicio-fin". Sin Content-Length y sin rangos el reproductor
 * no puede hacer seek.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline, Transform } = require('stream');
const { describeMedia } = require('./cast');

/** La tele no tiene IPv6: nunca enlazamos un socket IPv6. localhost → 127.0.0.1. */
function listenHost(host) {
  const h = String(host || '').trim();
  if (!h || h === '::' || h === '::0' || h.includes(':')) return '0.0.0.0';
  if (h === 'localhost') return '127.0.0.1';
  return h;
}

function isIPv4(addr) {
  return /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(addr || '');
}

/** Elige una IPv4 de la LAN, preferiendo la subred /24 de la tele. Ignora IPv6. */
function pickLanIPv4(interfaces, tvIp) {
  const list = [];
  for (const arr of Object.values(interfaces || {})) {
    for (const i of arr || []) {
      const v4 = i.family === 'IPv4' || i.family === 4;
      if (v4 && !i.internal && isIPv4(i.address)) list.push(i.address);
    }
  }
  if (tvIp && isIPv4(tvIp)) {
    const prefix = tvIp.split('.').slice(0, 3).join('.') + '.';
    const same = list.find((a) => a.startsWith(prefix));
    if (same) return same;
  }
  return list[0] || null;
}

function sanitizeName(name) {
  let base = path.basename(String(name || 'media').replace(/\\/g, '/'));
  try { base = decodeURIComponent(base); } catch (_) { /* se queda como está */ }
  base = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+/, '');
  if (!base || base === '.' || base === '..') base = 'media';
  if (base.length > 80) {
    const ext = path.extname(base).slice(0, 8);
    base = base.slice(0, 80 - ext.length) + ext;
  }
  return base;
}

/**
 * Un solo rango, como lo piden los reproductores.
 * @returns {null | {start:number, end:number} | {unsatisfiable:true} | {ignore:true}}
 *   null = no había Range; ignore = rango múltiple o sintaxis rara (responder 200);
 *   unsatisfiable = 416.
 */
function parseByteRange(header, size) {
  if (header == null || header === '') return null;
  const h = String(header).trim();
  if (!/^bytes=/i.test(h)) return { ignore: true };
  const spec = h.replace(/^bytes=/i, '').trim();
  if (spec.includes(',')) return { ignore: true };
  const m = /^(\d*)-(\d*)$/.exec(spec);
  if (!m || (m[1] === '' && m[2] === '')) return { ignore: true };
  if (!Number.isFinite(size) || size < 0) return { unsatisfiable: true };
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (!suffix) return { unsatisfiable: true };
    if (size === 0) return { unsatisfiable: true };
    const n = Math.min(suffix, size);
    return { start: size - n, end: size - 1 };
  }
  const start = Number(m[1]);
  if (size === 0 || start >= size) return { unsatisfiable: true };
  let end = m[2] === '' ? size - 1 : Number(m[2]);
  if (end < start) return { unsatisfiable: true };
  if (end >= size) end = size - 1;
  return { start, end };
}

function createCastStore({ dir, maxBytes, ttlMs }) {
  fs.mkdirSync(dir, { recursive: true });
  const index = new Map();
  let saving = false;
  const limit = maxBytes > 0 ? maxBytes : 2 * 1024 * 1024 * 1024;
  const ttl = ttlMs > 0 ? ttlMs : 12 * 3600 * 1000;

  function metaPath(token) { return path.join(dir, token, 'meta.json'); }
  function filePath(token, name) { return path.join(dir, token, name); }

  function remember(meta) {
    index.set(meta.token, meta);
  }

  function load() {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      if (!ent.isDirectory() || !/^[a-f0-9]{32}$/.test(ent.name)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath(ent.name), 'utf8'));
        if (!meta || meta.token !== ent.name || !meta.name) continue;
        const file = filePath(meta.token, meta.name);
        if (!fs.existsSync(file)) continue;
        remember(meta);
      } catch (_) { /* directorio a medias */ }
    }
  }
  load();

  function removeToken(token) {
    index.delete(token);
    fs.rmSync(path.join(dir, token), { recursive: true, force: true });
  }

  function sweep(now = Date.now()) {
    for (const meta of [...index.values()]) {
      if (now - meta.created > ttl) removeToken(meta.token);
    }
  }

  function save(readable, { name, mime } = {}) {
    if (saving) {
      const e = new Error('ya se está subiendo otro archivo');
      e.status = 409;
      return Promise.reject(e);
    }
    saving = true;
    const token = crypto.randomBytes(16).toString('hex');
    const safe = sanitizeName(name);
    const described = describeMedia(safe, mime);
    const folder = path.join(dir, token);
    fs.mkdirSync(folder, { recursive: true });
    const dest = filePath(token, safe);
    const ws = fs.createWriteStream(dest);
    let bytes = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > limit) {
          const e = new Error('archivo demasiado grande (máximo ' + limit + ' bytes)');
          e.status = 413;
          e.code = 'LIMIT';
          cb(e);
        } else cb(null, chunk);
      },
    });
    return new Promise((resolve, reject) => {
      pipeline(readable, counter, ws, (err) => {
        saving = false;
        if (err) {
          fs.rmSync(folder, { recursive: true, force: true });
          if (!err.status && err.code === 'LIMIT') err.status = 413;
          reject(err);
          return;
        }
        if (!bytes) {
          fs.rmSync(folder, { recursive: true, force: true });
          reject(Object.assign(new Error('archivo vacío'), { status: 400 }));
          return;
        }
        const meta = { token, name: safe, bytes, mime: described.mime, kind: described.kind, created: Date.now() };
        fs.writeFileSync(metaPath(token), JSON.stringify(meta));
        for (const old of [...index.keys()]) if (old !== token) removeToken(old);
        remember(meta);
        resolve(meta);
      });
    });
  }

  function resolve(pathname) {
    const m = /^\/cast\/([a-f0-9]{32})\/([^/]+)$/.exec(pathname || '');
    if (!m) return null;
    let name;
    try { name = decodeURIComponent(m[2]); } catch (_) { return null; }
    const meta = index.get(m[1]);
    if (!meta || meta.name !== name) return null;
    const root = path.resolve(dir, m[1]) + path.sep;
    const file = path.resolve(filePath(m[1], name));
    if (!file.startsWith(root)) return null;
    return { file, mime: meta.mime || 'application/octet-stream', name: meta.name, bytes: meta.bytes };
  }

  function list() {
    return [...index.values()].map((m) => ({ token: m.token, name: m.name, bytes: m.bytes, mime: m.mime, kind: m.kind, created: m.created }));
  }

  return { save, resolve, list, sweep, removeToken, get saving() { return saving; }, dir, maxBytes: limit };
}

function serveCast(req, res, store) {
  let pathname = req.url || '/';
  const q = pathname.indexOf('?');
  if (q >= 0) pathname = pathname.slice(0, q);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Método no permitido');
    return;
  }
  const found = store.resolve(pathname);
  if (!found) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
    return;
  }
  fs.stat(found.file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }
    const size = st.size;
    const parsed = parseByteRange(req.headers.range, size);
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': found.mime || 'application/octet-stream',
      'Content-Disposition': 'inline; filename="' + found.name.replace(/"/g, '') + '"',
      'Cache-Control': 'no-transform',
    };
    if (parsed && parsed.unsatisfiable) {
      res.writeHead(416, Object.assign({}, headers, { 'Content-Range': 'bytes */' + size }));
      res.end();
      return;
    }
    const range = parsed && parsed.start !== undefined ? parsed : null;
    if (!range) {
      headers['Content-Length'] = size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(found.file);
      res.on('close', () => stream.destroy());
      stream.pipe(res);
      return;
    }
    headers['Content-Length'] = range.end - range.start + 1;
    headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + size;
    res.writeHead(206, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(found.file, { start: range.start, end: range.end });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}

module.exports = {
  listenHost,
  pickLanIPv4,
  sanitizeName,
  parseByteRange,
  createCastStore,
  serveCast,
  isIPv4,
};
