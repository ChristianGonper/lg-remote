'use strict';
/*
 * Envío de medios a una LG webOS por SSAP (no es duplicar pantalla).
 *
 * Orden pensado para webOS 2.0 (2015, p. ej. 32LF592U). No está probado en esa tele;
 * el primer método que la tele acepte por SSAP gana. Fuentes del orden:
 *   1. ssap://media.viewer/open — lo usa ConnectSDK cuando el servicio second-screen
 *      anuncia la versión 4.0.0/4.0.1, que corresponde a webOS 2. El payload es el
 *      de ConnectSDK (target, title, mimeType, loop). Respuesta típica:
 *      {id:"com.webos.app.tvsimpleviewer", sessionId}.
 *   2. system.launcher/launch de com.webos.app.smartshare con el payload DLNA que
 *      el reproductor de webOS 1.x–2.x acepta (en 3.x–5.x el id pasa a ser
 *      com.webos.app.photovideo; se prueba solo si SmartShare falla).
 *   3. ssap://system.launcher/open {target} — abre el navegador. Último recurso.
 *      Si ese método no existe, se lanza com.webos.app.browser.
 * YouTube no entra en el reproductor: deep link a youtube.leanback.v4.
 * En la app web antigua (webOS 1–3) deeplinkingParams es
 *   "contentTarget":"https://www.youtube.com/tv?v=$CONTENTID"
 * Si ese lanzamiento falla se prueban "v=ID" y la URL watch, que usan otras versiones.
 * media.controls publica play/pause/stop/rewind/fastForward. seek no está en esa
 * lista; se intenta igual y, si falla, com.webos.media/seek (API interna, puede no
 * estar expuesta por SSAP en webOS 2).
 */
const net = require('net');

const YT_ID = 'youtube.leanback.v4';
const YT_TEMPLATE = 'https://www.youtube.com/tv?v=$CONTENTID';

const EXT = {
  mp4: ['video/mp4', 'video'],
  m4v: ['video/mp4', 'video'],
  mkv: ['video/x-matroska', 'video'],
  webm: ['video/webm', 'video'],
  avi: ['video/x-msvideo', 'video'],
  mov: ['video/quicktime', 'video'],
  ts: ['video/mp2t', 'video'],
  m3u8: ['application/vnd.apple.mpegurl', 'hls'],
  mp3: ['audio/mpeg', 'audio'],
  m4a: ['audio/mp4', 'audio'],
  aac: ['audio/aac', 'audio'],
  wav: ['audio/wav', 'audio'],
  flac: ['audio/flac', 'audio'],
  ogg: ['audio/ogg', 'audio'],
  jpg: ['image/jpeg', 'image'],
  jpeg: ['image/jpeg', 'image'],
  png: ['image/png', 'image'],
  gif: ['image/gif', 'image'],
  bmp: ['image/bmp', 'image'],
  webp: ['image/webp', 'image'],
};

const VIA_LABEL = {
  'media.viewer/open': 'reproductor (media.viewer)',
  smartshare: 'SmartShare',
  photovideo: 'Foto y vídeo',
  browser: 'navegador',
  'browser-app': 'navegador',
  youtube: 'app de YouTube',
};

const SHARE_APPS = [
  ['smartshare', 'com.webos.app.smartshare'],
  ['photovideo', 'com.webos.app.photovideo'],
];

function assertHttpUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (_) { throw new Error('URL no válida'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('la URL tiene que ser http o https');
  if (u.username || u.password) throw new Error('quita el usuario y la contraseña de la URL');
  return u;
}

/** Aviso o rechazo: la tele no puede abrir localhost ni una IPv6 literal. */
function tvUrlProblem(url, advertiseHost) {
  const u = assertHttpUrl(url);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) === 6) return { reject: 'La tele no tiene IPv6. Usa una dirección IPv4.' };
  const local = host === 'localhost' || host === '127.0.0.1';
  if (!local) return null;
  const adv = advertiseHost || '';
  if (adv && adv !== '127.0.0.1' && adv !== 'localhost') {
    return { reject: 'Esa URL apunta a este móvil (localhost). La tele no puede abrirla. El archivo se sirve en http://' + adv + '/' };
  }
  return { warning: 'La URL es 127.0.0.1: solo sirve para una prueba en este equipo, no para la tele.' };
}

function describeMedia(url, mimeHint) {
  let pathname = String(url || '');
  try { pathname = new URL(pathname).pathname; } catch (_) { /* nombre suelto */ }
  const base = decodeSafe(pathname.split('/').filter(Boolean).pop() || 'media');
  const ext = (base.match(/\.([a-z0-9]{1,8})$/i) || [, ''])[1].toLowerCase();
  const fromExt = EXT[ext];
  let mime = '';
  if (mimeHint) mime = String(mimeHint).split(';')[0].trim().toLowerCase();
  if (!mime || mime === 'application/octet-stream') mime = fromExt ? fromExt[0] : 'application/octet-stream';
  const kind = (fromExt && fromExt[1]) || kindFromMime(mime) || 'unknown';
  return { ext, mime, kind, title: base || 'media' };
}

