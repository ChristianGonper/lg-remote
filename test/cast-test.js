'use strict';
/* Pruebas del envío a la tele sin tele real: mensajes SSAP y HTTP con Range. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { Readable, PassThrough } = require('stream');
const { spawn } = require('child_process');
const {
  buildCastPlan, createCaster, parseYouTube, describeMedia, seekPositionMs, tvUrlProblem, YT_TEMPLATE,
} = require('../lib/cast');
const {
  listenHost, pickLanIPv4, sanitizeName, parseByteRange, createCastStore, serveCast, isIPv4,
} = require('../lib/cast-http');
const { createMockTv } = require('./mock-tv');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const ok = (m) => { passed++; console.log('  ✔', m); };

function viewer(url, title, mime, withLoop) {
  const payload = { target: url, title, mimeType: mime };
  if (withLoop) payload.loop = false;
  return payload;
}

(async () => {
  console.log('A) Clasificación y mensajes SSAP');
  assert.equal(parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
  assert.equal(parseYouTube('https://youtu.be/dQw4w9WgXcQ?t=10').videoId, 'dQw4w9WgXcQ');
  assert.equal(parseYouTube('https://m.youtube.com/shorts/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
  assert.equal(parseYouTube('https://www.youtube.com/embed/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
  assert.equal(parseYouTube('https://www.youtube.com/live/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
  assert.equal(parseYouTube('https://music.youtube.com/watch?v=dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
  const both = parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijk');
  assert.equal(both.listId, 'PLabcdefghijk');
  assert.equal(parseYouTube('https://www.youtube.com/playlist?list=PLabcdefghijk').type, 'playlist');
  assert.equal(parseYouTube('https://www.youtube.com/results?search_query=lofi+hip+hop').type, 'search');
  assert.equal(parseYouTube('https://www.youtube.com/channel/UC1234567890123456789012').channelId, 'UC1234567890123456789012');
  assert.equal(parseYouTube('https://r1---sn.googlevideo.com/videoplayback?id=1'), null);
  assert.equal(parseYouTube('http://example.com/a.mp4'), null);
  ok('URLs de YouTube, y googlevideo se queda como archivo');

  const mp4 = buildCastPlan({ url: 'http://example.com/video.mp4' });
  assert.equal(mp4.kind, 'video');
  assert.deepEqual(mp4.steps.map((s) => s.via), ['media.viewer/open', 'smartshare', 'photovideo', 'browser', 'browser-app']);
  assert.equal(mp4.steps[0].uri, 'media.viewer/open');
  assert.deepEqual(mp4.steps[0].payload, viewer('http://example.com/video.mp4', 'video.mp4', 'video/mp4', true));
  const share = mp4.steps[1];
  assert.equal(share.uri, 'system.launcher/launch');
  assert.equal(share.payload.id, 'com.webos.app.smartshare');
  assert.deepEqual(share.payload.params.payload[0], {
    fullPath: 'http://example.com/video.mp4',
    artist: '',
    subtitle: '',
    dlnaInfo: {
      flagVal: 4096,
      cleartextSize: '-1',
      contentLength: '-1',
      opVal: 1,
      protocolInfo: 'http-get:*:video/mp4:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000',
      duration: 0,
    },
    mediaType: 'VIDEO',
    thumbnail: '',
    deviceType: 'DMR',
    album: '',
    fileName: 'video.mp4',
    lastPlayPosition: -1,
  });
  assert.equal(mp4.steps[2].payload.id, 'com.webos.app.photovideo');
  assert.deepEqual(mp4.steps[3].payload, { target: 'http://example.com/video.mp4' });
  assert.equal(mp4.steps[3].uri, 'system.launcher/open');
  assert.equal(mp4.steps[4].payload.id, 'com.webos.app.browser');
  ok('orden webOS 2: media.viewer → SmartShare → Foto y vídeo → navegador');

  const sized = buildCastPlan({ url: 'http://192.168.1.34:8765/cast/abc/clip.mp4', bytes: 1000, mime: 'video/mp4', title: 'Clip' });
  assert.equal(sized.steps[1].payload.params.payload[0].dlnaInfo.contentLength, '1000');
  assert.equal(sized.steps[0].payload.title, 'Clip');
  ok('el tamaño del archivo local entra en el payload DLNA');

  const jpg = buildCastPlan({ url: 'http://example.com/foto.jpg' });
  assert.equal(jpg.kind, 'image');
  assert.deepEqual(jpg.steps[0].payload, { target: 'http://example.com/foto.jpg', title: 'foto.jpg', mimeType: 'image/jpeg' });
  assert.equal(jpg.steps[1].payload.params.payload[0].mediaType, 'IMAGE');
  const mp3 = buildCastPlan({ url: 'http://example.com/tema.mp3' });
  assert.equal(mp3.kind, 'audio');
  assert.equal(mp3.steps[0].payload.mimeType, 'audio/mpeg');
  assert.equal(mp3.steps[0].payload.loop, false);
  assert.equal(mp3.steps[1].payload.params.payload[0].mediaType, 'AUDIO');
  const hls = buildCastPlan({ url: 'http://example.com/live/index.m3u8' });
  assert.equal(hls.kind, 'hls');
  assert.equal(hls.steps[0].payload.mimeType, 'application/vnd.apple.mpegurl');
  const bare = buildCastPlan({ url: 'http://example.com/stream' });
  assert.equal(bare.kind, 'unknown');
  assert.equal(bare.steps[0].payload.mimeType, undefined);
  ok('jpg sin loop, mp3 como audio, m3u8 como HLS y URL sin extensión sin mentir el MIME');

  assert.deepEqual(buildCastPlan({ url: 'http://example.com/a.mp4', method: 'viewer' }).steps.map((s) => s.via), ['media.viewer/open']);
  assert.deepEqual(buildCastPlan({ url: 'http://example.com/a.mp4', method: 'smartshare' }).steps.map((s) => s.via), ['smartshare']);
  assert.deepEqual(buildCastPlan({ url: 'http://example.com/a.mp4', method: 'browser' }).steps.map((s) => s.via), ['browser', 'browser-app']);
  ok('se puede forzar un solo método');

  const yt = buildCastPlan({ url: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(yt.kind, 'youtube');
  assert.deepEqual(yt.steps.map((s) => s.payload.params.contentTarget), [
    'https://www.youtube.com/tv?v=dQw4w9WgXcQ',
    'v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  ]);
  assert.ok(yt.steps.every((s) => s.payload.id === 'youtube.leanback.v4' && s.uri === 'system.launcher/launch'));
  assert.equal(YT_TEMPLATE, 'https://www.youtube.com/tv?v=$CONTENTID');
  const fromTv = buildCastPlan({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghijk', youtubeTemplate: 'https://www.youtube.com/tv?v=$CONTENTID' });
  assert.equal(fromTv.steps[0].payload.params.contentTarget, 'https://www.youtube.com/tv?v=dQw4w9WgXcQ&list=PLabcdefghijk');
  assert.deepEqual(buildCastPlan({ url: 'https://youtu.be/dQw4w9WgXcQ', variant: 'v' }).steps.map((s) => s.payload.params.contentTarget), ['v=dQw4w9WgXcQ']);
  assert.equal(buildCastPlan({ url: 'https://www.youtube.com/playlist?list=PLabcdefghijk' }).steps[0].payload.params.contentTarget, 'https://www.youtube.com/tv?list=PLabcdefghijk');
  assert.equal(buildCastPlan({ url: 'https://www.youtube.com/results?search_query=lofi%20%26%20chill' }).steps[0].payload.params.contentTarget, 'https://www.youtube.com/tv?launch=search&q=lofi%20%26%20chill');
  assert.deepEqual(buildCastPlan({ url: 'https://www.youtube.com/' }).steps[0].payload, { id: 'youtube.leanback.v4' });
  assert.equal(buildCastPlan({ url: 'https://youtu.be/dQw4w9WgXcQ', method: 'browser' }).steps[0].via, 'browser');
  ok('YouTube abre la app (tv?v=, luego v=, luego watch) y no el reproductor');

  assert.throws(() => buildCastPlan({ url: 'file:///tmp/a.mp4' }), /http/);
  assert.equal(tvUrlProblem('http://[2001:db8::1]/a.mp4', '192.168.1.34').reject.includes('IPv6'), true);
  assert.equal(tvUrlProblem('http://127.0.0.1/a.mp4', '192.168.1.34').reject.includes('localhost'), true);
  assert.ok(tvUrlProblem('http://127.0.0.1/a.mp4', '127.0.0.1').warning);
  assert.equal(seekPositionMs(12.5), 12500);
  assert.equal(seekPositionMs(0), 0);
  assert.throws(() => seekPositionMs(-1), /posición/);
  assert.equal(describeMedia('http://example.com/a.mp4?x=1').mime, 'video/mp4');
  ok('rechaza file:, IPv6 y localhost cuando la tele está en otra IP; el seek va en milisegundos');

  console.log('B) El caster envía el plan y se detiene en el primer éxito');
  const calls = [];
  const caster = createCaster({
    request: async (uri, payload) => {
      calls.push({ uri, payload });
      if (uri === 'media.viewer/open') throw new Error('404 no such service');
      if (uri === 'media.controls/seek') throw new Error('404 no such method');
      if (uri === 'com.webos.media/getForegroundAppInfo') return { foregroundAppInfo: [{ mediaId: 'mid-9' }] };
      if (uri === 'com.webos.media/seek') return { mediaId: payload.mediaId };
      if (uri === 'media.controls/stop') throw new Error('stop no');
      if (uri === 'media.viewer/close') return {};
      return {};
    },
    launch: async (id, params) => {
      calls.push({ launch: id, params });
      if (id === 'com.webos.app.smartshare') return { id };
      if (String(params && params.contentTarget).startsWith('https://www.youtube.com/tv')) throw new Error('la app no acepta esa URL');
      return { id };
    },
    button: async (name) => { calls.push({ button: name }); },
    log() {},
  });
  const sent = await caster.cast({ url: 'http://example.com/video.mp4', advertiseHost: '192.168.1.34' });
  assert.equal(sent.via, 'smartshare');
  assert.equal(calls[0].uri, 'media.viewer/open');
  assert.deepEqual(calls[0].payload, viewer('http://example.com/video.mp4', 'video.mp4', 'video/mp4', true));
  assert.equal(calls[1].launch, 'com.webos.app.smartshare');
  assert.equal(calls.length, 2);
  ok('si media.viewer falla se lanza SmartShare y no se sigue con el navegador');

  calls.length = 0;
  const dry = await caster.cast({ url: 'http://example.com/video.mp4', dryRun: true, advertiseHost: '192.168.1.34' });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.steps.length, 5);
  assert.equal(calls.length, 0);
  ok('dry-run devuelve el plan y no llama a la tele');

  calls.length = 0;
  const ytSent = await caster.cast({ url: 'https://youtu.be/dQw4w9WgXcQ', advertiseHost: '192.168.1.34' });
  assert.equal(ytSent.via, 'youtube');
  assert.equal(ytSent.contentTarget, 'v=dQw4w9WgXcQ');
  assert.deepEqual(calls.map((c) => c.params.contentTarget), [
    'https://www.youtube.com/tv?v=dQw4w9WgXcQ',
    'v=dQw4w9WgXcQ',
  ]);
  assert.ok(!calls.some((c) => c.uri === 'media.viewer/open'));
  ok('YouTube prueba el deep link siguiente si el primero falla, sin abrir media.viewer');

  await assert.rejects(caster.cast({ url: 'http://127.0.0.1/a.mp4', advertiseHost: '192.168.1.34' }), /localhost/);
  const seek = await caster.control({ cmd: 'seek', seconds: 3 });
  assert.equal(seek.via, 'com.webos.media/seek');
  assert.equal(seek.position, 3000);
  assert.equal(seek.mediaId, 'mid-9');
  const stopped = await caster.control({ cmd: 'stop', session: { via: 'media.viewer/open', appId: 'com.webos.app.tvsimpleviewer', sessionId: 'sess-1' } });
  assert.equal(stopped.stopped, true);
  assert.ok(calls.some((c) => c.uri === 'media.viewer/close' && c.payload.sessionId === 'sess-1'));
  ok('seek cae a com.webos.media/seek y stop cierra la sesión del visor');

  console.log('C) IP y rangos');
  assert.equal(listenHost('::'), '0.0.0.0');
  assert.equal(listenHost('::1'), '0.0.0.0');
  assert.equal(listenHost('localhost'), '127.0.0.1');
  assert.equal(listenHost('0.0.0.0'), '0.0.0.0');
  assert.equal(listenHost('192.168.1.34'), '192.168.1.34');
  assert.equal(isIPv4('192.168.1.34'), true);
  assert.equal(isIPv4('2001:db8::1'), false);
  assert.equal(pickLanIPv4({
    eth0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 4, address: '10.0.0.8', internal: false }],
    wlan0: [{ family: 'IPv4', address: '192.168.1.34', internal: false }, { family: 'IPv4', address: '127.0.0.1', internal: true }],
  }, '192.168.1.39'), '192.168.1.34');
  assert.equal(sanitizeName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeName('mi vídeo.mp4'), 'mi_v_deo.mp4');
  assert.equal(sanitizeName('..'), 'media');
  const fileSize = 1000;
  assert.deepEqual(parseByteRange(undefined, fileSize), null);
  assert.deepEqual(parseByteRange('bytes=0-99', fileSize), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange('bytes=100-', fileSize), { start: 100, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-10', fileSize), { start: 990, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-5000', 100), { start: 0, end: 99 });
  assert.equal(parseByteRange('bytes=1000-', fileSize).unsatisfiable, true);
  assert.equal(parseByteRange('bytes=5-4', fileSize).unsatisfiable, true);
  assert.equal(parseByteRange('bytes=0-1,2-3', fileSize).ignore, true);
  assert.equal(parseByteRange('bytes=-0', fileSize).unsatisfiable, true);
  ok('IPv4 de la subred de la tele, nombres seguros y parser de Range');

  console.log('D) Servidor HTTP con Range');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lgcast-'));
  const store = createCastStore({ dir: tmp, maxBytes: 50, ttlMs: 60000 });
  const body = Buffer.from('abcdefghijklmnopqrstuvwxyz0123456789');
  const meta = await store.save(Readable.from(body), { name: 'clip.mp4', mime: 'video/mp4' });
  assert.equal(meta.bytes, body.length);
  assert.equal(meta.mime, 'video/mp4');
  await assert.rejects(store.save(Readable.from(Buffer.alloc(51)), { name: 'big.mp4' }), (e) => e.status === 413);
  assert.equal(store.list().length, 1);
  assert.equal(fs.existsSync(path.join(tmp, meta.token, 'clip.mp4')), true);
  const second = await store.save(Readable.from(Buffer.from('zzzz')), { name: 'otra.mp3', mime: 'audio/mpeg' });
  assert.equal(store.list().length, 1);
  assert.equal(fs.existsSync(path.join(tmp, meta.token)), false);
  const held = new PassThrough();
  const pending = store.save(held, { name: 'lento.mp4' });
  await sleep(30);
  await assert.rejects(store.save(Readable.from(Buffer.from('x')), { name: 'otro.mp4' }), (e) => e.status === 409);
  held.end(Buffer.from('lento'));
  const lento = await pending;
  store.sweep(lento.created + 60001);
  assert.equal(store.list().length, 0);
  const again = await store.save(Readable.from(body), { name: 'clip.mp4', mime: 'video/mp4' });
  const srv = http.createServer((req, res) => serveCast(req, res, store));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/cast/' + again.token + '/clip.mp4';
  const grab = async (headers, method = 'GET') => {
    const res = await fetch(base, { headers, method });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, buf };
  };
  let res = await grab();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(Number(res.headers.get('content-length')), body.length);
  assert.ok(res.buf.equals(body));
  res = await grab({ Range: 'bytes=0-9' });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 0-9/' + body.length);
  assert.equal(Number(res.headers.get('content-length')), 10);
  assert.equal(res.buf.toString(), body.subarray(0, 10).toString());
  res = await grab({ Range: 'bytes=10-' });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 10-' + (body.length - 1) + '/' + body.length);
  assert.ok(res.buf.equals(body.subarray(10)));
  res = await grab({ Range: 'bytes=-4' });
  assert.equal(res.status, 206);
  assert.equal(res.buf.toString(), body.subarray(body.length - 4).toString());
  res = await grab({ Range: 'bytes=0-1,2-3' });
  assert.equal(res.status, 200);
  assert.ok(res.buf.equals(body));
  res = await grab({ Range: 'bytes=' + body.length + '-' });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get('content-range'), 'bytes */' + body.length);
  res = await grab(undefined, 'HEAD');
  assert.equal(res.status, 200);
  assert.equal(res.buf.length, 0);
  assert.equal(Number(res.headers.get('content-length')), body.length);
  res = await fetch(base.replace('clip.mp4', '..%2Fclip.mp4'));
  assert.equal(res.status, 404);
  res = await fetch(base + 'no');
  assert.equal(res.status, 404);
  assert.equal(second.name, 'otra.mp3');
  srv.close();
  ok('200, 206 (inicio, abierto y sufijo), 416, HEAD, un solo archivo y sin salir del directorio');

  console.log('E) Servidor completo contra la tele falsa');
  const mock = await createMockTv({ promptDelay: 150 });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lgcast-srv-'));
  const port = 18766;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      CONFIG: path.join(work, 'none.json'),
      TV_IP: '127.0.0.1',
      TV_PORT: String(mock.port),
      PORT: String(port),
      HOST: '127.0.0.1',
      STATE_FILE: path.join(work, 'tv-state.json'),
      CAST_DIR: path.join(work, 'files'),
      CAST_MAX_MB: '1',
      WOL_ADDRESSES: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const api = (a) => fetch('http://127.0.0.1:' + port + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).then((r) => r.json());
  try {
    const t0 = Date.now();
    let st = null;
    while (Date.now() - t0 < 8000) {
      st = await fetch('http://127.0.0.1:' + port + '/api/status').then((r) => r.json()).catch(() => null);
      if (st && st.state === 'connected') break;
      await sleep(50);
    }
    assert.equal(st && st.state, 'connected');
    assert.equal(st.castHost, '127.0.0.1');
    ok('el mando sigue conectando y anuncia una IPv4');

    const beforeDry = mock.log.requests.length;
    const sim = await api({ type: 'cast', url: 'http://example.com/video.mp4', dryRun: true });
    assert.equal(sim.ok, true);
    assert.equal(sim.data.dryRun, true);
    assert.equal(sim.data.steps[0].uri, 'media.viewer/open');
    assert.equal(mock.log.requests.length, beforeDry);
    ok('dry-run por la API no escribe en el socket de la tele');

    const up = await fetch('http://127.0.0.1:' + port + '/api/cast/upload?name=' + encodeURIComponent('clip.mp4'), {
      method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: Buffer.from('0123456789abcdef'),
    }).then((r) => r.json());
    assert.equal(up.ok, true, JSON.stringify(up));
    assert.ok(up.data.url.startsWith('http://127.0.0.1:' + port + '/cast/'));
    const partial = await fetch(up.data.url, { headers: { Range: 'bytes=4-7' } });
    assert.equal(partial.status, 206);
    assert.equal(Buffer.from(await partial.arrayBuffer()).toString(), '4567');
    const played = await api({ type: 'cast', url: up.data.url, title: 'clip.mp4', mime: 'video/mp4', bytes: up.data.bytes });
    assert.equal(played.ok, true, played.error);
    assert.equal(played.data.via, 'media.viewer/open');
    assert.equal(played.data.sessionId, 'sess-mock');
    assert.equal(mock.state.media.target, up.data.url);
    assert.equal(mock.state.media.mimeType, 'video/mp4');
    assert.equal(mock.state.media.loop, false);
    ok('el archivo subido se sirve con Range y media.viewer/open recibe esa URL');

    const nReq = mock.log.requests.length;
    const tube = await api({ type: 'cast', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    assert.equal(tube.ok, true, tube.error);
    assert.equal(tube.data.via, 'youtube');
    assert.equal(tube.data.contentTarget, 'https://www.youtube.com/tv?v=dQw4w9WgXcQ');
    assert.ok(!mock.log.requests.slice(nReq).some((r) => r.uri === 'ssap://media.viewer/open'));
    assert.equal(mock.state.launched.at(-1).params.contentTarget, 'https://www.youtube.com/tv?v=dQw4w9WgXcQ');
    ok('el enlace de YouTube sale por la app, con la plantilla que declara la tele');

    mock.state.fail['media.viewer/open'] = Infinity;
    const fb = await api({ type: 'cast', url: 'http://example.com/b.mp4', method: 'auto' });
    assert.equal(fb.ok, true, fb.error);
    assert.equal(fb.data.via, 'smartshare');
    assert.equal(mock.state.launched.at(-1).id, 'com.webos.app.smartshare');
    assert.equal(mock.state.launched.at(-1).params.payload[0].fullPath, 'http://example.com/b.mp4');
    assert.ok(!mock.state.launched.some((p) => p.id === 'com.webos.app.photovideo'));
    mock.state.fail = {};
    ok('si media.viewer responde 500 se usa SmartShare y no se abre Foto y vídeo');

    const sk = await api({ type: 'castControl', cmd: 'seek', seconds: 12.5 });
    assert.equal(sk.ok, true, sk.error);
    assert.equal(sk.data.position, 12500);
    assert.equal(mock.state.seek, 12500);
    mock.state.fail['media.controls/seek'] = Infinity;
    const sk2 = await api({ type: 'castControl', cmd: 'seek', seconds: 3 });
    assert.equal(sk2.ok && sk2.data.via, 'com.webos.media/seek', JSON.stringify(sk2));
    assert.equal(mock.state.seekId, 'media-1');
    mock.state.fail = {};
    ok('seek: media.controls/seek y, si no existe, com.webos.media/seek');

    const st0 = await api({ type: 'castControl', cmd: 'stop' });
    assert.equal(st0.ok, true, st0.error);
    assert.equal(mock.state.playing, 'stop');
    assert.equal((await api({ type: 'button', name: 'HOME' })).ok, true);
    assert.equal((await api({ type: 'cast', url: 'http://[2001:db8::1]/a.mp4' })).ok, false);
    const html = await fetch('http://127.0.0.1:' + port + '/').then((r) => r.text());
    assert.ok(html.includes('id="page-enviar"') && html.includes('Elegir archivo del móvil'));
    ok('stop, el mando de siempre y la pestaña Enviar siguen en su sitio');
    console.log('\nOK: ' + passed + ' comprobaciones de cast');
  } catch (e) {
    console.error('\nFALLO:', e.stack || e);
    console.error('--- log servidor ---\n' + log);
    process.exitCode = 1;
  } finally {
    child.kill();
    await mock.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
})();
