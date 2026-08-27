/** Utilidades compartidas por las pruebas de carga. */
import WebSocket from 'ws';

export const pct = (arr, p) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
};
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const ms = (n) => `${n.toFixed(0)} ms`;

/**
 * Cliente de carga. `parse:false` cuenta bytes sin deserializar: así el servidor
 * hace todo su trabajo pero la máquina de pruebas no se convierte en el cuello
 * de botella cuando hay cientos de conexiones.
 */
export function connect(url, { parse = true, onState, onMsg } = {}) {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(url, { perMessageDeflate: false });
    w.bytes = 0; w.msgs = 0; w.errors = [];
    w.on('message', (data) => {
      w.msgs++; w.bytes += data.length;
      if (!parse) return;
      const m = JSON.parse(data);
      if (m.t === 'state') { w.last = m; onState?.(m, w); }
      else if (m.t === 'joined') w.code = m.code;
      else if (m.t === 'error') w.errors.push(m.msg);
      else if (m.t === 'pong') w.onPong?.();
      onMsg?.(m, w);
    });
    w.on('open', () => resolve(w));
    w.on('error', (e) => { w.netError = e.message; reject(e); });
  });
}

export const send = (w, o) => { if (w.readyState === 1) w.send(JSON.stringify(o)); };

export async function untilTrue(fn, what, tries = 200, every = 50) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await wait(every);
  }
  throw new Error(`timeout: ${what}`);
}

/**
 * Sonda de salud independiente. Usa pings del propio protocolo WebSocket: el
 * servidor los contesta desde su bucle de eventos, así que el retraso mide
 * exactamente cuánto está atascado Node, sin pasar por la lógica del juego.
 */
export function probe(url) {
  const samples = [];
  let sent = 0, lost = 0, w = null, pendingAt = 0, timer = null;
  return {
    samples,
    async start(everyMs = 500) {
      w = await connect(url, { parse: false });
      w.on('pong', () => { if (pendingAt) { samples.push(performance.now() - pendingAt); pendingAt = 0; } });
      timer = setInterval(() => {
        if (w.readyState !== 1) { lost++; return; }
        if (pendingAt) lost++;            // el anterior nunca volvió
        pendingAt = performance.now(); sent++;
        w.ping();
      }, everyMs);
    },
    stats() {
      return { n: samples.length, p50: pct(samples, 50), p95: pct(samples, 95), max: Math.max(0, ...samples), sent, lost };
    },
    reset() { samples.length = 0; sent = 0; lost = 0; },
    stop() { clearInterval(timer); w?.close(); },
  };
}
