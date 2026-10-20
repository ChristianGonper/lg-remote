#!/usr/bin/env node
/*
 * Iconos PNG del paquete (icon 80, largeIcon 130, splash 1280x720).
 * Sin dependencias: el televisor no ejecuta este script.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

function Image(w, h) {
  this.w = w;
  this.h = h;
  this.data = Buffer.alloc(w * h * 4, 0);
}

Image.prototype.set = function (x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
  const i = (y * this.w + x) * 4;
  this.data[i] = r;
  this.data[i + 1] = g;
  this.data[i + 2] = b;
  this.data[i + 3] = a;
};

Image.prototype.fill = function (r, g, b, a) {
  for (let i = 0; i < this.data.length; i += 4) {
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = a;
  }
};

function fillRoundRect(img, x, y, w, h, radius, rgba) {
  const r = Math.min(radius, w / 2, h / 2);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      let inside = true;
      if (xx < r && yy < r) inside = (xx - r) * (xx - r) + (yy - r) * (yy - r) <= r * r;
      else if (xx >= w - r && yy < r) inside = (xx - (w - r)) * (xx - (w - r)) + (yy - r) * (yy - r) <= r * r;
      else if (xx < r && yy >= h - r) inside = (xx - r) * (xx - r) + (yy - (h - r)) * (yy - (h - r)) <= r * r;
      else if (xx >= w - r && yy >= h - r) inside = (xx - (w - r)) * (xx - (w - r)) + (yy - (h - r)) * (yy - (h - r)) <= r * r;
      if (inside) img.set(x + xx, y + yy, rgba[0], rgba[1], rgba[2], rgba[3]);
    }
  }
}

function fillRect(img, x, y, w, h, rgba) {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) img.set(x + xx, y + yy, rgba[0], rgba[1], rgba[2], rgba[3]);
  }
}

function fillTriangle(img, ax, ay, bx, by, cx, cy, rgba) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(img.w - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(img.h - 1, Math.ceil(Math.max(ay, by, cy)));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (!area) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
      const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) img.set(x, y, rgba[0], rgba[1], rgba[2], rgba[3]);
    }
  }
}

function downscale(src, factor) {
  const w = Math.floor(src.w / factor);
  const h = Math.floor(src.h / factor);
  const dst = new Image(w, h);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let yy = 0; yy < factor; yy++) {
        for (let xx = 0; xx < factor; xx++) {
          const i = ((y * factor + yy) * src.w + (x * factor + xx)) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          a += src.data[i + 3];
        }
      }
      dst.set(x, y, Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n));
    }
  }
  return dst;
}

const INK = [18, 17, 15, 255];
const TILE = [38, 34, 28, 255];
const AMBER = [240, 180, 41, 255];
const PAPER = [246, 241, 232, 255];

function drawHouse(img, cx, cy, s) {
  const roofA = [cx, cy - s * 0.95];
  const roofB = [cx - s * 1.15, cy - s * 0.05];
  const roofC = [cx + s * 1.15, cy - s * 0.05];
  fillTriangle(img, roofA[0], roofA[1], roofB[0], roofB[1], roofC[0], roofC[1], AMBER);
  const bw = s * 1.7;
  const bh = s * 1.15;
  const bx = cx - bw / 2;
  const by = cy - s * 0.02;
  fillRect(img, Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh), PAPER);
  const dw = s * 0.42;
  const dh = s * 0.62;
  fillRect(img, Math.round(cx - dw / 2), Math.round(by + bh - dh), Math.round(dw), Math.round(dh), INK);
}

function drawIcon(size) {
  const f = 4;
  const img = new Image(size * f, size * f);
  img.fill(INK[0], INK[1], INK[2], 255);
  const m = Math.round(size * f * 0.04);
  fillRoundRect(img, m, m, size * f - m * 2, size * f - m * 2, Math.round(size * f * 0.22), TILE);
  drawHouse(img, (size * f) / 2, (size * f) * 0.46, size * f * 0.22);
  return downscale(img, f);
}

const FONT = {
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
};

function drawText(img, text, x, y, scale, rgba) {
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const glyph = FONT[text.charAt(i)];
    if (!glyph) { cx += 6 * scale; continue; }
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row].charAt(col) === '1') {
          fillRect(img, cx + col * scale, y + row * scale, scale, scale, rgba);
        }
      }
    }
    cx += 6 * scale;
  }
}

function drawSplash() {
  const img = new Image(1280, 720);
  img.fill(INK[0], INK[1], INK[2], 255);
  fillRoundRect(img, 490, 180, 300, 300, 64, TILE);
  drawHouse(img, 640, 300, 78);
  const text = 'INICIO';
  const scale = 6;
  const width = text.length * 6 * scale;
  drawText(img, text, Math.round(640 - width / 2), 520, scale, PAPER);
  return img;
}

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = img.w * 4 + 1;
  const raw = Buffer.alloc(stride * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * stride] = 0;
    img.data.copy(raw, y * stride + 1, y * img.w * 4, (y + 1) * img.w * 4);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeIcons() {
  const files = {
    'icon.png': drawIcon(80),
    'largeIcon.png': drawIcon(130),
    'splash.png': drawSplash(),
  };
  Object.keys(files).forEach((name) => {
    const buf = encodePng(files[name]);
    fs.writeFileSync(path.join(ROOT, name), buf);
  });
  return files;
}

if (require.main === module) {
  const files = writeIcons();
  Object.keys(files).forEach((name) => {
    const img = files[name];
    const bytes = fs.statSync(path.join(ROOT, name)).size;
    console.log(name + ' ' + img.w + 'x' + img.h + ' ' + bytes + ' bytes');
  });
}

module.exports = { writeIcons, encodePng };
