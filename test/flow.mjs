/**
 * Prueba de extremo a extremo de las reglas, contra un servidor real.
 *
 *   node test/flow.mjs                        # contra localhost:3000
 *   node test/flow.mjs ws://1.2.3.4:3000/ws   # contra el servidor desplegado
 *
 * No asume el orden de llegada de los jugadores: los roles se leen del estado.
 */
import WebSocket from 'ws';

const URL = process.argv[2] || 'ws://localhost:3000/ws';
const LAG = URL.includes('localhost') ? 1 : 6; // margen extra si el servidor es remoto
const wait = (ms) => new Promise((r) => setTimeout(r, ms * LAG));

let fails = 0;
const ok = (c, m) => { console.log(c ? `✅ ${m}` : `❌ ${m}`); if (!c) fails++; };

function client(tag) {
  return new Promise((res) => {
    const w = new WebSocket(URL);
    w.tag = tag;
    w.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'state') w.last = m;
      if (m.t === 'joined') w.code = m.code;
      if (m.t === 'roomList') w.rooms = m.rooms;
      if (m.t === 'error') w.lastError = m.msg;
    });
    w.on('open', () => res(w));
  });
}
const send = (w, o) => w.send(JSON.stringify(o));
/** Espera a que el estado de `w` cumpla una condición (o falla por tiempo). */
async function until(w, pred, what, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (w.last && pred(w.last)) return w.last;
    await wait(50);
  }
  throw new Error(`timeout esperando: ${what}`);
}
/** Espera a que una condición cualquiera se cumpla. */
async function untilTrue(fn, what, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return;
    await wait(50);
  }
  throw new Error(`timeout esperando: ${what}`);
}
const bossOf = (all, team) => all.find((w) => w.last.you.role === 'spymaster' && w.last.you.team === team);
const spyOf = (all, team) => all.find((w) => w.last.you.role === 'operative' && w.last.you.team === team);

const [a, b, c, d] = await Promise.all(['A', 'B', 'C', 'D'].map(client));
const all = [a, b, c, d];

// ── sala y equipos ──────────────────────────────────────────────
send(a, { t: 'create', name: 'Ana' });
await until(a, (s) => s.code, 'sala creada');
const code = a.code;
for (const [w, name] of [[b, 'Beto'], [c, 'Cris'], [d, 'Dani']]) {
  send(w, { t: 'join', code, name });
  await until(w, (s) => s.you?.name === name, `${name} dentro`);
}
ok(a.last.players.length === 4, '4 jugadores en la sala');

// ── salas abiertas y renombrado ─────────────────────────────────
const mirón = await client('M');
send(mirón, { t: 'rooms' });
await untilTrue(() => mirón.rooms, 'lista de salas');
const fila = mirón.rooms.find((r) => r.code === code);
ok(!!fila && fila.players === 4 && fila.phase === 'lobby', 'la sala aparece en la lista de salas abiertas');

send(b, { t: 'name', name: 'Beto el Rápido' });
await until(a, (s) => s.players.some((p) => p.name === 'Beto el Rápido'), 'renombrado en la sala');
ok(true, 'un jugador puede renombrarse mientras se arman los equipos');
send(b, { t: 'name', name: '   ' });
await wait(120);
ok(b.lastError === 'El nombre no puede quedar vacío', 'no se admite un nombre vacío');
send(b, { t: 'name', name: 'Beto' });
await until(a, (s) => s.players.some((p) => p.name === 'Beto'), 'nombre restaurado');

send(a, { t: 'team', team: 'red' }); send(b, { t: 'team', team: 'red' });
send(c, { t: 'team', team: 'blue' }); send(d, { t: 'team', team: 'blue' });
await until(a, (s) => !s.startError, 'equipos completos');
ok(true, 'equipos válidos para empezar');

// ── ronda 1 ─────────────────────────────────────────────────────
send(a, { t: 'settings', rounds: 2 });
send(a, { t: 'start' });
await until(a, (s) => s.phase === 'playing', 'ronda 1');
ok(a.last.round === 1 && a.last.game.turn === 'red', 'ronda 1 en curso y empieza rojo');

send(b, { t: 'name', name: 'Tramposo' });
await wait(120);
ok(/entre rondas/.test(b.lastError || ''), 'renombrarse en plena ronda queda bloqueado');
ok(a.last.players.every((p) => p.name !== 'Tramposo'), 'el nombre no cambió durante la partida');

const redBoss = bossOf(all, 'red'), blueBoss = bossOf(all, 'blue');
const redSpy = spyOf(all, 'red'), blueSpy = spyOf(all, 'blue');
ok(!!redBoss && !!blueBoss, `un operador por equipo (${redBoss.last.you.name} / ${blueBoss.last.you.name})`);

// El id público que todos ven NO debe servir para robar la sesión del operador.
const idPublicoDelOperador = redSpy.last.players.find((p) => p.role === 'spymaster' && p.team === 'red').id;
const impostor = await client('IMP');
send(impostor, { t: 'join', code, name: 'Impostor', token: idPublicoDelOperador });
await until(impostor, (s) => s.you, 'impostor dentro');
ok(impostor.last.game.board.every((x) => x.type === null),
   'con el id público de otro no se hereda su vista del tablero');
ok(impostor.last.you.role !== 'spymaster', 'el impostor entra como jugador nuevo, no como el operador');
ok(redBoss.last.game.board.every((x) => x.type), 'el operador ve todos los colores');
ok([redSpy, blueSpy].every((w) => w.last.game.board.every((x) => x.type === null)), 'los espías no ven ningún color');