function kindFromMime(mime) {
  if (!mime) return '';
  if (mime === 'application/vnd.apple.mpegurl' || mime === 'application/x-mpegurl' || mime === 'application/mpegurl') return 'hls';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  return '';
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}

function parseYouTube(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch (_) { return null; }
  let host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  if (host.endsWith('googlevideo.com')) return null;
  const yt = host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com'
    || host === 'm.youtube.com' || host === 'music.youtube.com' || host.endsWith('.youtube.com');
  if (!yt) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  const qv = u.searchParams.get('v');
  let videoId = null;
  if (host === 'youtu.be') videoId = parts[0] || null;
  else if (parts[0] === 'watch' || parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v') videoId = parts[1] || qv;
  else if (parts[0] === 'tv') videoId = qv;
  else if (parts[0] === 'playlist') videoId = null;
  else if (parts[0] === 'results') {
    const query = u.searchParams.get('search_query') || u.searchParams.get('q') || '';
    return query ? { type: 'search', query } : { type: 'app' };
  } else if (parts[0] === 'channel' && parts[1] && /^UC[\w-]{20,}$/.test(parts[1])) {
    return { type: 'channel', channelId: parts[1] };
  } else videoId = qv;
  if (videoId && !/^[A-Za-z0-9_-]{11}$/.test(videoId)) videoId = null;
  const listId = u.searchParams.get('list');
  const listOk = listId && /^[A-Za-z0-9_-]{12,64}$/.test(listId) ? listId : null;
  if (videoId) return { type: 'video', videoId, listId: listOk };
  if (listOk) return { type: 'playlist', videoId: null, listId: listOk };
  return { type: 'app' };
}

function contentTargets(yt, template, variant) {
  const v = variant && variant !== 'auto' ? variant : 'auto';
  const videoId = yt.videoId || null;
  const listId = yt.listId || null;
  const channelId = yt.channelId || null;
  const query = [videoId ? 'v=' + videoId : '', listId ? 'list=' + listId : ''].filter(Boolean).join('&');
  const channelQuery = channelId ? 'c=' + channelId : '';
  const fullTv = channelQuery && !query
    ? 'https://www.youtube.com/tv?' + channelQuery
    : (query ? 'https://www.youtube.com/tv?' + query : '');
  const short = channelQuery && !query ? channelQuery : query;
  const watch = videoId ? 'https://www.youtube.com/watch?v=' + videoId + (listId ? '&list=' + listId : '') : '';
  if (v === 'url') return uniq([fullTv || short]);
  if (v === 'v') return uniq([short || fullTv]);
  if (v === 'watch') return uniq([watch || fullTv || short]);
  const out = [];
  if (template && videoId && template.includes('$CONTENTID')) {
    let t = template.replace(/\$CONTENTID/g, videoId);
    if (listId && !/[?&]list=/.test(t)) t += (t.includes('?') ? '&' : '?') + 'list=' + listId;
    out.push(t);
  }
  out.push(fullTv, short, watch);
  return uniq(out);
}

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function viewerPayload({ url, title, mime, kind }) {
  const payload = { target: url, title: title || 'Media' };
  if (mime && mime !== 'application/octet-stream') payload.mimeType = mime;
  if (kind !== 'image') payload.loop = false;
  return payload;
}

function dlnaType(kind) {
  if (kind === 'audio') return 'AUDIO';
  if (kind === 'image') return 'IMAGE';
  return 'VIDEO';
}

function smartShareParams({ url, title, mime, kind, bytes }) {
  const protoMime = mime && mime !== 'application/octet-stream' ? mime : '*/*';
  const size = Number(bytes) > 0 ? String(Math.floor(Number(bytes))) : '-1';
  return {
    payload: [{
      fullPath: url,
      artist: '',
      subtitle: '',
      dlnaInfo: {
        flagVal: 4096,
        cleartextSize: size,
        contentLength: size,
        opVal: 1,
        protocolInfo: 'http-get:*:' + protoMime + ':DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000',
        duration: 0,
      },
      mediaType: dlnaType(kind),
      thumbnail: '',
      deviceType: 'DMR',
      album: '',
      fileName: title || 'media',
      lastPlayPosition: -1,
    }],
  };
}

function mediaSteps({ url, title, mime, kind, bytes, method }) {
  const force = method || 'auto';
  const viewer = { via: 'media.viewer/open', uri: 'media.viewer/open', payload: viewerPayload({ url, title, mime, kind }) };
  const share = SHARE_APPS.map(([via, id]) => ({
    via, uri: 'system.launcher/launch', payload: { id, params: smartShareParams({ url, title, mime, kind, bytes }) },
  }));
  const browser = [
    { via: 'browser', uri: 'system.launcher/open', payload: { target: url } },
    { via: 'browser-app', uri: 'system.launcher/launch', payload: { id: 'com.webos.app.browser', params: { target: url } } },
  ];
  if (force === 'viewer') return [viewer];
  if (force === 'smartshare') return share.filter((s) => s.via === 'smartshare');
  if (force === 'browser') return browser;
  if (force === 'auto') return [viewer, ...share, ...browser];
  throw new Error('método desconocido: ' + force);
}

/**
 * Plan de mensajes SSAP, sin enviar nada.
 * @param {object} input url, title?, mime?, bytes?, method? (auto|viewer|smartshare|browser),
 *   variant? (auto|url|v|watch), youtubeTemplate?, youtubeAppId?
 */
function buildCastPlan(input) {
  const url = assertHttpUrl(input.url).toString();
  const method = input.method || 'auto';
  const yt = parseYouTube(url);
  if (yt && method !== 'browser') {
    const appId = input.youtubeAppId || YT_ID;
    if (yt.type === 'search') {
      const target = 'https://www.youtube.com/tv?launch=search&q=' + encodeURIComponent(yt.query);
      return planShell('youtube-search', url, yt.query, null, [
        { via: 'youtube', uri: 'system.launcher/launch', payload: { id: appId, params: { contentTarget: target } } },
      ]);
    }
    if (yt.type === 'app') {
      return planShell('youtube', url, 'YouTube', null, [
        { via: 'youtube', uri: 'system.launcher/launch', payload: { id: appId } },
      ]);
    }
    const targets = contentTargets(yt, input.youtubeTemplate || YT_TEMPLATE, input.variant);
    const title = yt.videoId ? 'YouTube ' + yt.videoId : (yt.channelId ? 'YouTube ' + yt.channelId : 'YouTube ' + yt.listId);
    return planShell('youtube', url, title, null, targets.map((contentTarget) => ({
      via: 'youtube', uri: 'system.launcher/launch', payload: { id: appId, params: { contentTarget } },
    })), { videoId: yt.videoId || null, listId: yt.listId || null, channelId: yt.channelId || null });
  }
  const described = describeMedia(url, input.mime);
  const mime = described.mime;
  const kind = described.kind;
  const title = String(input.title || described.title || 'Media').slice(0, 120);
  const steps = mediaSteps({ url, title, mime, kind, bytes: input.bytes, method });
  return planShell(kind, url, title, mime, steps);
}

function planShell(kind, url, title, mime, steps, extra) {
  return Object.assign({
    kind, url, title, mime: mime || null,
    steps: steps.map((s) => ({ via: s.via, uri: s.uri, payload: s.payload })),
  }, extra || {});
}

function seekPositionMs(seconds) {
  const position = Math.round(Number(seconds) * 1000);
  if (!Number.isFinite(position) || position < 0 || position > 24 * 3600 * 1000) throw new Error('posición inválida');
  return position;
}

function extractMediaId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.mediaId) return String(payload.mediaId);
  const list = payload.foregroundAppInfo || payload.appInfo || [];
  const arr = Array.isArray(list) ? list : [list];
  for (const item of arr) if (item && item.mediaId) return String(item.mediaId);
  return null;
}

