/**
 * Prueba de carga 1: una sala llena jugando de verdad.
 *
 *   node test/load/room20.mjs [url] [jugadores] [rondas]
 *   node test/load/room20.mjs wss://codenames.cnexans.com/ws 20 2
 *
 * Mide cuánto tarda una jugada en llegar a TODOS los presentes (que es lo que
 * se nota en una partida real), el tráfico por jugada y si las reglas aguantan.
 */
import { connect, send, wait, untilTrue, pct, ms, probe } from './lib.mjs';

const URL = process.argv[2] || 'ws://localhost:3000/ws';
const N = +(process.argv[3] || 20);
const ROUNDS = +(process.argv[4] || 2);
const THINK_CLUE = 1200, THINK_GUESS = 900;

const clients = [];
const pending = [];           // jugadas en vuelo: {seq, t0, seen:Set}
const fanout = [];            // ms hasta que la jugada llega a todos
const first = [];             // ms hasta el primero
let actions = 0, roundNow = 0;

function onState(m, w) {
  if (!m.game) return;
  roundNow = m.round;
  // Cada jugada añade al menos una línea al registro: sirve de número de serie
  // (el registro se reinicia en cada ronda, así que la ronda va en la clave).
  for (const p of pending) {
    if (p.done || m.round !== p.round || !(m.log.length >= p.seq) || p.seen.has(w.idx)) continue;
    {
      p.seen.add(w.idx);
      const dt = performance.now() - p.t0;
      if (p.seen.size === 1) first.push(dt);
      if (p.seen.size === clients.length) { fanout.push(dt); p.done = true; }
    }
  }
  drive(m, w);
}

const acted = new Map();
function drive(m, w) {
  if (m.phase !== 'playing') return;
  const g = m.game, me = m.you;
  const key = `${m.round}:${g.turn}:${g.clue?.word || ''}:${g.board.filter((c) => c.revealed).length}`;
  if (acted.get(w.idx) === key) return;
  acted.set(w.idx, key);

  const mark = () => { pending.push({ round: m.round, seq: m.log.length + 1, t0: performance.now(), seen: new Set() }); actions++; };

  if (me.role === 'spymaster' && me.team === g.turn && !g.clue) {
    setTimeout(() => { mark(); send(w, { t: 'clue', word: 'SEÑUELO', count: 3 }); }, THINK_CLUE);
    return;
  }
  if (me.role === 'operative' && me.team === g.turn && g.clue) {
    // Actúa un solo espía por equipo: el primero de la lista, igual en todos los clientes.
    const turnos = m.players.filter((p) => p.team === g.turn && p.role === 'operative');
    if (turnos[0]?.id !== me.id) return;
    const libres = g.board.map((c, i) => [c, i]).filter(([c]) => !c.revealed).map(([, i]) => i);
    const pick = libres[Math.floor(Math.random() * libres.length)];
    setTimeout(() => { mark(); send(w, { t: 'guess', index: pick }); }, THINK_GUESS);
  }
}

console.log(`\n▶ Sala de ${N} jugadores · ${ROUNDS} rondas · ${URL}\n`);

// ── conexión ────────────────────────────────────────────────────
const t0 = performance.now();
for (let lote = 0; lote < N; lote += 10) {
  const abiertos = await Promise.all(
    Array.from({ length: Math.min(10, N - lote) }, () => connect(URL, { onState })),
  );
  abiertos.forEach((w) => { w.idx = clients.length; clients.push(w); });
}
const tConn = performance.now() - t0;

const host = clients[0];
send(host, { t: 'create', name: 'J0', playerId: 'L0' });
await untilTrue(() => host.code, 'sala creada');
const code = host.code;
const tJoin0 = performance.now();
for (let i = 1; i < N; i++) {
  send(clients[i], { t: 'join', code, name: `J${i}`, playerId: `L${i}` });
  await untilTrue(() => clients[i].last?.you, `J${i} dentro`);
}
const tJoin = performance.now() - tJoin0;
console.log(`  conexión de ${N} sockets: ${ms(tConn)} · entrada a la sala: ${ms(tJoin)} (${ms(tJoin / (N - 1))}/jugador)`);

for (let i = 0; i < N; i++) send(clients[i], { t: 'team', team: i % 2 ? 'blue' : 'red' });
await untilTrue(() => host.last.players.filter((p) => p.team).length === N, 'todos con equipo');
console.log(`  equipos: ${host.last.players.filter((p) => p.team === 'red').length} rojo · ${host.last.players.filter((p) => p.team === 'blue').length} azul`);

const sonda = probe(URL);
await sonda.start(500);
await wait(1500);
const base = sonda.stats();
sonda.reset();

// ── partida ─────────────────────────────────────────────────────
const bytes0 = clients.reduce((a, w) => a + w.bytes, 0);
const tPlay = performance.now();
send(host, { t: 'settings', rounds: ROUNDS });
send(host, { t: 'start' });

for (let r = 1; r <= ROUNDS; r++) {
  await untilTrue(() => host.last.phase === 'roundEnd' || host.last.phase === 'gameEnd', `fin de ronda ${r}`, 900, 100);
  if (host.last.phase === 'roundEnd') { send(host, { t: 'next' }); await wait(500); }
}
const dur = (performance.now() - tPlay) / 1000;
const bytes = clients.reduce((a, w) => a + w.bytes, 0) - bytes0;
const msgs = clients.reduce((a, w) => a + w.msgs, 0);
const errs = clients.flatMap((w) => w.errors);
const carga = sonda.stats();
sonda.stop();

const hechas = pending.filter((p) => p.done).length;
console.log(`
── Resultados ──────────────────────────────────────────────
  Partida            ${ROUNDS} rondas en ${dur.toFixed(1)} s · ${actions} jugadas · marcador ${host.last.scores.red}–${host.last.scores.blue}
  Jugada → 1er jugador   p50 ${ms(pct(first, 50))} · p95 ${ms(pct(first, 95))} · máx ${ms(Math.max(...first))}
  Jugada → los ${N}       p50 ${ms(pct(fanout, 50))} · p95 ${ms(pct(fanout, 95))} · máx ${ms(Math.max(...fanout))}   (${hechas} jugadas medidas)
  Ping al servidor   en reposo p50 ${ms(base.p50)} · jugando p50 ${ms(carga.p50)} / p95 ${ms(carga.p95)}
  Tráfico            ${(bytes / 1024 / 1024).toFixed(2)} MB en total · ${(bytes / actions / 1024).toFixed(1)} KB por jugada · ${(bytes / dur / 1024).toFixed(0)} KB/s
  Mensajes           ${msgs} recibidos · ${(msgs / dur).toFixed(0)}/s
  Errores            ${errs.length ? errs.slice(0, 5).join(' | ') : 'ninguno'}
  Desconexiones      ${clients.filter((w) => w.readyState !== 1).length}
────────────────────────────────────────────────────────────`);

clients.forEach((w) => w.close());
process.exit(errs.length ? 1 : 0);
