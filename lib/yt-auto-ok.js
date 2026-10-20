'use strict';
/*
 * Un solo OK/ENTER tras un arranque en frío de YouTube.
 * Se espera a que la app esté en primer plano y, después, YT_AUTO_OK_MS.
 * 0 desactiva el envío. Cancelar antes de pulsar no manda la tecla.
 */

const DEFAULT_MS = 18000;
const MAX_MS = 120000;

function parseOne(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  return Math.min(MAX_MS, Math.round(n));
}

/** Milisegundos de espera. 0 desactiva. Vacío o no numérico usa el valor de reserva (18 s). */
function parseYtAutoOkMs(value, fallback = DEFAULT_MS) {
  const parsed = parseOne(value);
  if (parsed !== null) return parsed;
  const fb = parseOne(fallback);
  return fb === null ? DEFAULT_MS : fb;
}

function createYtAutoOk({ getForeground, pressEnter, isYouTube, delayMs, pollEvery = 500, pollFor = 20000, log, onChange }) {
  let job = null;
  let seq = 0;
  const snap = { phase: 'idle', sent: false };
  const note = (...a) => { if (log) log(...a); };

  function snapshot() {
    return Object.assign({}, snap);
  }

  function publish(next) {
    Object.assign(snap, next);
    if (onChange) onChange(snapshot());
  }

  function wait(ms, mine) {
    return new Promise((resolve) => {
      if (mine.cancelled || mine.finished) return resolve();
      const timer = setTimeout(() => {
        if (mine.timer === timer) mine.timer = null;
        mine.wake = null;
        resolve();
      }, ms);
      mine.timer = timer;
      mine.wake = () => {
        clearTimeout(timer);
        if (mine.timer === timer) mine.timer = null;
        mine.wake = null;
        resolve();
      };
    });
  }

  function cancel(reason) {
    const mine = job;
    if (!mine || mine.sent || mine.finished) return snapshot();
    mine.cancelled = true;
    mine.finished = true;
    const wake = mine.wake;
    publish({ phase: 'cancelled', reason: reason || 'user', id: mine.id, sent: false });
    note('auto-OK YouTube cancelado', reason || 'user');
    if (wake) wake();
    return snapshot();
  }

  async function run(mine) {
    const started = Date.now();
    const every = Math.max(10, pollEvery);
    try {
      while (!mine.cancelled && !mine.finished && !mine.sent) {
        let fg = null;
        try { fg = await getForeground(); } catch (_) { fg = null; }
        if (mine.cancelled || mine.finished || mine.sent || job !== mine) return;
        if (isYouTube(fg)) {
          if (delayMs > 0) await wait(delayMs, mine);
          if (mine.cancelled || mine.finished || mine.sent || job !== mine) return;
          mine.sent = true;
          await pressEnter();
          mine.finished = true;
          if (job === mine) publish({ phase: 'done', id: mine.id, sent: true });
          note('auto-OK YouTube enviado');
          return;
        }
        if (Date.now() - started >= pollFor) {
          mine.finished = true;
          if (job === mine) publish({ phase: 'skipped', id: mine.id, reason: 'not-foreground', sent: false });
          note('auto-OK YouTube omitido: la app no llegó a primer plano');
          return;
        }
        const left = pollFor - (Date.now() - started);
        await wait(Math.min(every, Math.max(10, left)), mine);
      }
    } catch (e) {
      mine.finished = true;
      if (job === mine && !mine.cancelled) {
        publish({ phase: 'error', id: mine.id, error: (e && e.message) || String(e), sent: !!mine.sent });
      }
      note('auto-OK YouTube', (e && e.message) || e);
    }
  }

  function arm() {
    if (job && !job.sent && !job.finished) cancel('replaced');
    const mine = { id: ++seq, sent: false, cancelled: false, finished: false, timer: null, wake: null };
    job = mine;
    publish({ phase: 'waiting', id: mine.id, delayMs, sent: false, since: Date.now() });
    run(mine);
    return { pending: true, delayMs, id: mine.id };
  }

  return { arm, cancel, snapshot };
}

module.exports = { createYtAutoOk, parseYtAutoOkMs, DEFAULT_MS, MAX_MS };