const key = redBoss.last.game.board; // mapa real de la ronda

send(redBoss, { t: 'clue', word: 'dos palabras', count: 2 });
await wait(120);
ok(!redBoss.last.game.clue && /una sola palabra/.test(redBoss.lastError || ''), 'pista de dos palabras rechazada');
send(redSpy, { t: 'clue', word: 'ilegal', count: 1 });
await wait(120);
ok(!redSpy.last.game.clue, 'un espía no puede dar pistas');

send(redBoss, { t: 'clue', word: 'sombra', count: 2 });
await until(redSpy, (s) => s.game.clue, 'pista publicada');
ok(redSpy.last.game.clue.word === 'SOMBRA' && redSpy.last.game.guessesLeft === 3, 'pista publicada con 3 intentos');

const roja = key.findIndex((x) => x.type === 'red' && !x.revealed);
send(redSpy, { t: 'guess', index: roja });
await until(redSpy, (s) => s.game.remaining.red === 8, 'acierto rojo');
ok(redSpy.last.game.turn === 'red', 'acertar mantiene el turno');

send(redSpy, { t: 'guess', index: key.findIndex((x) => x.type === 'neutral') });
await until(redSpy, (s) => s.game.turn === 'blue', 'cambio de turno');
ok(true, 'el transeúnte termina el turno');

send(blueBoss, { t: 'clue', word: 'noche', count: 1 });
await until(blueSpy, (s) => s.game.clue, 'pista azul');
send(blueSpy, { t: 'guess', index: key.findIndex((x) => x.type === 'assassin') });
await until(a, (s) => s.phase === 'roundEnd', 'fin de ronda');
ok(a.last.roundResult.winner === 'red' && a.last.roundResult.reason === 'assassin', 'el asesino da la ronda al rival');
ok(a.last.scores.red >= 3, `puntos de la ronda: ${JSON.stringify(a.last.scores)}`);

// ── elegir a dedo el operador de la próxima ronda ───────────────
// Se elige a quien la rotación NO tocaría: el operador que acaba de serlo.
// Si en la ronda 2 vuelve a salir, la elección manual mandó de verdad.
const rojos = a.last.players.filter((p) => p.team === 'red');
const aDedo = rojos.find((p) => p.id === redBoss.last.you.id);
const porRotacion = rojos.find((p) => p.id !== aDedo.id);
send(a, { t: 'spymaster', team: 'red', playerId: aDedo.id });
await until(a, (s) => s.nextSpymasters.red === aDedo.id, 'operador elegido');
ok(true, `se elige a ${aDedo.name}, que repetiría (por rotación tocaba ${porRotacion.name})`);
send(c, { t: 'spymaster', team: 'red', playerId: rojos[0].id });
await wait(150);
ok(/ese equipo/.test(c.lastError || ''), 'alguien del otro equipo no puede elegirlo');

// ── ronda 2: cambian las palabras ───────────────────────────────
send(a, { t: 'next' });
await until(a, (s) => s.phase === 'playing' && s.round === 2, 'ronda 2');
ok(a.last.game.turn === 'blue', 'la ronda 2 la empieza el otro equipo');
const redBoss2 = bossOf(all, 'red'), blueBoss2 = bossOf(all, 'blue');
ok(redBoss2.last.you.id === aDedo.id && redBoss2.last.you.id !== porRotacion.id,
   `manda la elección manual: repite ${redBoss2.last.you.name} en vez de ${porRotacion.name}`);
ok(blueBoss2.last.you.id !== blueBoss.last.you.id, `el operador azul rotó (${blueBoss.last.you.name} → ${blueBoss2.last.you.name})`);
// El operador no puede cortar el turno de los suyos: sabe la clave y sería una
// forma encubierta de dar pistas ("paren, la siguiente es el asesino"). El
// anfitrión sí puede saltar turnos, pero eso queda escrito en el registro.
send(blueBoss2, { t: 'endTurn' });
await wait(150);
ok(blueBoss2.last.game.turn === 'blue' && /No es tu turno/.test(blueBoss2.lastError || ''),
   'el operador no puede terminar el turno de su equipo');

const antes = new Set(key.map((x) => x.word));
ok(redBoss2.last.game.board.every((x) => !antes.has(x.word)), 'las 25 palabras de la ronda 2 son nuevas');

// completar la ronda destapando todas las cartas azules
const azules = blueBoss2.last.game.board.map((x, i) => [x, i]).filter(([x]) => x.type === 'blue').map(([, i]) => i);
send(blueBoss2, { t: 'clue', word: 'final', count: 9 });
await until(spyOf(all, 'blue'), (s) => s.game.clue, 'pista final');
for (const i of azules) { send(spyOf(all, 'blue'), { t: 'guess', index: i }); await wait(70); }
await until(a, (s) => s.phase === 'roundEnd', 'fin de ronda 2');
ok(a.last.roundResult.winner === 'blue', 'gana quien completa sus contactos');

send(a, { t: 'next' });
await until(a, (s) => s.phase === 'gameEnd', 'fin de partida');
ok(a.last.history.length === 2, 'historial con las 2 rondas');
console.log(`\nMarcador final: rojo ${a.last.scores.red} — azul ${a.last.scores.blue}`);

[...all, mirón, impostor].forEach((w) => w.close());
console.log(fails ? `\n${fails} fallo(s)` : '\nTodo en orden ✅');
process.exit(fails ? 1 : 0);
