'use strict';
/* Wake-on-LAN sin dependencias. */
const dgram = require('dgram');

function normalizeMac(mac) {
  const hex = String(mac || '').replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 12) throw new Error('MAC inválida: ' + mac);
  return hex.match(/../g).join(':').toLowerCase();
}

function magicPacket(mac) {
  const m = Buffer.from(normalizeMac(mac).replace(/:/g, ''), 'hex');
  const buf = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i++) m.copy(buf, 6 + i * 6);
  return buf;
}

/** Dirección de broadcast /24 a partir de la IP de la TV (192.168.1.39 -> 192.168.1.255). */
function subnetBroadcast(ip) {
  const p = String(ip || '').split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.255` : null;
}

/**
 * Envía el paquete mágico a cada MAC, a cada dirección y puerto, `repeat` veces.
 * @returns {Promise<{sent:number, errors:string[]}>}
 */
function wake(macs, { addresses = ['255.255.255.255'], ports = [9], repeat = 3, interval = 100 } = {}) {
  macs = [].concat(macs).filter(Boolean);
  if (!macs.length) return Promise.reject(new Error('No hay MAC configurada ni aprendida de la TV'));
  const packets = macs.map(magicPacket);
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let sent = 0;
    const errors = [];
    sock.on('error', (e) => errors.push(e.message));
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch (e) { errors.push(e.message); }
      const jobs = [];
      for (let r = 0; r < repeat; r++) for (const pkt of packets) for (const a of addresses) for (const port of ports) jobs.push([pkt, a, port, r]);
      let pendingCount = jobs.length;
      const done = () => { if (--pendingCount === 0) { sock.close(); resolve({ sent, errors }); } };
      for (const [pkt, a, port, r] of jobs) {
        setTimeout(() => sock.send(pkt, 0, pkt.length, port, a, (err) => { if (err) errors.push(`${a}:${port} ${err.message}`); else sent++; done(); }), r * interval);
      }
    });
  });
}

module.exports = { wake, magicPacket, normalizeMac, subnetBroadcast };
