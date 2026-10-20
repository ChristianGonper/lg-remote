'use strict';
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const STATE_TXT = {
    connected: 'Conectado',
    prompt: 'Esperando aceptar en la TV',
    connecting: 'Conectando…',
    disconnected: 'Desconectado',
    server: 'Sin conexión con el servidor',
  };
  let status = {};
  let ws = null;
  let seq = 0;
  const waiting = new Map();

  // ---------- Conexión con el servidor local ----------
  function connectWs() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== undefined && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
      if (m.event === 'status') { status = m; renderStatus(); }
      if (m.event === 'volume') { status.volume = { volume: m.volume, muted: m.muted }; renderStatus(); }
    };
    ws.onclose = () => { renderStatus('server'); setTimeout(connectWs, 1500); };
  }

  function send(action, quiet) {
    return new Promise((resolve) => {
      const done = (m) => { if (!m.ok && !quiet) toast('⚠️ ' + m.error); resolve(m); };
      if (ws && ws.readyState === 1) {
        const id = ++seq;
        waiting.set(id, done);
        ws.send(JSON.stringify({ ...action, id }));
        setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); done({ ok: false, error: 'sin respuesta' }); } }, 8000);
      } else {
        fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) })
          .then((r) => r.json()).then(done).catch((e) => done({ ok: false, error: 'servidor no disponible' }));
      }
    });
  }
  // Movimiento del puntero: sin esperar respuesta
  function fire(action) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(action)); }

  function renderStatus(force) {
    const st = force || status.state || 'disconnected';
    const el = $('#status');
    el.className = 'status ' + st;
    let txt = STATE_TXT[st] || st;
    if (st === 'disconnected' && status.detail) txt += ' · ' + status.detail;
    $('#statusText').textContent = txt;
    $('#promptBanner').classList.toggle('hidden', st !== 'prompt');
    const v = status.volume;
    $('#volText').textContent = v && v.volume !== undefined ? (v.muted ? '🔇 ' : '🔊 ') + v.volume : '';
  }

  function toast(msg, ms = 2500) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.add('hidden'), ms);
  }
  const buzz = (ms = 25) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} };

  // ---------- Acciones de los botones ----------
  async function runAct(act, el) {
    const [type, arg] = act.split(':');
    switch (type) {
      case 'ssap': return send({ type: 'ssap', cmd: arg });
      case 'media': return send({ type: 'media', name: arg });
      case 'powerOn': {
        const r = await send({ type: 'powerOn' });
        if (r.ok) toast(`Wake-on-LAN enviado (${r.data.macs.join(', ')}). Si la TV no enciende, mira el README.`, 4000);
        return r;
      }
      case 'inputs': return showInputs();
      case 'apps': return loadApps();
      case 'info': return showInfo();
      case 'delete': return send({ type: 'delete', count: 1 });
      case 'toast': return send({ type: 'ssap', cmd: 'toast', message: 'Hola desde el mando web 👋' });
      default: return send({ type });
    }
  }

  function actionFor(el) {
    if (el.dataset.btn) return () => send({ type: 'button', name: el.dataset.btn });
    if (el.dataset.act) return () => runAct(el.dataset.act, el);
    return null;
  }

  // Pulsación con vibración y autorepetición (mantener pulsado) en volumen, canales y flechas
  $$('[data-btn],[data-act]').forEach((el) => {
    const fn = actionFor(el);
    if (!fn) return;
    let timer = null, rep = null, fired = false;
    const stop = () => { clearTimeout(timer); clearInterval(rep); timer = rep = null; el.classList.remove('pressed'); };
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      el.classList.add('pressed');
      fired = false;
      if (el.hasAttribute('data-repeat')) {
        buzz(); fn(); fired = true;
        timer = setTimeout(() => { rep = setInterval(() => { buzz(10); fn(); }, 180); }, 450);
      }
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => el.addEventListener(ev, stop));
    el.addEventListener('click', (e) => {
      e.preventDefault();
      if (fired) { fired = false; return; }
      if (el.dataset.confirm && !confirm(el.dataset.confirm)) return;
      buzz();
      fn();
    });
  });

  // ---------- Pestañas ----------
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + t.dataset.tab));
    localStorage.setItem('tab', t.dataset.tab);
  }));
  const savedTab = localStorage.getItem('tab');
  if (savedTab) { const t = $(`.tab[data-tab="${savedTab}"]`); if (t) t.click(); }

  // ---------- Hoja inferior ----------
  function openSheet(title, html) {
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = html;
    $('#sheet').classList.remove('hidden');
  }
  const closeSheet = () => $('#sheet').classList.add('hidden');
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function showInputs() {
    openSheet('Entradas', '<p class="note">Cargando…</p>');
    const r = await send({ type: 'inputs' });
    if (!r.ok) return openSheet('Entradas', `<p class="note">No se pudo leer la lista: ${esc(r.error)}</p>`);
    const items = [{ id: '__livetv', label: 'TV (Live TV)', connected: true }, ...r.data.devices];
    openSheet('Entradas', '<div class="list">' + items.map((d) =>
      `<button class="b ${d.connected === false ? 'off' : ''}" data-input="${esc(d.id)}">${esc(d.label)}${d.connected === false ? ' <small>(sin señal)</small>' : ''}</button>`).join('') + '</div>');
    $$('[data-input]', $('#sheetBody')).forEach((b) => b.addEventListener('click', async () => {
      buzz();
      const id = b.dataset.input;
      const res = id === '__livetv' ? await send({ type: 'liveTv' }) : await send({ type: 'input', id });
      if (res.ok) closeSheet();
    }));
  }

  async function loadApps() {
    const list = $('#appsList');
    list.innerHTML = '<p class="note">Cargando…</p>';
    const r = await send({ type: 'apps' });
    if (!r.ok) { list.innerHTML = `<p class="note">${esc(r.error)}</p>`; return; }
    list.innerHTML = r.data.apps.map((a) => `<button class="b" data-app="${esc(a.id)}">${esc(a.title)}</button>`).join('');
    $$('[data-app]', list).forEach((b) => b.addEventListener('click', () => { buzz(); send({ type: 'launch', id: b.dataset.app }); }));
  }

  function showInfo() {
    const s = status;
    const lw = s.lastWol ? new Date(s.lastWol.at).toLocaleTimeString('es-ES') + ` (${s.lastWol.sent} paquetes${s.lastWol.errors && s.lastWol.errors.length ? ', errores: ' + s.lastWol.errors.join('; ') : ''})` : '—';
    openSheet('Conexión', `
      <div class="kv">
        <span>Estado</span><span>${esc(STATE_TXT[s.state] || s.state)} ${s.detail ? '· ' + esc(s.detail) : ''}</span>
        <span>TV</span><span>${esc(s.url)}</span>
        <span>Modelo</span><span>${esc(s.model || '—')}</span>
        <span>Firmware</span><span>${esc(s.firmware || '—')}</span>
        <span>Emparejado</span><span>${s.paired ? 'Sí (client-key guardada)' : 'No'}</span>
        <span>MAC (WoL)</span><span>${esc((s.macs || []).join(', ') || 'ninguna')} <small>(${esc(s.macSource)})</small></span>
        <span>Último WoL</span><span>${esc(lw)}</span>
      </div>
      <div class="row r2">
        <button class="b sm" id="btnRecon">Reconectar</button>
        <button class="b sm" id="btnToast">Aviso de prueba</button>
      </div>
      <p class="note">El encendido usa Wake-on-LAN. En esta TV (webOS 2.0, 2015) por Wi-Fi suele funcionar solo durante unos minutos tras apagarla, o no funcionar. Detalles en el README.</p>`);
    $('#btnRecon').onclick = () => { send({ type: 'reconnect' }); closeSheet(); };
    $('#btnToast').onclick = () => send({ type: 'ssap', cmd: 'toast', message: 'Hola desde el mando web 👋' });
  }

  // ---------- Texto ----------
  $('#textForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('#textIn');
    if (!inp.value) return send({ type: 'enter' });
    const r = await send({ type: 'text', text: inp.value });
    if (r.ok) { buzz(); inp.value = ''; }
  });

  // ---------- Touchpad ----------
  const pad = $('#touchpad');
  const pts = new Map();
  let acc = { dx: 0, dy: 0 }, moved = 0, startT = 0, lastFlush = 0, maxPts = 0;
  const sens = () => Number($('#sens').value) || 1.8;
  $('#sens').value = localStorage.getItem('sens') || $('#sens').value;
  $('#sens').addEventListener('change', (e) => localStorage.setItem('sens', e.target.value));
  function flush(scroll) {
    if (!acc.dx && !acc.dy) return;
    fire(scroll ? { type: 'scroll', dx: acc.dx, dy: acc.dy } : { type: 'move', dx: acc.dx, dy: acc.dy });
    acc = { dx: 0, dy: 0 };
  }
  pad.addEventListener('pointerdown', (e) => {
    pad.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { moved = 0; startT = Date.now(); maxPts = 1; }
    maxPts = Math.max(maxPts, pts.size);
    pad.classList.add('active');
  });
  pad.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (pts.size >= 2) {
      // desplazamiento: solo cuenta un dedo para no duplicar
      if (e.pointerId !== [...pts.keys()][0]) return;
      acc.dx += dx; acc.dy += dy;
    } else {
      acc.dx += dx * sens(); acc.dy += dy * sens();
    }
    const now = Date.now();
    if (now - lastFlush > 25) { lastFlush = now; flush(pts.size >= 2); }
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size) return;
    flush(maxPts >= 2);
    pad.classList.remove('active');
    if (maxPts === 1 && moved < 8 && Date.now() - startT < 300) { buzz(); fire({ type: 'click' }); }
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);

  renderStatus();
  connectWs();
})();
