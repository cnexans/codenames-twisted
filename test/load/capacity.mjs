/**
 * Prueba de carga 2: ¿cuántas salas simultáneas aguanta el servidor?
 *
 *   node test/load/capacity.mjs [url] [porSala] [escalón] [segundosPorEscalón] [máxSalas]
 *   node test/load/capacity.mjs wss://codenames.cnexans.com/ws 16 3 30 30
 *
 * Añade salas que juegan solas hasta que el servidor deja de responder bien.
 * La salud se mide con una sonda externa (ping/pong): si el bucle de eventos de
 * Node se satura, ese ping se retrasa antes de que nadie note nada más.
 */
import { connect, send, wait, untilTrue, pct, ms, probe } from './lib.mjs';

const URL = process.argv[2] || 'ws://localhost:3000/ws';
const SIZE = +(process.argv[3] || 16);
const STEP = +(process.argv[4] || 3);
const STEP_S = +(process.argv[5] || 30);
const MAX_ROOMS = +(process.argv[6] || 30);
const LIMITE_P95 = 500;   // ms de retraso del servidor que damos por inaceptable
const THINK = 1500;       // ritmo de juego de cada sala

const salas = [];
let actions = 0, errores = 0, caidas = 0;
const fanout = [];        // medido solo en la primera sala, para no encarecer el cliente

function driver(room) {
  const acted = new Map();
  return (m, w) => {
    if (m.t !== undefined && !m.game && m.phase !== 'roundEnd' && m.phase !== 'gameEnd') return;
    if (room.idx === 0 && m.game) {
      for (const p of room.pending) {
        if (m.round === p.round && m.log.length >= p.seq && !p.seen.has(w.idx)) {
          p.seen.add(w.idx);
          if (p.seen.size === room.clients.length) fanout.push(performance.now() - p.t0);
        }
      }
    }
    if (m.phase === 'gameEnd') { if (w.idx === 0) { send(w, { t: 'reset' }); setTimeout(() => send(w, { t: 'start' }), 300); } return; }
    if (m.phase === 'roundEnd') { if (w.idx === 0) setTimeout(() => send(w, { t: 'next' }), 400); return; }
    if (m.phase !== 'playing') return;

    const g = m.game, me = m.you;
    const key = `${m.round}:${g.turn}:${g.clue?.word || ''}:${g.board.filter((c) => c.revealed).length}`;
    if (acted.get(w.idx) === key) return;
    acted.set(w.idx, key);
    const mark = (state) => {
      actions++;
      if (room.idx === 0) room.pending.push({ round: state.round, seq: state.log.length + 1, t0: performance.now(), seen: new Set() });
    };
    if (me.role === 'spymaster' && me.team === g.turn && !g.clue) {
      setTimeout(() => { mark(m); send(w, { t: 'clue', word: 'SEÑUELO', count: 4 }); }, THINK);
    } else if (me.role === 'operative' && me.team === g.turn && g.clue) {
      const yo = m.players.filter((p) => p.team === g.turn && p.role === 'operative')[0];
      if (yo?.id !== me.id) return;
      const libres = g.board.map((c, i) => [c, i]).filter(([c]) => !c.revealed).map(([, i]) => i);
      setTimeout(() => { mark(m); send(w, { t: 'guess', index: libres[Math.floor(Math.random() * libres.length)] }); }, THINK * 0.7);
    }
  };
}

async function abrirSala(idx) {
  const room = { idx, clients: [], pending: [] };
  const onState = driver(room);
  const abiertos = await Promise.all(Array.from({ length: SIZE }, () => connect(URL, { onState })));
  abiertos.forEach((w, i) => {
    w.idx = i;
    w.on('close', () => { if (!room.cerrando) caidas++; });
    room.clients.push(w);
  });
  const host = room.clients[0];
  send(host, { t: 'create', name: `S${idx}J0` });
  await untilTrue(() => host.code, `sala ${idx} creada`);
  for (let i = 1; i < SIZE; i++) {
    send(room.clients[i], { t: 'join', code: host.code, name: `S${idx}J${i}` });
  }
  await untilTrue(() => room.clients.every((w) => w.last?.you), `sala ${idx} completa`);
  room.clients.forEach((w, i) => send(w, { t: 'team', team: i % 2 ? 'blue' : 'red' }));
  await untilTrue(() => !host.last.startError, `equipos sala ${idx}`);
  send(host, { t: 'settings', rounds: 9 });
  send(host, { t: 'start' });
  salas.push(room);
  return room;
}

console.log(`\n▶ Rampa de salas de ${SIZE} · +${STEP} cada ${STEP_S}s · tope ${MAX_ROOMS} · ${URL}\n`);
const sonda = probe(URL);
await sonda.start(400);
await wait(3000);
const reposo = sonda.stats();
console.log(`  línea base sin carga: ping p50 ${ms(reposo.p50)} · p95 ${ms(reposo.p95)}\n`);
console.log('  salas  jugadores  jugadas/s   ping p50   ping p95   jugada→todos p95   tráfico    errores');

let ultimaSana = 0, motivo = 'se alcanzó el tope de la rampa';
while (salas.length < MAX_ROOMS) {
  const objetivo = Math.min(MAX_ROOMS, salas.length + STEP);
  while (salas.length < objetivo) await abrirSala(salas.length);

  sonda.reset(); fanout.length = 0;
  const a0 = actions, b0 = salas.flat().reduce((a, r) => a + r.clients.reduce((x, w) => x + w.bytes, 0), 0);
  const t0 = performance.now();
  await wait(STEP_S * 1000);
  const dt = (performance.now() - t0) / 1000;
  const bytes = salas.reduce((a, r) => a + r.clients.reduce((x, w) => x + w.bytes, 0), 0) - b0;
  const s = sonda.stats();
  const f95 = pct(fanout, 95);
  const errs = salas.reduce((a, r) => a + r.clients.reduce((x, w) => x + w.errors.length, 0), 0) - errores;
  errores += errs;

  console.log(`  ${String(salas.length).padStart(5)}  ${String(salas.length * SIZE).padStart(9)}  ${((actions - a0) / dt).toFixed(1).padStart(9)}  ${ms(s.p50).padStart(9)}  ${ms(s.p95).padStart(9)}  ${(f95 ? ms(f95) : '—').padStart(17)}  ${(bytes / dt / 1024).toFixed(0).padStart(6)} KB/s  ${String(errs + caidas).padStart(7)}`);

  const sano = s.p95 < LIMITE_P95 && caidas === 0;
  if (sano) ultimaSana = salas.length;
  else {
    motivo = caidas ? `${caidas} conexiones caídas` : `el ping del servidor superó ${LIMITE_P95} ms (p95 ${ms(s.p95)})`;
    break;
  }
}

// ── recuperación: ¿vuelve en sí al quitar la carga? ─────────────
console.log('\n  bajando la carga…');
salas.forEach((r) => { r.cerrando = true; r.clients.forEach((w) => w.close()); });
await wait(8000);
sonda.reset();
await wait(6000);
const recup = sonda.stats();
sonda.stop();

console.log(`
── Veredicto ───────────────────────────────────────────────
  Salas de ${SIZE} simultáneas y sanas:  ${ultimaSana}   (${ultimaSana * SIZE} personas a la vez)
  Se paró porque: ${motivo}
  Ping tras quitar la carga: p50 ${ms(recup.p50)} (reposo inicial ${ms(reposo.p50)})
────────────────────────────────────────────────────────────`);
process.exit(0);
