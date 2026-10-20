#!/usr/bin/env node
/*
 * Empaqueta launcher/ como .ipk (ar de Debian) sin el SDK de LG.
 * Formato que acepta appinstalld de webOS TV 2:
 *   debian-binary, control.tar.gz, data.tar.gz
 *   data: usr/palm/applications/<id>/...
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

const APP_FILES = [
  'appinfo.json',
  'index.html',
  'icon.png',
  'largeIcon.png',
  'splash.png',
  'css/app.css',
  'js/model.js',
  'js/luna.js',
  'js/nav.js',
  'js/glyphs.js',
  'js/main.js',
];

function octal(value, length) {
  let s = Math.floor(value).toString(8);
  if (s.length > length - 1) s = s.slice(s.length - (length - 1));
  while (s.length < length - 1) s = '0' + s;
  return s + '\0';
}

function put(buf, offset, str) {
  for (let i = 0; i < str.length; i++) buf[offset + i] = str.charCodeAt(i) & 0xff;
}

function tarHeader(name, size, mode, type, mtime) {
  const buf = Buffer.alloc(512, 0);
  put(buf, 0, name);
  put(buf, 100, octal(mode, 8));
  put(buf, 108, octal(0, 8));
  put(buf, 116, octal(0, 8));
  put(buf, 124, octal(size, 12));
  put(buf, 136, octal(mtime, 12));
  buf.fill(0x20, 148, 156);
  put(buf, 156, type);
  put(buf, 257, 'ustar\0');
  put(buf, 263, '00');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  let chk = sum.toString(8);
  while (chk.length < 6) chk = '0' + chk;
  put(buf, 148, chk + '\0 ');
  return buf;
}

function tar(entries, mtime) {
  const parts = [];
  entries.forEach((entry) => {
    const data = entry.data || Buffer.alloc(0);
    const type = entry.dir ? '5' : '0';
    const mode = entry.dir ? 0o755 : 0o644;
    const name = entry.dir && entry.name.charAt(entry.name.length - 1) !== '/' ? entry.name + '/' : entry.name;
    if (name.length > 100) throw new Error('ruta demasiado larga para ustar: ' + name);
    parts.push(tarHeader(name, data.length, mode, type, mtime));
    if (data.length) {
      parts.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) parts.push(Buffer.alloc(pad, 0));
    }
  });
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

function gzip(buf) {
  return zlib.gzipSync(buf, { level: 9, mtime: 0 });
}

function padField(value, length) {
  let s = String(value);
  if (s.length > length) s = s.slice(0, length);
  while (s.length < length) s += ' ';
  return s;
}

function arMember(name, data) {
  const header = padField(name, 16) + padField('0', 12) + padField('0', 6) + padField('0', 6) + padField('100644', 8) + padField(String(data.length), 10) + '`\n';
  if (header.length !== 60) throw new Error('cabecera ar de ' + header.length);
  const chunks = [Buffer.from(header, 'binary'), data];
  if (data.length % 2 === 1) chunks.push(Buffer.from('\n', 'binary'));
  return Buffer.concat(chunks);
}

function buildAr(members) {
  const parts = [Buffer.from('!<arch>\n', 'ascii')];
  members.forEach((member) => parts.push(arMember(member.name, member.data)));
  return Buffer.concat(parts);
}

function parentDirs(rel) {
  const dirs = [];
  const bits = rel.split('/').filter(Boolean);
  bits.pop();
  let acc = '';
  bits.forEach((bit) => {
    acc = acc ? acc + '/' + bit : bit;
    dirs.push(acc);
  });
  return dirs;
}

function readAppInfo() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'appinfo.json'), 'utf8'));
}

function buildIpk(options) {
  const opts = options || {};
  const root = opts.root || ROOT;
  const info = JSON.parse(fs.readFileSync(path.join(root, 'appinfo.json'), 'utf8'));
  const mtime = 0;
  const base = 'usr/palm/applications/' + info.id;
  const dirSet = {};
  const dataEntries = [];
  parentDirs(base + '/x').forEach((dir) => { dirSet[dir] = true; });

  APP_FILES.forEach((rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) throw new Error('falta ' + rel + ' para empaquetar');
    parentDirs(base + '/' + rel).forEach((dir) => { dirSet[dir] = true; });
  });

  Object.keys(dirSet).sort().forEach((dir) => {
    dataEntries.push({ name: dir, dir: true });
  });
  APP_FILES.forEach((rel) => {
    dataEntries.push({
      name: base + '/' + rel,
      data: fs.readFileSync(path.join(root, rel)),
    });
  });

  const control = [
    'Package: ' + info.id,
    'Version: ' + info.version,
    'Section: misc',
    'Priority: optional',
    'Architecture: all',
    'Maintainer: ' + (info.vendor || 'Christian'),
    'Description: Prototipo de lanzador para webOS 2. No sustituye al inicio del sistema.',
    '',
  ].join('\n');

  const ipk = buildAr([
    { name: 'debian-binary', data: Buffer.from('2.0\n', 'ascii') },
    { name: 'control.tar.gz', data: gzip(tar([{ name: 'control', data: Buffer.from(control, 'utf8') }], mtime)) },
    { name: 'data.tar.gz', data: gzip(tar(dataEntries, mtime)) },
  ]);

  const outDir = opts.outDir || path.join(root, 'dist');
  fs.mkdirSync(outDir, { recursive: true });
  const filename = info.id + '_' + info.version + '_all.ipk';
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, ipk);
  const sha256 = crypto.createHash('sha256').update(ipk).digest('hex');
  return { outPath, filename, sha256, info, bytes: ipk.length };
}

function installCommand(filename) {
  return "luna-send -i luna://com.webos.appInstallService/dev/install '{\"id\":\"com.christiangonper.launcher\",\"ipkUrl\":\"/tmp/" + filename + "\",\"subscribe\":true}'";
}

if (require.main === module) {
  const built = buildIpk();
  console.log(built.outPath);
  console.log(built.bytes + ' bytes');
  console.log('sha256 ' + built.sha256);
  console.log(installCommand(built.filename));
}

module.exports = { buildIpk, APP_FILES, installCommand, readAppInfo };
