/* Pantalla de inicio. ES5, mando de 5 vías, vista previa en el navegador. */
(function () {
  var Model = window.LauncherModel;
  var Luna = window.LauncherLuna;
  var Nav = window.LauncherNav;
  var Glyphs = window.LauncherGlyphs;

  var KEY_LEFT = 37;
  var KEY_UP = 38;
  var KEY_RIGHT = 39;
  var KEY_DOWN = 40;
  var KEY_ENTER = 13;
  var KEY_ENTER_ALT = 10;
  var KEY_BACK = 461;
  var KEY_ESC = 27;
  var KEY_BACKSPACE = 8;
  var KEY_RED = 403;
  var KEY_BLUE = 406;

  var state = {
    preview: true,
    apps: [],
    appsKnown: false,
    appsError: '',
    appsVia: '',
    inputs: Model.defaultInputs(),
    inputsVia: 'default',
    inputsError: '',
    focusId: 'app:youtube',
    returnFocus: 'app:youtube',
    overlay: null,
    debug: false,
    log: [],
    token: 0,
    hm: ''
  };

  var lock = {};
  var toastTimer = null;
  var client = null;

  function $(id) { return document.getElementById(id); }

  function overlayOpen() {
    return !$('overlay').classList.contains('hidden');
  }

  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2800);
  }

  function fit() {
    var stage = $('stage');
    var sw = window.innerWidth || document.documentElement.clientWidth || 1280;
    var sh = window.innerHeight || document.documentElement.clientHeight || 720;
    var s = Math.min(sw / 1280, sh / 720);
    if (!(s > 0)) s = 1;
    if (s > 0.99 && s < 1.01 && Math.abs(sw - 1280) < 8 && Math.abs(sh - 720) < 8) {
      stage.style.left = '0px';
      stage.style.top = '0px';
      stage.style.webkitTransform = 'none';
      stage.style.transform = 'none';
      return;
    }
    var x = Math.floor((sw - 1280 * s) / 2);
    var y = Math.floor((sh - 720 * s) / 2);
    var t = 'scale(' + s + ')';
    stage.style.left = x + 'px';
    stage.style.top = y + 'px';
    stage.style.webkitTransformOrigin = '0 0';
    stage.style.transformOrigin = '0 0';
    stage.style.webkitTransform = t;
    stage.style.transform = t;
  }

  function tick() {
    var now = new Date();
    var clock = Model.formatClock(now);
    if (clock.hm === state.hm) return;
    state.hm = clock.hm;
    $('clock').textContent = clock.hm;
    $('date-line').textContent = clock.dateLine;
    $('greet').textContent = Model.greet(now.getHours());
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function inputColor(id) {
    if (id === 'TV') return '#c6a15a';
    if (String(id).indexOf('HDMI_') === 0) return '#3d7ea6';
    if (id === 'AV_1') return '#8a6a4a';
    if (String(id).indexOf('AV') === 0) return '#6e5b48';
    if (String(id).indexOf('COMP') === 0) return '#5f7a55';
    if (String(id).indexOf('SCART') === 0) return '#7a6558';
    return '#6a6258';
  }

  function makeTile(spec) {
    var el = document.createElement('div');
    el.className = 'tile focusable';
    el.setAttribute('data-focus-id', spec.focusId);
    el.setAttribute('data-kind', spec.kind);
    if (spec.id) el.setAttribute('data-id', spec.id);
    if (spec.appId) el.setAttribute('data-app', spec.appId);
    el.setAttribute('data-title', spec.title);
    var bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.background = spec.color || '#8a8176';
    el.appendChild(bar);
    var glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.innerHTML = spec.glyph || '';
    el.appendChild(glyph);
    var title = document.createElement('span');
    title.className = 'tile-title';
    title.textContent = spec.title;
    el.appendChild(title);
    var sub = document.createElement('span');
    sub.className = 'tile-sub';
    sub.textContent = spec.subtitle || '';
    el.appendChild(sub);
    if (spec.dot) {
      var dot = document.createElement('span');
      dot.className = 'dot ' + spec.dot;
      el.appendChild(dot);
    }
    return el;
  }

  function renderApps() {
    var box = $('apps');
    clear(box);
    var tiles = Model.resolveCurated(state.apps, state.appsKnown);
    var compact = (tiles.length + 1) > 6;
    var i;
    for (i = 0; i < tiles.length; i++) {
      var spec = tiles[i];
      var tile = makeTile({
        focusId: 'app:' + spec.key,
        kind: 'app',
        id: spec.id,
        title: spec.title,
        subtitle: spec.confirmed || !state.appsKnown ? spec.subtitle : 'No está en la lista',
        color: spec.color,
        glyph: Glyphs.forKey(spec.key, spec.color)
      });
      if (compact) tile.className += ' compact';
      box.appendChild(tile);
    }
    var all = makeTile({
      focusId: 'app:all',
      kind: 'all',
      title: 'Todas',
      subtitle: 'Aplicaciones',
      color: '#6a6258',
      glyph: Glyphs.forKey('all', '#6a6258')
    });
    if (compact) all.className += ' compact';
    box.appendChild(all);
  }

  function renderInputs() {
    var box = $('inputs');
    clear(box);
    var row = Model.rowItems(state.inputs, 6);
    var i;
    for (i = 0; i < row.shown.length; i++) {
      var item = row.shown[i];
      var color = inputColor(item.id);
      var dot = '';
      if (item.connected === true) dot = 'on';
      else if (item.connected === false) dot = 'off';
      box.appendChild(makeTile({
        focusId: 'input:' + item.id,
        kind: 'input',
        id: item.id,
        appId: item.appId,
        title: item.label,
        subtitle: item.subtitle || 'Entrada',
        color: color,
        glyph: Glyphs.forInput(item.id, color),
        dot: dot
      }));
    }
    if (row.more) {
      box.appendChild(makeTile({
        focusId: 'input:more',
        kind: 'more',
        title: 'Más',
        subtitle: 'Entradas',
        color: '#6a6258',
        glyph: Glyphs.forKey('more', '#6a6258')
      }));
    }
  }

  function renderNow() {
    var copy = Model.nowCopy(state.inputs);
    $('now-title').textContent = copy.headline;
    $('now-detail').textContent = copy.detail;
  }

  function renderMode() {
    var text = '';
    if (state.preview) text = 'Vista previa';
    else if (state.appsError) text = 'Sin lista de la tele';
    $('mode').textContent = text;
  }

  function renderOverlay() {
    var overlay = $('overlay');
    var grid = $('overlay-grid');
    clear(grid);
    if (!state.overlay) {
      overlay.classList.add('hidden');
      return;
    }
    overlay.classList.remove('hidden');
    $('overlay-title').textContent = state.overlay.title;
    $('overlay-sub').textContent = state.overlay.sub;
    if (!state.overlay.items.length) {
      var empty = document.createElement('p');
      empty.id = 'overlay-empty';
      empty.textContent = 'No se pudo leer la lista de aplicaciones.';
      grid.appendChild(empty);
      return;
    }
    var i;
    for (i = 0; i < state.overlay.items.length; i++) {
      grid.appendChild(makeTile(state.overlay.items[i]));
    }
  }

  function renderDebug() {
    var el = $('debug');
    if (!state.debug) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    var lines = state.log.slice(state.log.length - 8);
    var head = 'apps: ' + (state.appsVia || '—') + (state.appsError ? ' · ' + state.appsError : '') +
      '\nentradas: ' + (state.inputsVia || '—') + (state.inputsError ? ' · ' + state.inputsError : '');
    el.textContent = head + (lines.length ? '\n' + lines.join('\n') : '');
  }

  function clearFocus() {
    var nodes = document.querySelectorAll('.is-focused');
    var i;
    for (i = 0; i < nodes.length; i++) nodes[i].classList.remove('is-focused');
  }

  function focusRoot() {
    return overlayOpen() ? $('overlay') : $('stage');
  }

  function isInside(node, ancestor) {
    while (node) {
      if (node === ancestor) return true;
      node = node.parentNode;
    }
    return false;
  }

  function isShown(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  function focusables() {
    var root = focusRoot();
    var nodes = root.querySelectorAll('.focusable');
    var overlay = $('overlay');
    var out = [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!overlayOpen() && isInside(n, overlay)) continue;
      if (!isShown(n)) continue;
      out.push(n);
    }
    return out;
  }

  function ensureVisible(el) {
    var grid = $('overlay-grid');
    if (!grid || !overlayOpen()) return;
    var gr = grid.getBoundingClientRect();
    var er = el.getBoundingClientRect();
    if (er.bottom > gr.bottom) grid.scrollTop += (er.bottom - gr.bottom) + 12;
    else if (er.top < gr.top) grid.scrollTop -= (gr.top - er.top) + 12;
  }

  function setFocused(el) {
    if (!el) return;
    clearFocus();
    el.classList.add('is-focused');
    state.focusId = el.getAttribute('data-focus-id');
    if (overlayOpen()) ensureVisible(el);
  }

  function findByFocusId(id) {
    var root = focusRoot();
    var nodes = root.querySelectorAll('[data-focus-id]');
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-focus-id') === id && isShown(nodes[i])) return nodes[i];
    }
    return null;
  }

  function restoreFocus() {
    var el = findByFocusId(state.focusId);
    var items = focusables();
    if (!el && items.length) el = items[0];
    if (el) setFocused(el);
  }

  function render() {
    renderApps();
    renderInputs();
    renderNow();
    renderMode();
    renderOverlay();
    renderDebug();
    restoreFocus();
  }

  function trace(entry) {
    var line = (entry.ok ? 'ok  ' : 'mal ') + entry.uri.replace(/^luna:\/\//, '');
    if (!entry.ok && entry.error) line += ' · ' + entry.error;
    state.log.push(line);
    if (state.log.length > 40) state.log = state.log.slice(state.log.length - 40);
    renderDebug();
  }

  function loadAll() {
    var token = ++state.token;
    Luna.loadHome(client, function (home) {
      if (token !== state.token) return;
      state.apps = home.apps;
      state.appsKnown = home.appsKnown;
      state.appsError = home.appsError;
      state.appsVia = home.appsVia;
      state.inputs = home.inputs;
      state.inputsVia = home.inputsVia;
      state.inputsError = home.inputsError;
      render();
      document.body.setAttribute('data-ready', '1');
      if (!state.preview && (home.appsError || home.inputsError)) {
        toast('No se pudo leer todo de la tele. Se muestran los accesos fijos.');
      }
    });
  }

  function appColor(app) {
    var id = String(app.id || '');
    if (id.indexOf('youtube') === 0) return '#c4302b';
    if (id === 'netflix' || id === 'netflix-nrdp') return '#b20710';
    return Glyphs.colorForId(id);
  }

  function galleryItems() {
    var apps = Model.gallery(state.apps);
    var items = [];
    var i;
    for (i = 0; i < apps.length; i++) {
      var app = apps[i];
      items.push({
        focusId: 'all:' + app.id,
        kind: 'app',
        id: app.id,
        title: app.title,
        subtitle: 'Aplicación',
        color: appColor(app),
        glyph: Glyphs.forApp(app)
      });
    }
    return items;
  }

  function inputItems() {
    var items = [];
    var i;
    for (i = 0; i < state.inputs.length; i++) {
      var item = state.inputs[i];
      var color = inputColor(item.id);
      items.push({
        focusId: 'overlay-input:' + item.id,
        kind: 'input',
        id: item.id,
        appId: item.appId,
        title: item.label,
        subtitle: item.subtitle || 'Entrada',
        color: color,
        glyph: Glyphs.forInput(item.id, color)
      });
    }
    return items;
  }

  function openOverlay(title, sub, items) {
    state.returnFocus = state.focusId;
    state.overlay = { title: title, sub: sub, items: items };
    state.focusId = items.length ? items[0].focusId : state.focusId;
    renderOverlay();
    restoreFocus();
  }

  function closeOverlay() {
    state.overlay = null;
    state.focusId = state.returnFocus || 'app:youtube';
    renderOverlay();
    restoreFocus();
  }

  function launchApp(id, title) {
    toast('Abriendo ' + title + '…');
    client.launch(id, null, function (err) {
      if (err) {
        toast('No se pudo abrir ' + title + '. ' + Model.errText(err));
        return;
      }
      if (state.preview) toast('Vista previa: ' + title + ' no se abre en el ordenador.');
    });
  }

  function switchTo(inputId, appId, title) {
    var id = appId || (inputId === 'TV' ? 'com.webos.app.livetv' : '');
    if (!id) {
      toast('No se pudo cambiar a ' + title + '.');
      return;
    }
    launchApp(id, title);
  }

  function activate(el) {
    if (!el) return;
    var kind = el.getAttribute('data-kind');
    var title = el.getAttribute('data-title') || '';
    if (kind === 'all') {
      var items = galleryItems();
      var n = items.length;
      var sub = n ? (n + (n === 1 ? ' aplicación' : ' aplicaciones')) : 'Sin lista';
      openOverlay('Todas las aplicaciones', sub, items);
      return;
    }
    if (kind === 'more') {
      openOverlay('Entradas', 'Atrás para cerrar', inputItems());
      return;
    }
    if (kind === 'app') {
      launchApp(el.getAttribute('data-id'), title);
      return;
    }
    if (kind === 'input') {
      switchTo(el.getAttribute('data-id'), el.getAttribute('data-app'), title);
    }
  }

  function move(dir) {
    var items = focusables();
    if (!items.length) return;
    var rects = [];
    var idx = -1;
    var i;
    for (i = 0; i < items.length; i++) {
      rects.push(items[i].getBoundingClientRect());
      if (items[i].classList.contains('is-focused')) idx = i;
    }
    var next = Nav.pick(rects, idx, dir);
    if (next >= 0) setFocused(items[next]);
  }

  function onBack() {
    if (overlayOpen()) {
      closeOverlay();
      return;
    }
    if (state.preview) {
      toast('En la tele, Atrás cierra esta app y vuelve al inicio del sistema.');
      return;
    }
    try {
      if (window.PalmSystem && window.PalmSystem.platformBack) {
        window.PalmSystem.platformBack();
        return;
      }
    } catch (e) {}
    try { window.close(); } catch (e2) {}
  }

  function onKeyDown(e) {
    var code = e.keyCode || e.which || 0;
    var arrows = code === KEY_LEFT || code === KEY_UP || code === KEY_RIGHT || code === KEY_DOWN;
    var ok = code === KEY_ENTER || code === KEY_ENTER_ALT;
    var back = code === KEY_BACK || code === KEY_ESC || code === KEY_BACKSPACE;
    var red = code === KEY_RED || (state.preview && code === 82);
    var blue = code === KEY_BLUE || (state.preview && code === 68);
    if (!arrows && !ok && !back && !red && !blue) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    if (!arrows && lock[code]) return;
    if (!arrows) lock[code] = true;
    if (code === KEY_LEFT) move('left');
    else if (code === KEY_RIGHT) move('right');
    else if (code === KEY_UP) move('up');
    else if (code === KEY_DOWN) move('down');
    else if (ok) activate(document.querySelector('.is-focused'));
    else if (back) onBack();
    else if (red) { toast('Actualizando…'); loadAll(); }
    else if (blue) { state.debug = !state.debug; renderDebug(); }
  }

  function onKeyUp(e) {
    var code = e.keyCode || e.which || 0;
    lock[code] = false;
  }

  function classText(node) {
    if (!node) return '';
    if (typeof node.className === 'string') return node.className;
    if (node.getAttribute) return node.getAttribute('class') || '';
    return '';
  }

  function tileFrom(node) {
    while (node && node !== document) {
      if (classText(node).indexOf('focusable') >= 0) return node;
      node = node.parentNode;
    }
    return null;
  }

  function onClick(e) {
    var el = tileFrom(e.target);
    if (!el || !isShown(el)) return;
    setFocused(el);
    activate(el);
  }

  function onVis() {
    var hidden = document.hidden === true || document.webkitHidden === true;
    if (!hidden && !overlayOpen()) loadAll();
  }

  function boot() {
    state.preview = Luna.detectPreview();
    client = Luna.createClient({ onTrace: trace });
    fit();
    tick();
    setInterval(tick, 1000);
    render();
    loadAll();
    window.addEventListener('resize', fit, false);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('click', onClick, false);
    document.addEventListener('visibilitychange', onVis, false);
    document.addEventListener('webkitvisibilitychange', onVis, false);
    document.addEventListener('webOSRelaunch', function () {
      closeOverlay();
      loadAll();
    }, false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, false);
  } else {
    boot();
  }
})();
