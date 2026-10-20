'use strict';
/*
 * Cliente SSAP mínimo para televisores LG webOS (probado contra mock; pensado para webOS 2.0).
 * Dependencia única: `ws`.
 *
 * Eventos: 'status' ({state, detail}), 'key' (clientKey), 'macs' ({wired, wifi}),
 *          'volume' ({volume, muted}), 'info' (objeto con datos del sistema).
 * Estados: 'disconnected' | 'connecting' | 'prompt' | 'connected'
 */
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const pairingTemplate = require('./pairing.json');

function signedPairing() {
  return JSON.parse(JSON.stringify(pairingTemplate));
}
// Igual que lgtv2: si la TV rechaza la firma ("blacklisted certificate"), se reintenta sin firma.
function unsignedPairing() {
  const p = signedPairing();
  delete p.manifest.signed;
  delete p.manifest.signatures;
  p.manifest.appVersion = '1.0';
  p.manifest.permissions.push('CONTROL_INPUT_TEXT', 'CONTROL_MOUSE_AND_KEYBOARD');
  return p;
}

/**
 * Construye un Error legible a partir de la respuesta de error de la TV.
 * webOS responde de dos formas: {type:'error', error:'500 Application error', payload:{...}}
 * o {type:'response', payload:{returnValue:false, errorCode, errorText}}.
 * Se conserva la respuesta cruda en e.raw para poder registrarla.
 */