function sessionFrom(result, step) {
  const r = result && typeof result === 'object' ? result : {};
  const fromPayload = step && step.payload && step.payload.id;
  return {
    appId: r.id || r.appId || fromPayload || null,
    sessionId: r.sessionId || null,
  };
}

function createCaster({ request, launch, button, log }) {
  if (typeof request !== 'function' || typeof launch !== 'function') throw new Error('createCaster necesita request y launch');
  const note = (...a) => { if (typeof log === 'function') log(...a); };

  async function runStep(step) {
    if (step.uri === 'system.launcher/launch') return launch(step.payload.id, step.payload.params);
    return request(step.uri, step.payload || {});
  }

  async function cast(input) {
    const problem = input.dryRun ? null : tvUrlProblem(input.url, input.advertiseHost);
    if (problem && problem.reject) throw new Error(problem.reject);
    const plan = buildCastPlan(input);
    if (input.dryRun) {
      return { dryRun: true, kind: plan.kind, title: plan.title, mime: plan.mime, url: plan.url, steps: plan.steps };
    }
    const tried = [];
    const youtubeAnyway = String(plan.kind).startsWith('youtube') && input.method && input.method !== 'auto' && input.method !== 'browser';
    for (const step of plan.steps) {
      try {
        const result = await runStep(step);
        const sess = sessionFrom(result, step);
        note('envío por', step.via, plan.url);
        const out = {
          via: step.via,
          viaLabel: VIA_LABEL[step.via] || step.via,
          uri: step.uri,
          kind: plan.kind,
          mime: plan.mime,
          title: plan.title,
          url: plan.url,
          appId: sess.appId,
          sessionId: sess.sessionId,
          tried,
        };
        if (step.payload && step.payload.params && step.payload.params.contentTarget) out.contentTarget = step.payload.params.contentTarget;
        const warnings = [];
        if (problem && problem.warning) warnings.push(problem.warning);
        if (plan.kind === 'hls') warnings.push('HLS (m3u8) depende del reproductor de webOS 2 y no está confirmado en esta tele.');
        if (youtubeAnyway) warnings.push('Un enlace de YouTube se abre en la app, no en el reproductor.');
        if (warnings.length) out.warning = warnings.join(' ');
        return out;
      } catch (e) {
        const msg = (e && e.message) || String(e);
        tried.push(step.via + ': ' + msg);
        note('envío', step.via, 'falló:', msg);
      }
    }
    throw new Error('No se pudo abrir en la tele. ' + tried.join(' | '));
  }

  async function control({ cmd, seconds, position, session }) {
    const c = String(cmd || '').toLowerCase();
    if (c === 'play' || c === 'pause') {
      const uri = 'media.controls/' + c;
      try { return { via: uri, ...(await request(uri, {})) }; } catch (e) {
        if (typeof button !== 'function') throw e;
        const name = c === 'play' ? 'PLAY' : 'PAUSE';
        await button(name);
        return { via: 'pointer', sent: name };
      }
    }
    if (c === 'stop') return stop(session || null);
    if (c === 'seek') return seek(seconds != null ? seconds : position);
    throw new Error('control desconocido: ' + cmd);
  }

  async function stop(session) {
    const errors = [];
    let via = null;
    try { await request('media.controls/stop', {}); via = 'media.controls/stop'; } catch (e) { errors.push(e.message); }
    const viewer = session && (session.via === 'media.viewer/open' || session.sessionId);
    if (viewer) {
      const payload = {};
      if (session.appId) payload.id = session.appId;
      if (session.sessionId) payload.sessionId = session.sessionId;
      try { await request('media.viewer/close', payload); via = via || 'media.viewer/close'; } catch (e) { errors.push(e.message); }
    }
    const closable = session && ['com.webos.app.smartshare', 'com.webos.app.photovideo', 'com.webos.app.tvsimpleviewer'].includes(session.appId)
      && session.via !== 'media.viewer/open' && session.via !== 'youtube';
    if (closable) {
      try { await request('system.launcher/close', { id: session.appId }); via = via || 'system.launcher/close'; } catch (e) { errors.push(e.message); }
    }
    if (!via) {
      if (typeof button !== 'function') throw new Error('No se pudo parar. ' + errors.join(' | '));
      try { await button('STOP'); return { stopped: true, via: 'pointer', sent: 'STOP', errors }; } catch (e) { errors.push(e.message); }
      throw new Error('No se pudo parar. ' + errors.join(' | '));
    }
    return { stopped: true, via, errors };
  }

  async function seek(seconds) {
    const position = seekPositionMs(seconds);
    let first;
    try {
      await request('media.controls/seek', { position });
      return { via: 'media.controls/seek', position };
    } catch (e) { first = e; }
    let mediaId = null;
    try { mediaId = extractMediaId(await request('com.webos.media/getForegroundAppInfo', {})); } catch (_) { /* no está en el SSAP público de webOS 2 */ }
    if (mediaId) {
      try {
        await request('com.webos.media/seek', { position, mediaId });
        return { via: 'com.webos.media/seek', position, mediaId };
      } catch (e2) {
        throw new Error('La tele no aceptó el salto (' + first.message + '; ' + e2.message + '). En webOS 2 seek no está en la lista pública de SSAP; usa rebobinar y avanzar.');
      }
    }
    throw new Error('La tele no aceptó el salto (' + first.message + '). En webOS 2 media.controls/seek no está documentado; usa ⏪ y ⏩.');
  }

  return { cast, control, plan: buildCastPlan };
}

module.exports = {
  YT_ID,
  YT_TEMPLATE,
  VIA_LABEL,
  assertHttpUrl,
  tvUrlProblem,
  describeMedia,
  parseYouTube,
  contentTargets,
  viewerPayload,
  smartShareParams,
  buildCastPlan,
  seekPositionMs,
  extractMediaId,
  createCaster,
};
