/*
 * Llamadas luna:// desde una app web de webOS TV 2.0.
 *
 * En el runtime del televisor el puente es PalmServiceBridge (el mismo que
 * envuelve webOSTV.js). No existe en un navegador de escritorio: ahí se usa
 * un mock para poder desarrollar y hacer capturas.
 *
 * Nombres de servicio en webOS TV 2 (2015), no los de webOS OSE:
 *   - com.webos.applicationManager  (listLaunchPoints, listApps, launch)
 *   - com.webos.service.applicationmanager  es el alias posterior; se prueba
 *     por si el firmware lo tiene, y se abandona si responde error.
 * La API pública SSAP del mando (tv/getExternalInputList, tv/switchInput) no
 * es un servicio luna. En la app se prueban los nombres internos que usa el
 * firmware y, si fallan, se abre la app de la entrada (com.webos.app.hdmiN),
 * que es el recurso que ya funciona en esta tele desde el mando SSAP.
 */
(function (root) {
  var MOCK_APPS = [
    { id: 'youtube.leanback.v4', title: 'YouTube', visible: true },
    { id: 'netflix', title: 'Netflix', visible: true },
    { id: 'com.webos.app.discovery', title: 'LG Content Store', visible: true },
    { id: 'com.webos.app.settings', title: 'Ajustes', visible: true },
    { id: 'org.webosbrew.hbchannel', title: 'Homebrew Channel', visible: true },
    { id: 'com.webos.app.browser', title: 'Navegador', visible: true },
    { id: 'com.webos.app.smartshare', title: 'SmartShare', visible: true },
    { id: 'com.webos.app.music', title: 'Música', visible: true },
    { id: 'com.webos.app.photovideo', title: 'Fotos y vídeo', visible: true },
    { id: 'com.webos.app.notificationcenter', title: 'Notificaciones', visible: true },
    { id: 'com.webos.app.livetv', title: 'Live TV', visible: true },
    { id: 'com.webos.app.hdmi1', title: 'HDMI 1', visible: true },
    { id: 'com.webos.app.hdmi2', title: 'HDMI 2', visible: true },
    { id: 'com.webos.app.externalinput.av1', title: 'AV', visible: true },
    { id: 'com.webos.app.externalinput.component1', title: 'Component', visible: true },
    { id: 'com.webos.app.externalinput.scart1', title: 'SCART', visible: true },
    { id: 'com.christiangonper.launcher', title: 'Inicio', visible: true },
    { id: 'com.webos.service.hidden', title: 'Oculta', visible: false }
  ];

  var MOCK_INPUTS = [
    { id: 'HDMI_1', label: 'HDMI1', connected: true, appId: 'com.webos.app.hdmi1' },
    { id: 'HDMI_2', label: 'HDMI2', connected: false, appId: 'com.webos.app.hdmi2' },
    { id: 'AV_1', label: 'AV', connected: false, appId: 'com.webos.app.externalinput.av1' },
    { id: 'COMP_1', label: 'Component', connected: false, appId: 'com.webos.app.externalinput.component1' },
    { id: 'SCART_1', label: 'SCART', connected: false, appId: 'com.webos.app.externalinput.scart1' }
  ];

  var APP_URIS = [
    'luna://com.webos.applicationManager/listLaunchPoints',
    'luna://com.webos.applicationManager/listApps',
    'luna://com.webos.service.applicationmanager/listLaunchPoints',
    'luna://com.webos.service.applicationmanager/listApps'
  ];

  var INPUT_URIS = [
    'luna://com.webos.service.tv.externaldevice/getExternalInputList',
    'luna://com.webos.service.tv.externaldevice/listDevices',
    'luna://com.webos.service.eim/getAllInputStatus'
  ];

  var LAUNCH_URIS = [
    'luna://com.webos.applicationManager/launch',
    'luna://com.webos.service.applicationmanager/launch'
  ];

  var SWITCH_URIS = [
    'luna://com.webos.service.tv.externaldevice/switchInput'
  ];

  function detectPreview(search, hasBridge) {
    var q = search;
    if (q == null) {
      try {
        q = (root.location && root.location.search) || '';
      } catch (e) {
        q = '';
      }
    }
    q = String(q);
    if (/[?&]preview=0(?:&|$)/.test(q)) return false;
    if (/[?&]preview=1(?:&|$)/.test(q)) return true;
    if (hasBridge != null) return !hasBridge;
    var bridge = false;
    try {
      bridge = !!(root.PalmServiceBridge || (root.webOS && root.webOS.service));
    } catch (e2) {
      bridge = false;
    }
    return !bridge;
  }

  function mockResult(uri, params) {
    if (uri.indexOf('/listLaunchPoints') >= 0) return { returnValue: true, launchPoints: MOCK_APPS };
    if (uri.indexOf('/listApps') >= 0) return { returnValue: true, apps: MOCK_APPS };
    if (uri.indexOf('getExternalInputList') >= 0 || uri.indexOf('/listDevices') >= 0) {
      return { returnValue: true, devices: MOCK_INPUTS };
    }
    if (uri.indexOf('getAllInputStatus') >= 0) return { returnValue: true, inputList: MOCK_INPUTS };
    if (uri.indexOf('/launch') >= 0) return { returnValue: true, id: params && params.id };
    if (uri.indexOf('switchInput') >= 0) return { returnValue: true, inputId: params && params.inputId };
    return { returnValue: false, errorText: 'uri desconocida en la vista previa', uri: uri };
  }

  function mockTransport(uri, params, cb) {
    var timer = setTimeout(function () {
      var res = mockResult(uri, params);
      if (res.returnValue === false) cb(res);
      else cb(null, res);
    }, 0);
    return function () { clearTimeout(timer); };
  }

  function splitUri(uri) {
    var noScheme = String(uri).replace(/^luna:\/\//, '');
    var slash = noScheme.lastIndexOf('/');
    return {
      service: 'luna://' + noScheme.slice(0, slash),
      method: noScheme.slice(slash + 1)
    };
  }

  var alive = [];

  function dropBridge(bridge) {
    var i;
    for (i = 0; i < alive.length; i++) {
      if (alive[i] === bridge) {
        alive.splice(i, 1);
        return;
      }
    }
  }

  function palmTransport(uri, params, cb) {
    if (root.webOS && root.webOS.service && root.webOS.service.request) {
      var parts = splitUri(uri);
      var handle;
      try {
        handle = root.webOS.service.request(parts.service, {
          method: parts.method,
          parameters: params || {},
          onSuccess: function (res) { cb(null, res || {}); },
          onFailure: function (err) { cb(err || { returnValue: false, errorText: 'fallo' }); }
        });
      } catch (e) {
        cb({ returnValue: false, errorText: (e && e.message) || String(e) });
      }
      return function () {
        try { if (handle && handle.cancel) handle.cancel(); } catch (e2) {}
      };
    }

    if (!root.PalmServiceBridge) {
      cb({ returnValue: false, errorText: 'PalmServiceBridge no está disponible' });
      return function () {};
    }

    var bridge;
    try {
      bridge = new root.PalmServiceBridge();
    } catch (e3) {
      cb({ returnValue: false, errorText: String(e3) });
      return function () {};
    }
    alive.push(bridge);
    var finished = false;
    bridge.onservicecallback = function (msg) {
      if (finished) return;
      finished = true;
      dropBridge(bridge);
      var res = msg;
      if (typeof msg === 'string') {
        try {
          res = JSON.parse(msg);
        } catch (e4) {
          cb({ returnValue: false, errorText: 'respuesta no JSON' });
          return;
        }
      }
      if (!res || typeof res !== 'object') {
        cb({ returnValue: false, errorText: 'respuesta vacía' });
        return;
      }
      cb(null, res);
    };
    try {
      bridge.call(uri, JSON.stringify(params || {}));
    } catch (e5) {
      finished = true;
      dropBridge(bridge);
      cb({ returnValue: false, errorText: String(e5) });
    }
    return function () {
      if (finished) return;
      finished = true;
      dropBridge(bridge);
      try { if (bridge.cancel) bridge.cancel(); } catch (e6) {}
    };
  }

  function defaultTransport(uri, params, cb) {
    if (detectPreview()) return mockTransport(uri, params, cb);
    return palmTransport(uri, params, cb);
  }

  function failed(res) {
    if (!res) return true;
    if (res.returnValue === false) return true;
    if (res.errorCode && res.returnValue !== true) return true;
    return false;
  }

  function createClient(opts) {
    opts = opts || {};
    var transport = opts.transport || defaultTransport;
    var timeoutMs = opts.timeoutMs || 2500;
    var onTrace = opts.onTrace || function () {};

    function call(uri, params, cb, ms) {
      var done = false;
      var started = (root.Date && Date.now) ? Date.now() : 0;
      var cancel = null;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        if (typeof cancel === 'function') cancel();
        var err = { returnValue: false, errorText: 'tiempo de espera', uri: uri };
        onTrace({ uri: uri, ok: false, error: err.errorText, ms: (Date.now() - started) });
        cb(err);
      }, ms || timeoutMs);
      cancel = transport(uri, params || {}, function (err, res) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err || failed(res)) {
          var bad = err || res;
          onTrace({ uri: uri, ok: false, error: (root.LauncherModel ? root.LauncherModel.errText(bad) : 'error'), ms: (Date.now() - started) });
          cb(bad);
          return;
        }
        onTrace({ uri: uri, ok: true, ms: (Date.now() - started) });
        cb(null, res);
      });
    }

    function chain(uris, params, useful, cb) {
      var i = 0;
      var lastErr = null;
      function next() {
        if (i >= uris.length) {
          cb(lastErr || { returnValue: false, errorText: 'sin servicio' });
          return;
        }
        var uri = uris[i];
        i += 1;
        call(uri, params, function (err, res) {
          if (!err && useful(res)) {
            cb(null, res, uri);
            return;
          }
          lastErr = err || { returnValue: false, errorText: 'respuesta vacía', uri: uri };
          next();
        });
      }
      next();
    }

    function listApps(cb) {
      chain(APP_URIS, {}, function (res) {
        var list = res && (res.launchPoints || res.apps);
        return !!(list && list.length);
      }, cb);
    }

    function listInputs(cb) {
      chain(INPUT_URIS, {}, function (res) {
        var list = res && (res.devices || res.inputList || res.externalInputList || res.devicesList);
        return !!(list && list.length);
      }, cb);
    }

    function launch(id, params, cb) {
      var body = { id: id };
      if (params) body.params = params;
      chain(LAUNCH_URIS, body, function () { return true; }, cb);
    }

    function switchInput(inputId, cb) {
      chain(SWITCH_URIS, { inputId: inputId }, function () { return true; }, cb);
    }

    return {
      call: call,
      listApps: listApps,
      listInputs: listInputs,
      launch: launch,
      switchInput: switchInput
    };
  }

  function loadHome(client, cb) {
    var Model = root.LauncherModel;
    var left = 2;
    var appsOut = null;
    var inputsOut = null;

    function finish() {
      left -= 1;
      if (left) return;
      var apps = appsOut.apps;
      var inputs = inputsOut.inputs;
      var inputsVia = inputsOut.via;
      if (!inputs.length) {
        inputs = Model.inputsFromApps(apps);
        if (inputs.length) inputsVia = 'apps';
      }
      if (!inputs.length) {
        inputs = Model.defaultInputs();
        inputsVia = 'default';
      } else {
        inputs = Model.withTv(inputs);
      }
      cb({
        apps: apps,
        appsKnown: appsOut.known,
        appsError: appsOut.error,
        appsVia: appsOut.via,
        inputs: inputs,
        inputsVia: inputsVia,
        inputsError: (inputsOut.error && inputsVia === 'default') ? inputsOut.error : ''
      });
    }

    client.listApps(function (err, res, via) {
      appsOut = {
        apps: (!err && res) ? Model.appsFrom(res) : [],
        known: !err && !!res,
        error: err ? Model.errText(err) : '',
        via: via || ''
      };
      finish();
    });
    client.listInputs(function (err, res, via) {
      inputsOut = {
        inputs: (!err && res) ? Model.inputsFrom(res) : [],
        error: err ? Model.errText(err) : '',
        via: via || ''
      };
      finish();
    });
  }

  var api = {
    MOCK_APPS: MOCK_APPS,
    MOCK_INPUTS: MOCK_INPUTS,
    APP_URIS: APP_URIS,
    INPUT_URIS: INPUT_URIS,
    detectPreview: detectPreview,
    mockResult: mockResult,
    mockTransport: mockTransport,
    createClient: createClient,
    loadHome: loadHome,
    splitUri: splitUri
  };

  root.LauncherLuna = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