function tvError(uri, msg) {
  const pl = msg.payload || {};
  const parts = [];
  if (msg.error) parts.push(String(msg.error));
  if (pl.errorText && !parts.includes(String(pl.errorText))) parts.push(String(pl.errorText));
  if (pl.errorCode !== undefined && !parts.length) parts.push('código ' + pl.errorCode);
  const short = String(uri).replace(/^ssap:\/\//, '');
  const e = new Error((parts.join(' · ') || 'error') + ' (' + short + ')');
  e.uri = short;
  e.tvError = parts.join(' · ') || 'error';
  e.code = /^(\d{3})\b/.test(String(msg.error || '')) ? Number(RegExp.$1) : (pl.errorCode !== undefined ? pl.errorCode : undefined);
  e.raw = msg;
  return e;
}

class LGTV extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.host          IP de la TV
   * @param {number} [o.port]        3000 (ws) o 3001 (wss)
   * @param {boolean} [o.secure]     usar wss://
   * @param {string} [o.clientKey]   client-key guardada
   * @param {number} [o.timeout]     ms para conectar/responder
   */
  constructor(o) {
    super();
    this.host = o.host;
    this.secure = !!o.secure;
    this.port = o.port || (this.secure ? 3001 : 3000);
    this.clientKey = o.clientKey || null;
    this.timeout = o.timeout || 6000;
    this.state = 'disconnected';
    this.detail = '';
    this.ws = null;
    this.pointer = null;          // WebSocket del pointer input socket
    this.pointerConnecting = null; // Promise en curso
    this.pending = new Map();     // id -> {resolve, reject, timer, keep}
    this.subs = new Map();        // id -> callback
    this.nextId = 1;
    this.stopped = true;
    this.backoff = 2000;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.triedUnsigned = false;
  }

  get url() {
    return `${this.secure ? 'wss' : 'ws'}://${this.host}:${this.port}`;
  }

  setStatus(state, detail = '') {
    if (state === this.state && detail === this.detail) return;
    this.state = state;
    this.detail = detail;
    this.emit('status', { state, detail });
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.cleanup();
    this.setStatus('disconnected', 'detenido');
  }

  /** Fuerza reconectar ya (p. ej. tras Wake-on-LAN). */
  reconnectNow() {
    if (this.stopped) return;
    if (this.state === 'connected' || this.state === 'prompt') return;
    clearTimeout(this.reconnectTimer);
    this.backoff = 2000;
    this.cleanup();
    this.connect();
  }

  cleanup() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('conexión cerrada'));
    }
    this.pending.clear();
    this.subs.clear();
    if (this.pointer) {
      try { this.pointer.terminate(); } catch (_) { /* nada */ }
      this.pointer = null;
    }
    this.pointerConnecting = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.removeAllListeners();
      ws.on('error', () => {});
      try { ws.terminate(); } catch (_) { /* nada */ }
    }
  }

  scheduleReconnect(reason) {
    this.cleanup();
    if (this.stopped) return;
    this.setStatus('disconnected', reason || '');
    clearTimeout(this.reconnectTimer);
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 1.5, 15000);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  connect() {
    if (this.stopped) return;
    this.cleanup();
    this.setStatus('connecting', this.url);
    const ws = new WebSocket(this.url, {
      handshakeTimeout: this.timeout,
      rejectUnauthorized: false, // la TV usa certificado autofirmado en 3001
      perMessageDeflate: false,
    });
    this.ws = ws;
    let alive = true;

    ws.on('open', () => {
      this.backoff = 2000;
      // keepalive: si la TV deja de responder a ping (se apagó sin cerrar el socket), reconectar
      this.pingTimer = setInterval(() => {
        if (!alive) return this.scheduleReconnect('sin respuesta (TV apagada?)');
        alive = false;
        try { ws.ping(); } catch (_) { /* nada */ }
      }, 10000);
      this.register(this.triedUnsigned ? unsignedPairing() : signedPairing());
    });
    ws.on('pong', () => { alive = true; });
    ws.on('message', (data) => { alive = true; this.onMessage(data); });
    ws.on('error', (err) => {
      if (this.ws === ws) this.scheduleReconnect(err.code || err.message);
    });
    ws.on('close', () => {
      if (this.ws === ws) this.scheduleReconnect('conexión cerrada');
    });
  }

  rawSend(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('no conectado a la TV');
    this.ws.send(JSON.stringify(obj));
  }

  register(pairing) {
    if (this.clientKey) pairing['client-key'] = this.clientKey;
    const id = 'register_' + this.nextId++;
    this.pending.set(id, {
      keep: true,
      timer: null,
      resolve: () => {},
      reject: () => {},
      onMsg: (msg) => this.onRegisterMsg(msg),
    });
    this.rawSend({ type: 'register', id, payload: pairing });
  }

  onRegisterMsg(msg) {
    if (msg.type === 'registered') {
      const key = msg.payload && msg.payload['client-key'];
      if (key && key !== this.clientKey) {
        this.clientKey = key;
        this.emit('key', key);
      }
      this.pending.delete(msg.id);
      this.setStatus('connected', '');
      this.afterConnect();
    } else if (msg.type === 'response') {
      // {pairingType: 'PROMPT', returnValue: true} => la TV muestra el aviso
      if (msg.payload && msg.payload.pairingType) this.setStatus('prompt', 'Acepta la conexión en la TV con el mando');
    } else if (msg.type === 'error') {
      const e = String(msg.error || msg.payload && msg.payload.errorText || 'error');
      this.pending.delete(msg.id);
      if (/blacklisted certificate/i.test(e) && !this.triedUnsigned) {
        this.triedUnsigned = true;
        this.register(unsignedPairing());
        return;
      }
      if (/cancel|denied|reject/i.test(e)) {
        this.scheduleReconnect('emparejamiento rechazado en la TV');
        return;
      }
      // client-key inválida: borrarla y pedir de nuevo
      if (this.clientKey && /key|regist/i.test(e)) {
        this.clientKey = null;
        this.emit('key', null);
      }
      this.scheduleReconnect('error de registro: ' + e);
    }
  }

  onMessage(data) {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (_) { return; }
    const p = this.pending.get(msg.id);
    if (p && p.onMsg) return p.onMsg(msg);
    const sub = this.subs.get(msg.id);
    if (sub) {
      if (msg.type === 'error') return;
      return sub(msg.payload || {});
    }
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(msg.id);
    if (msg.type === 'error' || (msg.payload && msg.payload.returnValue === false)) {
      p.reject(tvError(p.uri, msg));
    } else {
      p.resolve(msg.payload || {});
    }
  }

  /** Petición SSAP: uri tipo 'ssap://audio/volumeUp' o 'audio/volumeUp'. */
  request(uri, payload) {
    if (!/^ssap:\/\//.test(uri)) uri = 'ssap://' + uri;
    // Cada fallo se emite como 'requestError' para que el servidor lo registre con la respuesta cruda.
    return this._request(uri, payload).catch((e) => {
      this.emit('requestError', { uri, payload: payload || {}, error: e.message, raw: e.raw || null });
      throw e;
    });
  }

  _request(uri, payload) {
    return new Promise((resolve, reject) => {
      if (this.state !== 'connected') return reject(new Error('TV no conectada'));
      const id = 'req_' + this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('timeout ' + uri));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer, uri });
      try {
        this.rawSend({ type: 'request', id, uri, payload: payload || {} });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  subscribe(uri, cb) {
    if (!/^ssap:\/\//.test(uri)) uri = 'ssap://' + uri;
    const id = 'sub_' + this.nextId++;
    this.subs.set(id, cb);
    try { this.rawSend({ type: 'subscribe', id, uri, payload: {} }); } catch (_) { /* nada */ }
  }

  afterConnect() {
    // Datos útiles; si un endpoint no existe en webOS 2 simplemente se ignora.
    this.request('com.webos.service.connectionmanager/getinfo').then((r) => {
      const macs = {
        wired: r.wiredInfo && r.wiredInfo.macAddress,
        wifi: r.wifiInfo && r.wifiInfo.macAddress,
      };
      if (macs.wired || macs.wifi) this.emit('macs', macs);
    }).catch(() => {});
    this.request('system/getSystemInfo').then((r) => this.emit('info', r)).catch(() => {});
    this.request('com.webos.service.update/getCurrentSWInformation').then((r) => this.emit('info', { sw: r })).catch(() => {});
    this.subscribe('audio/getVolume', (r) => {
      // webOS 2/3: {volume, muted}; webOS 5+: {volumeStatus:{volume, muteStatus}}
      const v = r.volumeStatus ? { volume: r.volumeStatus.volume, muted: r.volumeStatus.muteStatus } : { volume: r.volume, muted: r.muted };
      if (v.volume !== undefined || v.muted !== undefined) this.emit('volume', v);
    });
    this.getPointer().catch(() => {});
  }

  /** Abre (o reutiliza) el pointer input socket. */
  getPointer() {
    if (this.pointer && this.pointer.readyState === WebSocket.OPEN) return Promise.resolve(this.pointer);
    if (this.pointerConnecting) return this.pointerConnecting;
    this.pointerConnecting = this.request('com.webos.service.networkinput/getPointerInputSocket').then((r) => {
      if (!r.socketPath) throw new Error('la TV no devolvió socketPath');
      return new Promise((resolve, reject) => {
        const sock = new WebSocket(r.socketPath, { rejectUnauthorized: false, handshakeTimeout: this.timeout, perMessageDeflate: false });
        sock.on('open', () => { this.pointer = sock; this.pointerConnecting = null; resolve(sock); });
        sock.on('error', (e) => { this.pointerConnecting = null; if (this.pointer === sock) this.pointer = null; reject(e); });
        sock.on('close', () => { if (this.pointer === sock) this.pointer = null; this.pointerConnecting = null; });
      });
    }).catch((e) => { this.pointerConnecting = null; throw e; });
    return this.pointerConnecting;
  }

  /** Envía un mensaje al pointer socket: type + pares clave:valor + línea en blanco. */
  async pointerSend(type, payload) {
    const sock = await this.getPointer();
    const lines = ['type:' + type];
    for (const k of Object.keys(payload || {})) lines.push(k + ':' + payload[k]);
    sock.send(lines.join('\n') + '\n\n');
  }

  button(name) { return this.pointerSend('button', { name }); }
  move(dx, dy, down) { return this.pointerSend('move', { dx: Math.round(dx), dy: Math.round(dy), down: down ? 1 : 0 }); }
  click() { return this.pointerSend('click'); }
  scroll(dx, dy) { return this.pointerSend('scroll', { dx: Math.round(dx), dy: Math.round(dy) }); }
}

module.exports = { LGTV, tvError };
