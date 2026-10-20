'use strict';
/* Prueba de extremo a extremo contra la TV falsa: node test/run-test.js */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dgram = require('dgram');
const assert = require('assert');
const WebSocket = require('ws');
const { createMockTv } = require('./mock-tv');
const { magicPacket } = require('../lib/wol');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgremote-'));
const STATE = path.join(tmp, 'tv-state.json');
const HTTP_PORT = 18765;
let passed = 0;
const ok = (m) => { passed++; console.log('  ✔', m); };

async function waitFor(fn, ms = 8000, what = 'condición') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout esperando ' + what);
    await sleep(100);
  }
}
const status = () => fetch(`http://127.0.0.1:${HTTP_PORT}/api/status`).then((r) => r.json()).catch(() => null);
const action = (a) => fetch(`http://127.0.0.1:${HTTP_PORT}/api/action`, { method: 'POST', body: JSON.stringify(a) }).then((r) => r.json());

function startServer(tvPort, wolPort) {
  const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, CONFIG: path.join(tmp, 'none.json'), TV_IP: '127.0.0.1', TV_PORT: String(tvPort), PORT: String(HTTP_PORT), HOST: '127.0.0.1', STATE_FILE: STATE, WOL_ADDRESSES: '127.0.0.1', WOL_PORTS: String(wolPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.out = '';
  p.stdout.on('data', (d) => { p.out += d; });
  p.stderr.on('data', (d) => { p.out += d; });
  return p;
}

(async () => {
  // Escucha UDP para capturar el Wake-on-LAN
  const udp = dgram.createSocket('udp4');
  const wolPackets = [];
  await new Promise((r) => udp.bind(0, '127.0.0.1', r));
  udp.on('message', (m) => wolPackets.push(m));

  let mock = await createMockTv({ promptDelay: 800 });
  console.log('TV falsa en puerto', mock.port);
  let srv = startServer(mock.port, udp.address().port);
  try {
    console.log('1) Primer arranque y emparejamiento');
    await waitFor(async () => (await status())?.state === 'prompt', 8000, 'estado prompt');
    ok('la UI recibe estado "esperando aceptar en la TV"');
    const reg = mock.log.registers[0];
    assert.equal(reg.pairingType, 'PROMPT');
    assert.ok(reg.manifest.signed && reg.manifest.signatures, 'manifest firmado estándar');
    assert.ok(!reg['client-key']);
    ok('register enviado con manifest estándar (firmado) y sin client-key');
    await waitFor(async () => (await status())?.state === 'connected', 8000, 'connected');
    ok('estado conectado tras aceptar');
    await waitFor(() => fs.existsSync(STATE) && JSON.parse(fs.readFileSync(STATE))['127.0.0.1']?.clientKey === mock.key, 3000, 'key guardada');
    ok('client-key guardada en ' + path.basename(STATE));
    await waitFor(async () => (await status())?.macs?.length === 2, 3000, 'MACs');
    const st = await status();
    assert.equal(st.model, '32LF592U-ZB');
    ok('MAC aprendidas vía connectionmanager/getinfo: ' + st.macs.join(', ') + ' · modelo ' + st.model + ' · fw ' + st.firmware);

    console.log('2) Botones por el pointer input socket');
    const keys = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'BACK', 'HOME', 'MENU', 'QMENU', 'GUIDE', 'INFO', 'EXIT', 'RED', 'GREEN', 'YELLOW', 'BLUE', 'DASH', 'LIST', 'CC', 'SAP', '0', '9'];
    for (const k of keys) assert.ok((await action({ type: 'button', name: k })).ok, k);
    await waitFor(() => mock.log.pointer.length >= keys.length, 3000, 'pointer');
    assert.deepEqual(mock.log.pointer.slice(0, keys.length), keys.map((k) => `type:button\nname:${k}\n\n`));
    ok(`${keys.length} teclas recibidas con formato exacto 'type:button\\nname:X\\n\\n'`);
    assert.equal((await action({ type: 'button', name: 'bad;name' })).ok, false);
    ok('nombres de tecla no válidos se rechazan');

    console.log('3) URIs SSAP');
    const before = mock.log.requests.length;
    for (const a of [{ type: 'ssap', cmd: 'volumeUp' }, { type: 'ssap', cmd: 'volumeDown' }, { type: 'ssap', cmd: 'channelUp' }, { type: 'ssap', cmd: 'channelDown' },
      { type: 'mute' }, { type: 'media', name: 'PLAY' }, { type: 'media', name: 'PAUSE' }, { type: 'liveTv' }, { type: 'text', text: 'hola' }, { type: 'enter' }, { type: 'delete', count: 2 },
      { type: 'input', id: 'HDMI_2' }, { type: 'ssap', cmd: 'powerOff' }]) {
      const r = await action(a);
      assert.ok(r.ok, JSON.stringify(a) + ' ' + r.error);
    }
    const uris = mock.log.requests.slice(before).map((r) => r.uri);
    for (const u of ['audio/volumeUp', 'audio/volumeDown', 'tv/channelUp', 'tv/channelDown', 'audio/setMute', 'media.controls/play', 'media.controls/pause', 'system.launcher/launch', 'com.webos.service.ime/insertText', 'com.webos.service.ime/sendEnterKey', 'com.webos.service.ime/deleteCharacters', 'tv/switchInput', 'system/turnOff']) {
      assert.ok(uris.includes('ssap://' + u), 'falta ' + u);
    }
    assert.equal(mock.state.input, 'HDMI_2');
    ok('volumen, canales, mute, media, Live TV, texto, entrada y apagado llegan a sus URIs');
    const inputs = await action({ type: 'inputs' });
    assert.equal(inputs.data.devices.length, 3);
    ok('lista de entradas: ' + inputs.data.devices.map((d) => d.label).join(', '));
    const apps = await action({ type: 'apps' });
    assert.equal(apps.data.apps.length, 2);
    ok('lista de apps');

    console.log('4) Puntero');
    const pBefore = mock.log.pointer.length;
    await action({ type: 'move', dx: 10.4, dy: -3 });
    await action({ type: 'click' });
    await action({ type: 'scroll', dx: 0, dy: 5 });
    await waitFor(() => mock.log.pointer.length >= pBefore + 3, 2000, 'puntero');
    assert.deepEqual(mock.log.pointer.slice(pBefore), ['type:move\ndx:10\ndy:-3\ndown:0\n\n', 'type:click\n\n', 'type:scroll\ndx:0\ndy:5\n\n']);
    ok('move / click / scroll');

    console.log('5) WebSocket navegador <-> servidor');
    const bws = new WebSocket(`ws://127.0.0.1:${HTTP_PORT}/ws`);
    const msgs = [];
    bws.on('message', (m) => msgs.push(JSON.parse(m)));
    await new Promise((r) => bws.on('open', r));
    bws.send(JSON.stringify({ id: 1, type: 'button', name: 'HOME' }));
    await waitFor(() => msgs.find((m) => m.id === 1), 2000, 'respuesta ws');
    assert.ok(msgs.find((m) => m.event === 'status' && m.state === 'connected'));
    assert.ok(msgs.find((m) => m.id === 1).ok);
    await action({ type: 'ssap', cmd: 'volumeUp' });
    await waitFor(() => msgs.find((m) => m.event === 'volume'), 2000, 'evento volumen');
    bws.close();
    ok('estado y volumen en vivo por /ws, botones por /ws');

    console.log('6) Wake-on-LAN');
    const w = await action({ type: 'powerOn' });
    assert.ok(w.ok, w.error);
    await waitFor(() => wolPackets.length >= 6, 2000, 'paquetes WoL');
    const expected = [magicPacket('a8:23:fe:11:22:33'), magicPacket('a8:23:fe:44:55:66')];
    assert.ok(wolPackets.every((p) => expected.some((e) => e.equals(p))) && expected.every((e) => wolPackets.some((p) => e.equals(p))));
    ok(`paquetes mágicos correctos (${wolPackets.length}) para wifi y cable`);

    console.log('7) UI');
    const html = await fetch(`http://127.0.0.1:${HTTP_PORT}/`).then((r) => r.text());
    assert.ok(html.includes('<title>Mando LG</title>') && html.includes('data-btn="ENTER"'));
    for (const f of ['app.js', 'style.css', 'manifest.webmanifest', 'icon.svg']) assert.equal((await fetch(`http://127.0.0.1:${HTTP_PORT}/${f}`)).status, 200, f);
    assert.equal((await fetch(`http://127.0.0.1:${HTTP_PORT}/../server.js`)).status, 404);
    ok('index.html y recursos se sirven');

    console.log('8) Reconexión automática (la TV se "apaga" y vuelve)');
    const port = mock.port;
    await mock.close();
    await waitFor(async () => (await status())?.state !== 'connected', 15000, 'detectar caída');
    ok('detecta desconexión: ' + (await status()).detail);
    mock = await createMockTv({ port, promptDelay: 800 });
    await waitFor(async () => (await status())?.state === 'connected', 20000, 'reconexión');
    assert.equal(mock.log.registers[0]['client-key'], mock.key);
    ok('reconecta solo y se registra con la key guardada (sin aviso)');
    assert.ok((await action({ type: 'button', name: 'ENTER' })).ok);
    await waitFor(() => mock.log.pointer.includes('type:button\nname:ENTER\n\n'), 3000, 'pointer tras reconexión');
    ok('pointer socket se reabre tras reconectar');

    console.log('9) Reinicio del servidor: no vuelve a emparejar');
    srv.kill();
    await sleep(500);
    mock.log.registers.length = 0;
    srv = startServer(mock.port, udp.address().port);
    await waitFor(async () => (await status())?.state === 'connected', 8000, 'connected tras reinicio');
    assert.equal(mock.log.registers[0]['client-key'], mock.key);
    ok('usa la client-key del fichero');

    console.log(`\nOK: ${passed} comprobaciones superadas`);
  } catch (e) {
    console.error('\nFALLO:', e.stack || e);
    console.error('--- log servidor ---\n' + srv.out);
    process.exitCode = 1;
  } finally {
    srv.kill();
    await mock.close();
    udp.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
