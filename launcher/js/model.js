/*
 * Datos del lanzador, sin DOM. ES5 a propósito: el WebKit de webOS 2 (~538)
 * no tiene let/const, Promise, fetch ni Array.includes.
 */
(function (root) {
  var APP_ID = 'com.christiangonper.launcher';

  var CURATED = [
    {
      key: 'youtube',
      title: 'YouTube',
      subtitle: 'Vídeo',
      ids: ['youtube.leanback.v4', 'youtube.leanback.v3', 'youtube.leanback'],
      color: '#c4302b'
    },
    {
      key: 'livetv',
      title: 'Live TV',
      subtitle: 'Antena',
      ids: ['com.webos.app.livetv'],
      fixed: true,
      color: '#c6a15a'
    },
    {
      key: 'netflix',
      title: 'Netflix',
      subtitle: 'Vídeo',
      ids: ['netflix', 'netflix-nrdp'],
      optional: true,
      color: '#b20710'
    },
    {
      key: 'store',
      title: 'LG Store',
      subtitle: 'Tienda',
      ids: ['com.webos.app.discovery', 'com.webos.app.store', 'com.lge.app.store'],
      color: '#c45c26'
    },
    {
      key: 'settings',
      title: 'Ajustes',
      subtitle: 'Sistema',
      ids: ['com.palm.app.settings', 'com.webos.app.settings'],
      fixed: true,
      color: '#8d8a84'
    },
    {
      key: 'hb',
      title: 'Homebrew',
      subtitle: 'Channel',
      ids: ['org.webosbrew.hbchannel'],
      color: '#2f8f72'
    }
  ];

  var DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function greet(hour) {
    if (hour < 6 || hour >= 20) return 'Buenas noches';
    if (hour < 12) return 'Buenos días';
    return 'Buenas tardes';
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function formatClock(date) {
    return {
      hm: pad2(date.getHours()) + ':' + pad2(date.getMinutes()),
      dateLine: DAYS[date.getDay()] + ', ' + date.getDate() + ' de ' + MONTHS[date.getMonth()]
    };
  }

  function errText(err) {
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (err.errorText) return String(err.errorText);
    if (err.message) return String(err.message);
    if (err.error) return String(err.error);
    return 'error';
  }

  function appsFrom(res) {
    var list = (res && (res.launchPoints || res.apps)) || [];
    var out = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p) continue;
      var id = p.id || p.appId;
      if (!id) continue;
      if (p.visible === false) continue;
      out.push({
        id: String(id),
        title: String(p.title || p.name || id)
      });
    }
    return out;
  }

  function indexById(apps) {
    var map = {};
    var i;
    for (i = 0; i < apps.length; i++) map[apps[i].id] = apps[i];
    return map;
  }

  function resolveCurated(apps, appsKnown) {
    var map = indexById(apps || []);
    var out = [];
    var i, j;
    for (i = 0; i < CURATED.length; i++) {
      var spec = CURATED[i];
      var found = null;
      for (j = 0; j < spec.ids.length; j++) {
        if (map[spec.ids[j]]) { found = spec.ids[j]; break; }
      }
      if (!found && spec.optional && appsKnown) continue;
      if (!found && spec.optional && !appsKnown) continue;
      out.push({
        key: spec.key,
        title: spec.title,
        subtitle: spec.subtitle,
        id: found || spec.ids[0],
        color: spec.color,
        confirmed: !!found || !!spec.fixed
      });
    }
    return out;
  }

  function fold(s) {
    return String(s || '').toLowerCase()
      .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
      .replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ü/g, 'u').replace(/ñ/g, 'n');
  }

  function isInputApp(id) {
    return /^com\.webos\.app\.(hdmi\d*|externalinput\..+|livetv)$/.test(id || '');
  }

  function gallery(apps) {
    var out = [];
    var i;
    for (i = 0; i < (apps || []).length; i++) {
      var app = apps[i];
      if (!app || !app.id) continue;
      if (app.id === APP_ID) continue;
      if (isInputApp(app.id)) continue;
      out.push(app);
    }
    out.sort(function (a, b) {
      var at = fold(a.title);
      var bt = fold(b.title);
      if (at < bt) return -1;
      if (at > bt) return 1;
      return 0;
    });
    return out;
  }

  function asBool(v) {
    if (v === true || v === 'true' || v === 'connected' || v === 'connect') return true;
    if (v === false || v === 'false' || v === 'disconnected' || v === 'disconnect') return false;
    return undefined;
  }

  function tvInput() {
    return { id: 'TV', label: 'TV', appId: 'com.webos.app.livetv', subtitle: 'Antena' };
  }

  function avLabel(n) {
    if (String(n || '1') === '1') return 'AV1 (SCART)';
    return 'AV' + n;
  }

  function analog(kind, n) {
    if (kind === 'av') {
      var num = n || '1';
      return { id: 'AV_' + num, label: avLabel(num), appId: 'com.webos.app.externalinput.av' + num };
    }
    if (kind === 'scart') {
      return { id: 'SCART_1', label: 'Euroconector', appId: 'com.webos.app.externalinput.scart' };
    }
    return { id: 'COMP_1', label: 'Componentes', appId: 'com.webos.app.externalinput.component' };
  }

  function normalizeInput(rawId, appId, label) {
    var id = String(rawId || '');
    var app = String(appId || '');
    var src = String(label || '');
    var m;
    if (/livetv/i.test(app) || /livetv/i.test(id) || /^tv$/i.test(id)) {
      return { id: 'TV', label: 'TV', appId: 'com.webos.app.livetv' };
    }
    m = /^HDMI[\s_-]?(\d+)$/i.exec(id) || /^com\.webos\.app\.hdmi(\d+)$/.exec(app) || /^com\.webos\.app\.hdmi(\d+)$/.exec(id);
    if (!m && src) m = /^HDMI[\s_-]?(\d+)$/i.exec(src);
    if (m) {
      return { id: 'HDMI_' + m[1], label: 'HDMI ' + m[1], appId: 'com.webos.app.hdmi' + m[1] };
    }
    m = /^com\.webos\.app\.externalinput\.(av|scart|component|comp)(\d*)$/.exec(app) ||
      /^com\.webos\.app\.externalinput\.(av|scart|component|comp)(\d*)$/.exec(id);
    if (m) return analog(m[1], m[2]);
    m = /^AV[\s_-]?(\d+)$/i.exec(id);
    if (m) return analog('av', m[1]);
    if (/^SCART[\s_-]?\d*$/i.test(id)) return analog('scart', '');
    if (/^(COMP|COMPONENT)[\s_-]?\d*$/i.test(id)) return analog('component', '');
    if (!id && !app) return null;
    return { id: id || app, label: src || id || app, appId: app };
  }

  function subtitleFor(item) {
    if (item.id === 'TV') return 'Antena';
    if (item.connected === true) return 'Con señal';
    if (item.connected === false) return 'Sin señal';
    return 'Entrada';
  }

  function inputsFrom(res) {
    var list = (res && (res.devices || res.deviceList || res.inputList || res.externalInputList || res.devicesList)) || [];
    var out = [];
    var seen = {};
    var i;
    for (i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d) continue;
      var norm = normalizeInput(d.id || d.inputId || '', d.appId || '', d.label || d.name || '');
      if (!norm || seen[norm.id]) continue;
      seen[norm.id] = true;
      var connected = asBool(d.connected);
      if (connected === undefined) connected = asBool(d.connect);
      if (connected === undefined) connected = asBool(d.connectStatus || d.deviceStatus);
      norm.connected = connected;
      norm.current = !!(d.current === true || d.activated === true || d.active === true || d.activate === true);
      norm.subtitle = subtitleFor(norm);
      out.push(norm);
    }
    return sortInputs(out);
  }

  function inputsFromApps(apps) {
    var out = [];
    var seen = {};
    var i;
    for (i = 0; i < (apps || []).length; i++) {
      var app = apps[i];
      if (!app || !isInputApp(app.id) || app.id === 'com.webos.app.livetv') continue;
      var norm = normalizeInput('', app.id, app.title);
      if (!norm || seen[norm.id]) continue;
      seen[norm.id] = true;
      norm.subtitle = subtitleFor(norm);
      out.push(norm);
    }
    return sortInputs(out);
  }

  function sortInputs(list) {
    function rank(item) {
      if (item.id === 'TV') return [0, 0, ''];
      var m = /^HDMI_(\d+)$/.exec(item.id);
      if (m) return [1, parseInt(m[1], 10), ''];
      return [2, 0, fold(item.label)];
    }
    return list.slice().sort(function (a, b) {
      var ra = rank(a);
      var rb = rank(b);
      if (ra[0] !== rb[0]) return ra[0] - rb[0];
      if (ra[1] !== rb[1]) return ra[1] - rb[1];
      if (ra[2] < rb[2]) return -1;
      if (ra[2] > rb[2]) return 1;
      return 0;
    });
  }

  function withTv(inputs) {
    var i;
    var list = inputs ? inputs.slice() : [];
    for (i = 0; i < list.length; i++) {
      if (list[i].id === 'TV') return sortInputs(list);
    }
    list.unshift(tvInput());
    return sortInputs(list);
  }

  function defaultInputs() {
    return withTv([
      { id: 'HDMI_1', label: 'HDMI 1', appId: 'com.webos.app.hdmi1', subtitle: 'Entrada' },
      { id: 'HDMI_2', label: 'HDMI 2', appId: 'com.webos.app.hdmi2', subtitle: 'Entrada' },
      { id: 'AV_1', label: 'AV1 (SCART)', appId: 'com.webos.app.externalinput.av1', subtitle: 'Entrada' },
      { id: 'AV_2', label: 'AV2', appId: 'com.webos.app.externalinput.av2', subtitle: 'Entrada' },
      { id: 'COMP_1', label: 'Componentes', appId: 'com.webos.app.externalinput.component', subtitle: 'Entrada' }
    ]);
  }

  function nowCopy(inputs) {
    var current = null;
    var signal = null;
    var i;
    for (i = 0; i < (inputs || []).length; i++) {
      var item = inputs[i];
      if (item.current && item.id !== 'TV') current = item;
      if (item.connected === true && item.id !== 'TV' && !signal) signal = item;
    }
    if (current) {
      return { headline: current.label, detail: 'Entrada activa.' };
    }
    if (signal) {
      return { headline: 'Sin reproducción', detail: signal.label + ' tiene señal.' };
    }
    return { headline: 'Sin reproducción', detail: 'Elige una aplicación o una entrada.' };
  }

  function rowItems(inputs, max) {
    var all = inputs && inputs.length ? inputs : defaultInputs();
    if (all.length <= max) return { shown: all, more: false };
    return { shown: all.slice(0, max - 1), more: true };
  }

  var api = {
    APP_ID: APP_ID,
    CURATED: CURATED,
    greet: greet,
    formatClock: formatClock,
    errText: errText,
    appsFrom: appsFrom,
    resolveCurated: resolveCurated,
    gallery: gallery,
    isInputApp: isInputApp,
    inputsFrom: inputsFrom,
    inputsFromApps: inputsFromApps,
    withTv: withTv,
    defaultInputs: defaultInputs,
    nowCopy: nowCopy,
    rowItems: rowItems,
    normalizeInput: normalizeInput
  };

  root.LauncherModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
