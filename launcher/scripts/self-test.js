#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const model = require('../js/model');
const nav = require('../js/nav');
const luna = require('../js/luna');
const { writeIcons } = require('./make-icons');
const { buildIpk, APP_FILES } = require('./pack-ipk');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ok  ' + name);
  } catch (err) {
    failed += 1;
    console.error('MAL ' + name);
    console.error(err && err.stack || err);
  }
}

function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

const BANNED = [
  [/=>/g, 'funcion flecha'],
  [/\b(?:const|let|class|async|await|Promise|fetch|Symbol|Map|Set)\b/g, 'sintaxis o tipo de ES6'],
  [/`/g, 'plantilla'],
  [/\.\.\./g, 'spread'],
  [/\bfor\s*\([^)]*\bof\b/g, 'for...of'],
  [/\.includes\s*\(/g, 'includes'],
  [/\.find(?:Index)?\s*\(/g, 'find'],
  [/\.startsWith\s*\(/g, 'startsWith'],
  [/\.endsWith\s*\(/g, 'endsWith'],
  [/\.repeat\s*\(/g, 'repeat'],
  [/\bObject\.assign\b/g, 'Object.assign'],
  [/\bArray\.from\b/g, 'Array.from'],
  [/\bNumber\.is(?:Finite|NaN)\b/g, 'Number.isFinite/isNaN'],
];

function scanEs5(file, src) {
  const code = strip(src);
  BANNED.forEach(([re, label]) => {
    re.lastIndex = 0;
    const hit = re.exec(code);
    if (hit) throw new Error(file + ' usa ' + label + ' cerca de: ' + hit[0]);
  });
}

check('los js de la app son ES5', () => {
  fs.readdirSync(path.join(ROOT, 'js')).forEach((name) => {
    if (!name.endsWith('.js')) return;
    const file = path.join(ROOT, 'js', name);
    scanEs5('js/' + name, fs.readFileSync(file, 'utf8'));
    cp.execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  });
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) scanEs5('index.html', m[1]);
  const srcs = [];
  const srcRe = /<script src="([^"]+)"><\/script>/g;
  while ((m = srcRe.exec(html))) srcs.push(m[1]);
  assert.deepStrictEqual(srcs, [
    'js/model.js', 'js/luna.js', 'js/nav.js', 'js/glyphs.js', 'js/main.js',
  ]);
});

check('saludo y reloj en español, sin Intl', () => {
  assert.strictEqual(model.greet(8), 'Buenos días');
  assert.strictEqual(model.greet(15), 'Buenas tardes');
  assert.strictEqual(model.greet(22), 'Buenas noches');
  assert.strictEqual(model.greet(3), 'Buenas noches');
  const clock = model.formatClock(new Date(2026, 9, 20, 14, 5));
  assert.strictEqual(clock.hm, '14:05');
  assert.strictEqual(clock.dateLine, 'martes, 20 de octubre');
});

check('Netflix solo si la lista la confirma, y Ajustes es com.palm.app.settings', () => {
  const apps = [
    { id: 'youtube.leanback.v4', title: 'YouTube' },
    { id: 'com.webos.app.discovery', title: 'LG Content Store' },
    { id: 'com.palm.app.settings', title: 'Ajustes' },
  ];
  const hidden = model.resolveCurated(apps, true);
  assert.ok(hidden.every((t) => t.key !== 'netflix'));
  assert.deepStrictEqual(hidden.map((t) => t.key), ['youtube', 'livetv', 'store', 'settings', 'hb']);
  assert.strictEqual(hidden.filter((t) => t.key === 'settings')[0].id, 'com.palm.app.settings');
  assert.strictEqual(hidden.filter((t) => t.key === 'livetv')[0].id, 'com.webos.app.livetv');
  const withNf = model.resolveCurated(apps.concat([{ id: 'netflix', title: 'Netflix' }]), true);
  assert.strictEqual(withNf[2].key, 'netflix');
  assert.strictEqual(withNf[2].id, 'netflix');
  assert.strictEqual(model.resolveCurated([], false).some((t) => t.key === 'netflix'), false);
  const onlyNew = model.resolveCurated([{ id: 'com.webos.app.settings', title: 'Settings' }], true);
  assert.strictEqual(onlyNew.filter((t) => t.key === 'settings')[0].id, 'com.webos.app.settings');
  const missing = model.resolveCurated([{ id: 'youtube.leanback.v4', title: 'YouTube' }], true);
  const settings = missing.filter((t) => t.key === 'settings')[0];
  const live = missing.filter((t) => t.key === 'livetv')[0];
  assert.strictEqual(settings.id, 'com.palm.app.settings');
  assert.strictEqual(settings.confirmed, true);
  assert.strictEqual(settings.subtitle, 'Sistema');
  assert.strictEqual(live.id, 'com.webos.app.livetv');
  assert.strictEqual(live.confirmed, true);
  assert.strictEqual(missing.filter((t) => t.key === 'hb')[0].confirmed, false);
});

check('listApps oculta lo no visible y normaliza entradas', () => {
  const apps = model.appsFrom({
    launchPoints: luna.MOCK_APPS,
  });
  assert.ok(apps.every((a) => a.id !== 'com.webos.service.hidden'));
  const gallery = model.gallery(apps).map((a) => a.id);
  assert.ok(gallery.indexOf('com.christiangonper.launcher') < 0);
  assert.ok(gallery.indexOf('com.webos.app.hdmi1') < 0);
  assert.ok(gallery.indexOf('com.webos.app.livetv') < 0);
  assert.strictEqual(gallery[0], 'com.palm.app.settings');
  const inputs = model.withTv(model.inputsFrom({ deviceList: luna.MOCK_INPUTS }));
  assert.deepStrictEqual(inputs.map((d) => d.label), ['TV', 'HDMI 1', 'HDMI 2', 'AV1 (SCART)', 'AV2', 'Componentes']);
  assert.ok(inputs.every((d) => d.label !== 'AV'));
  assert.strictEqual(inputs[1].connected, true);
  assert.strictEqual(inputs[1].appId, 'com.webos.app.hdmi1');
  assert.strictEqual(inputs[3].appId, 'com.webos.app.externalinput.av1');
  assert.strictEqual(inputs[4].appId, 'com.webos.app.externalinput.av2');
  assert.strictEqual(inputs[5].appId, 'com.webos.app.externalinput.component');
  const fromId = model.normalizeInput('HDMI1', '', '');
  assert.strictEqual(fromId.id, 'HDMI_1');
  assert.strictEqual(fromId.appId, 'com.webos.app.hdmi1');
  const hdmi4 = model.normalizeInput('HDMI_4', '', '');
  assert.strictEqual(hdmi4.appId, 'com.webos.app.hdmi4');
  const scart = model.normalizeInput('SCART_1', 'com.webos.app.externalinput.scart1', 'SCART');
  assert.strictEqual(scart.label, 'Euroconector');
  assert.strictEqual(scart.appId, 'com.webos.app.externalinput.scart');
  const fromApps = model.withTv(model.inputsFromApps([
    { id: 'com.webos.app.hdmi2', title: 'HDMI2' },
    { id: 'com.webos.app.livetv', title: 'TV' },
  ]));
  assert.deepStrictEqual(fromApps.map((d) => d.id), ['TV', 'HDMI_2']);
  assert.strictEqual(model.nowCopy(inputs).detail, 'HDMI 1 tiene señal.');
  assert.strictEqual(model.rowItems(inputs, 6).more, false);
  const capped = model.rowItems(inputs, 5);
  assert.strictEqual(capped.shown.length, 4);
  assert.strictEqual(capped.more, true);
});

check('el foco espacial no envuelve y baja en columna', () => {
  const rects = [];
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 3; x++) rects.push({ left: x * 200, top: y * 160, width: 180, height: 140 });
  }
  assert.strictEqual(nav.pick(rects, 1, 'down'), 4);
  assert.strictEqual(nav.pick(rects, 1, 'left'), 0);
  assert.strictEqual(nav.pick(rects, 0, 'left'), -1);
  assert.strictEqual(nav.pick(rects, 0, 'down'), 3);
  assert.strictEqual(nav.pick(rects, 5, 'up'), 2);
  assert.strictEqual(nav.pick(rects, 2, 'right'), -1);
});

check('iconos png y paquete ipk', () => {
  writeIcons();
  ['icon.png', 'largeIcon.png', 'splash.png'].forEach((name) => {
    const buf = fs.readFileSync(path.join(ROOT, name));
    assert.strictEqual(buf[0], 137);
    assert.strictEqual(buf.slice(1, 4).toString('ascii'), 'PNG');
    assert.ok(buf.length > 100);
    assert.ok(buf.length < 400000, name + ' pesa ' + buf.length);
  });
  const built = buildIpk();
  const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'appinfo.json'), 'utf8'));
  assert.strictEqual(path.basename(built.outPath), info.id + '_' + info.version + '_all.ipk');
  const report = JSON.parse(cp.execFileSync('python3', [path.join(__dirname, 'check-ipk.py'), built.outPath], { encoding: 'utf8' }));
  assert.deepStrictEqual(report.order, ['debian-binary', 'control.tar.gz', 'data.tar.gz']);
  assert.ok(report.control.indexOf('control') >= 0);
  const prefix = 'usr/palm/applications/' + info.id + '/';
  APP_FILES.forEach((rel) => {
    const wanted = prefix + rel;
    const found = report.data.some((name) => name === wanted || name === './' + wanted);
    assert.ok(found, 'falta ' + wanted + ' en ' + report.data.join(', '));
  });
  assert.ok(!report.data.some((name) => name.indexOf('/scripts/') >= 0));
  assert.ok(!report.data.some((name) => name.endsWith('README.md')));
  console.log('    ' + built.outPath + ' (' + built.bytes + ' bytes, sha256 ' + built.sha256.slice(0, 12) + '…)');
});

function runAsync(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log('ok  ' + name); })
    .catch((err) => {
      failed += 1;
      console.error('MAL ' + name);
      console.error(err && err.stack || err);
    });
}

check('stdoutString de hbchannel se parsea aunque venga con ruido', () => {
  const parsed = luna.parseExecStdout({
    returnValue: true,
    stdoutString: 'luna-send\n' + JSON.stringify({
      returnValue: true,
      launchPoints: [{ id: 'youtube.leanback.v4', title: 'YouTube', visible: true }],
    }),
  });
  assert.strictEqual(parsed.launchPoints[0].id, 'youtube.leanback.v4');
  assert.strictEqual(luna.parseExecStdout({ returnValue: true, stdoutString: '' }), null);
  assert.strictEqual(luna.parseExecStdout({ returnValue: true, stdoutString: '{"returnValue":false}' }), null);
  assert.strictEqual(luna.LIST_CMD, "luna-send -n 1 luna://com.webos.applicationManager/listLaunchPoints '{}'");
});

runAsync('sin hbchannel se usa la lista directa y no externaldevice', () => {
  const calls = [];
  const client = luna.createClient({
    timeoutMs: 200,
    transport(uri, params, cb) {
      calls.push(uri);
      if (uri.indexOf('hbchannel.service/exec') >= 0) {
        cb({ returnValue: false, errorText: 'Service does not exist' });
        return function () {};
      }
      if (uri.indexOf('listLaunchPoints') >= 0 || uri.indexOf('/eim/') >= 0) {
        cb({ returnValue: false, errorText: 'Unknown method' });
        return function () {};
      }
      if (uri.indexOf('/listApps') >= 0) {
        cb(null, { returnValue: true, apps: [{ id: 'com.webos.app.hdmi1', title: 'HDMI 1', visible: true }] });
        return function () {};
      }
      cb(null, { returnValue: true });
      return function () {};
    },
  });
  return new Promise((resolve, reject) => {
    luna.loadHome(client, (home) => {
      try {
        assert.strictEqual(calls[0], luna.HB_EXEC);
        assert.strictEqual(home.appsKnown, true);
        assert.strictEqual(home.apps[0].id, 'com.webos.app.hdmi1');
        assert.strictEqual(home.inputsVia, 'apps');
        assert.ok(home.inputs.some((d) => d.id === 'HDMI_1'));
        assert.ok(calls.indexOf('luna://com.webos.applicationManager/listApps') >= 0);
        assert.ok(!calls.some((uri) => uri.indexOf('externaldevice') >= 0));
        resolve();
      } catch (err) { reject(err); }
    });
  });
}).then(() => runAsync('la vista previa lee exec y eim, sin Netflix', () => {
  assert.strictEqual(luna.detectPreview('?preview=1', true), true);
  assert.strictEqual(luna.detectPreview('?preview=0', false), false);
  assert.strictEqual(luna.detectPreview('', false), true);
  assert.strictEqual(luna.splitUri('luna://com.webos.applicationManager/launch').method, 'launch');
  const client = luna.createClient({ transport: luna.mockTransport, timeoutMs: 500 });
  return new Promise((resolve, reject) => {
    luna.loadHome(client, (home) => {
      try {
        assert.strictEqual(home.appsKnown, true);
        assert.ok(!home.apps.some((a) => a.id === 'netflix'));
        assert.ok(home.apps.some((a) => a.id === 'com.palm.app.settings'));
        assert.ok(home.apps.some((a) => a.id === 'canal.yomvi'));
        assert.strictEqual(home.inputs[0].id, 'TV');
        assert.ok(home.inputs.some((d) => d.label === 'AV1 (SCART)'));
        assert.ok(home.inputs.some((d) => d.label === 'AV2'));
        assert.ok(String(home.appsVia).indexOf('hbchannel.service/exec') >= 0);
        assert.ok(String(home.inputsVia).indexOf('getAllInputStatus') >= 0);
        resolve();
      } catch (err) { reject(err); }
    });
  });
})).then(() => {
  if (failed) {
    console.error(failed + ' pruebas fallaron');
    process.exit(1);
  }
  console.log('self-test ok');
});
