'use strict';
/*
 * TV LG webOS falsa (SSAP) para pruebas locales. No toca ninguna TV real.
 *   node test/mock-tv.js [puerto]    (por defecto 3000)
 * Simula: registro con aviso (PROMPT) -> 'registered' con client-key, reutiliza la key,
 * pointer input socket, lista de entradas, apps, volumen, connectionmanager/getinfo, etc.
 */
const http = require('http');
const WebSocket = require('ws');

function createMockTv({ port = 0, promptDelay = 300, key = 'MOCK-CLIENT-KEY-1234' } = {}) {
  const log = { requests: [], pointer: [], registers: [] };
  // fail: uri (sin ssap://) -> nº de veces que responderá '500 Application error' (Infinity = siempre)
  const state = { volume: 10, muted: false, input: 'HDMI_1', foreground: 'com.webos.app.livetv', fail: {}, launched: [] };
  const server = http.createServer();
  const wss = new WebSocket.Server({ noServer: true });
  const pwss = new WebSocket.Server({ noServer: true });
  let addr;
  const volSubs = new Set();

  server.on('upgrade', (req, sock, head) => {
    if (req.url.includes('netinput.pointer.sock')) pwss.handleUpgrade(req, sock, head, (ws) => pwss.emit('connection', ws));
    else wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws));
  });

  pwss.on('connection', (ws) => ws.on('message', (m) => log.pointer.push(m.toString())));

  const pushVol = () => { for (const [ws, id] of volSubs) if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'response', id, payload: { returnValue: true, volume: state.volume, muted: state.muted, scenario: 'mastervolume_tv_speaker' } })); };

  const handlers = {
    'ssap://com.webos.service.networkinput/getPointerInputSocket': () => ({ socketPath: `ws://127.0.0.1:${addr.port}/resources/abc123/netinput.pointer.sock` }),
    'ssap://com.webos.service.connectionmanager/getinfo': () => ({ wifiInfo: { macAddress: 'a8:23:fe:11:22:33' }, wiredInfo: { macAddress: 'a8:23:fe:44:55:66' } }),
    'ssap://system/getSystemInfo': () => ({ modelName: '32LF592U-ZB', receiverType: 'dvb' }),
    'ssap://com.webos.service.update/getCurrentSWInformation': () => ({ product_name: 'webOS', major_ver: '03', minor_ver: '21.40' }),
    'ssap://audio/volumeUp': () => { state.volume++; pushVol(); return {}; },
    'ssap://audio/volumeDown': () => { state.volume--; pushVol(); return {}; },
    'ssap://audio/getStatus': () => ({ mute: state.muted, volume: state.volume }),
    'ssap://audio/setMute': (p) => { state.muted = !!p.mute; pushVol(); return {}; },
    'ssap://tv/getExternalInputList': () => ({ devices: [
      { id: 'HDMI_1', label: 'HDMI1', connected: true, appId: 'com.webos.app.hdmi1' },
      { id: 'HDMI_2', label: 'HDMI2', connected: false, appId: 'com.webos.app.hdmi2' },
      { id: 'AV_1', label: 'AV', connected: false, appId: 'com.webos.app.externalinput.av1' }] }),
    'ssap://tv/switchInput': (p) => { state.input = p.inputId; return {}; },
    'ssap://com.webos.applicationManager/listLaunchPoints': () => ({ launchPoints: [{ id: 'youtube.leanback.v4', title: 'YouTube' }, { id: 'netflix', title: 'Netflix' }] }),
    'ssap://com.webos.applicationManager/listApps': () => ({ apps: [
      // Como la app web antigua de webOS 1/2: deep link = URL completa de youtube.com/tv
      { id: 'youtube.leanback.v4', title: 'YouTube', visible: true, type: 'web', deeplinkingParams: '{"contentTarget":"https://www.youtube.com/tv?v=$CONTENTID"}' }, { id: 'netflix', title: 'Netflix', visible: true },
      { id: 'com.webos.app.hdmi1', title: 'HDMI1', visible: true }, { id: 'com.webos.app.hdmi2', title: 'HDMI2', visible: true },
      { id: 'com.webos.app.oculto', title: 'Oculta', visible: false }] }),
    'ssap://com.webos.applicationManager/getForegroundAppInfo': () => ({ appId: state.foreground, windowId: '', processId: '' }),
    'ssap://system.launcher/launch': (p) => { state.launched.push(p); state.foreground = p.id; if (/^com\.webos\.app\.hdmi(\d)$/.test(p.id)) state.input = 'HDMI_' + RegExp.$1; return { id: p.id }; },
  };

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'register') {
        log.registers.push(msg.payload);
        const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
        if (msg.payload['client-key'] === key) return send({ type: 'registered', id: msg.id, payload: { 'client-key': key } });
        send({ type: 'response', id: msg.id, payload: { pairingType: 'PROMPT', returnValue: true } });
        setTimeout(() => send({ type: 'registered', id: msg.id, payload: { 'client-key': key } }), promptDelay);
        return;
      }
      log.requests.push({ type: msg.type, uri: msg.uri, payload: msg.payload });
      if (msg.type === 'subscribe' && msg.uri === 'ssap://audio/getVolume') { volSubs.add([ws, msg.id]); return pushVol(); }
      const short = String(msg.uri).replace(/^ssap:\/\//, '');
      if (state.fail[short] > 0) {
        state.fail[short]--;
        // Formato real de webOS para un fallo del servicio
        return ws.send(JSON.stringify({ type: 'error', id: msg.id, error: '500 Application error', payload: {} }));
      }
      const h = handlers[msg.uri];
      const payload = h ? h(msg.payload || {}) : {};
      ws.send(JSON.stringify({ type: 'response', id: msg.id, payload: { returnValue: true, ...payload } }));
    });
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    addr = server.address();
    resolve({
      port: addr.port, log, state, key,
      close: () => new Promise((r) => {
        for (const c of [...wss.clients, ...pwss.clients]) c.terminate();
        server.close(() => r());
      }),
    });
  }));
}

if (require.main === module) {
  createMockTv({ port: Number(process.argv[2]) || 3000, promptDelay: 3000 }).then((m) => {
    console.log('TV falsa escuchando en ws://127.0.0.1:' + m.port);
    setInterval(() => {
      while (m.log.pointer.length) console.log('pointer:', JSON.stringify(m.log.pointer.shift()));
      while (m.log.requests.length) { const r = m.log.requests.shift(); console.log(r.type, r.uri, JSON.stringify(r.payload)); }
    }, 200);
  });
}
module.exports = { createMockTv };
