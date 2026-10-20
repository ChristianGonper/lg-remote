#!/usr/bin/env node
/**
 * Capturas de la vista previa a 1280x720.
 * node launcher/scripts/shoot.js [dir]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || '/opt/cursor/artifacts/screenshots';
const PORT = 8770;
const DEBUG_PORT = 9333;

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, label, tries) {
  let last;
  for (let i = 0; i < (tries || 50); i++) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) { last = err; }
    await sleep(200);
  }
  throw new Error('tiempo de espera: ' + label + (last ? ' (' + last.message + ')' : ''));
}

function cdp(ws) {
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const item = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) item.reject(new Error(JSON.stringify(msg.error)));
    else item.resolve(msg.result || {});
  });
  return function send(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chrome = spawn('google-chrome', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=/tmp/chrome-launcher-profile',
    '--window-size=1280,720',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let chromeLog = '';
  chrome.stderr.on('data', (buf) => { chromeLog += buf.toString(); });

  try {
    await waitFor(async () => {
      try {
        const list = await getJson('http://127.0.0.1:' + DEBUG_PORT + '/json/list');
        return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null;
      } catch (err) { return null; }
    }, 'chrome');

    const list = await getJson('http://127.0.0.1:' + DEBUG_PORT + '/json/list');
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error('websocket de chrome')));
    });
    const send = cdp(ws);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.__errors=[];window.addEventListener("error",function(e){window.__errors.push(String(e.message||e));});',
    });
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?preview=1' });

    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result ? result.result.value : undefined;
    }

    await waitFor(async () => (await evaluate('document.body && document.body.getAttribute("data-ready")')) === '1', 'lista de apps');
    await sleep(150);

    const layout = await evaluate(`(function () {
      var stage = document.getElementById('stage').getBoundingClientRect();
      var foot = document.getElementById('foot').getBoundingClientRect();
      var tiles = [].slice.call(document.querySelectorAll('#apps .tile, #inputs .tile'));
      var overflow = tiles.filter(function (el) {
        var r = el.getBoundingClientRect();
        return r.right > stage.right - 2 || r.bottom > foot.top - 4 || r.left < stage.left;
      }).map(function (el) { return el.getAttribute('data-focus-id'); });
      return {
        stage: { w: Math.round(stage.width), h: Math.round(stage.height) },
        apps: document.querySelectorAll('#apps .tile').length,
        inputs: document.querySelectorAll('#inputs .tile').length,
        focus: (document.querySelector('.is-focused .tile-title') || {}).textContent || '',
        overflow: overflow,
        errors: window.__errors || []
      };
    })()`);
    if (layout.stage.w !== 1280 || layout.stage.h !== 720) {
      throw new Error('el escenario no es 1280x720: ' + JSON.stringify(layout.stage));
    }
    if (layout.apps !== 6 || layout.inputs !== 6) {
      throw new Error('filas inesperadas: ' + JSON.stringify(layout));
    }
    if (layout.focus !== 'YouTube') throw new Error('foco inicial: ' + layout.focus);
    if (layout.overflow.length) throw new Error('mosaicos fuera de sitio: ' + layout.overflow.join(', '));
    if (layout.errors.length) throw new Error('errores de página: ' + layout.errors.join(' | '));
    const clipped = await evaluate(`(function () {
      var bad = [];
      var nodes = document.querySelectorAll('#apps .tile-title, #inputs .tile-title, #apps .tile-sub, #inputs .tile-sub');
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].scrollWidth > nodes[i].clientWidth + 1) bad.push(nodes[i].textContent);
      }
      return bad;
    })()`);
    if (clipped.length) throw new Error('texto cortado: ' + clipped.join(', '));

    async function shot(name) {
      const image = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, name);
      fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
      console.log(file);
    }

    async function key(code, name) {
      const base = { windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: name, code: name };
      await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
      await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
      await sleep(60);
    }

    async function focusTitle() {
      return evaluate('(document.querySelector(".is-focused .tile-title") || {}).textContent || ""');
    }

    await shot('launcher-home-1280x720.png');

    await key(40, 'ArrowDown');
    await key(39, 'ArrowRight');
    const hdmi = await focusTitle();
    if (hdmi !== 'HDMI 1') throw new Error('tras bajar y derecha el foco es "' + hdmi + '"');
    await shot('launcher-hdmi-1280x720.png');

    await key(38, 'ArrowUp');
    await key(39, 'ArrowRight');
    await key(39, 'ArrowRight');
    await key(39, 'ArrowRight');
    await key(39, 'ArrowRight');
    const todas = await focusTitle();
    if (todas !== 'Todas') throw new Error('el foco no llegó a Todas ("' + todas + '")');
    await key(13, 'Enter');
    await sleep(80);
    const overlay = await evaluate(`(function () {
      var open = !document.getElementById('overlay').classList.contains('hidden');
      var first = (document.querySelector('#overlay .is-focused .tile-title') || {}).textContent || '';
      var n = document.querySelectorAll('#overlay .tile').length;
      return { open: open, first: first, n: n };
    })()`);
    if (!overlay.open || overlay.first !== 'Ajustes' || overlay.n < 8) {
      throw new Error('lista de apps inesperada: ' + JSON.stringify(overlay));
    }
    await shot('launcher-todas-1280x720.png');

    await key(27, 'Escape');
    const closed = await evaluate('document.getElementById("overlay").classList.contains("hidden")');
    if (!closed) throw new Error('Atrás no cerró la lista');

    await key(37, 'ArrowLeft');
    await key(37, 'ArrowLeft');
    await key(37, 'ArrowLeft');
    await key(37, 'ArrowLeft');
    await key(37, 'ArrowLeft');
    const backHome = await focusTitle();
    if (backHome !== 'YouTube') throw new Error('al volver el foco es "' + backHome + '"');
    await key(13, 'Enter');
    await sleep(120);
    const toast = await evaluate('document.getElementById("toast").textContent');
    if (toast.indexOf('YouTube') < 0) throw new Error('el aviso no menciona YouTube: ' + toast);
    await shot('launcher-abrir-1280x720.png');

    ws.close();
  } finally {
    chrome.kill('SIGKILL');
    server.kill('SIGKILL');
    if (chromeLog && process.env.SHOOT_DEBUG) process.stderr.write(chromeLog);
  }
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
