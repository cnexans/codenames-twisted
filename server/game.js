import crypto from 'node:crypto';
import { pickWords } from './words.js';

export const OTHER = { red: 'blue', blue: 'red' };
const BOARD_SIZE = 25;

export function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function createRoom(code, hostId) {
  return {
    code,
    hostId,
    createdAt: Date.now(),
    players: [], // orden de llegada = orden de rotación de operador
    settings: { rounds: 5, turnSeconds: 0 },
    scores: { red: 0, blue: 0 },
    round: 0,
    phase: 'lobby', // lobby | playing | roundEnd | gameEnd
    game: null,
    roundResult: null,
    history: [],
    log: [],
    usedWords: new Set(),
  };
}

/**
 * Dos identificadores por jugador, a propósito:
 *   · `token`  secreto, solo lo conocen el servidor y su dueño. Sirve para volver
 *              a tu sitio tras recargar. NUNCA se envía a los demás.
 *   · `id`     público, viaja en el estado para pintar equipos y roles.
 * Antes había uno solo y se difundía: cualquiera podía reconectarse con el id del
 * operador y quedarse con su vista del tablero.
 */
export function addPlayer(room, { token, name }) {
  let p = room.players.find((x) => x.token === token);
  if (p) {
    p.connected = true;
    if (name) p.name = name;
    return p;
  }
  p = {
    token,
    id: crypto.randomUUID().slice(0, 8),
    name: name || 'Agente',
    team: null, role: null, connected: true,
  };
  room.players.push(p);
  if (!room.hostId || !room.players.some((x) => x.id === room.hostId)) room.hostId = p.id;
  return p;
}

export const byToken = (room, token) => room.players.find((p) => p.token === token) || null;

export const teamMembers = (room, team) => room.players.filter((p) => p.team === team);

function logLine(room, entry) {
  room.log.push({ ...entry, round: room.round, at: Date.now() });
  if (room.log.length > 120) room.log.shift();
}

export function setTeam(room, player, team) {
  if (room.phase !== 'lobby' && room.phase !== 'roundEnd' && room.phase !== 'gameEnd') {
    throw new Error('No puedes cambiar de equipo en medio de una ronda');
  }
  player.team = team === 'red' || team === 'blue' ? team : null;
  player.role = null;
}

export function shuffleTeams(room) {
  if (room.phase === 'playing') throw new Error('No se pueden mezclar equipos durante la ronda');
  const ids = room.players.map((p) => p.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  ids.forEach((id, i) => {
    const p = room.players.find((x) => x.id === id);
    p.team = i % 2 === 0 ? 'red' : 'blue';
    p.role = null;
  });
}

/** Operador (spymaster) de la ronda: rota por orden de llegada dentro del equipo. */
export function spymasterFor(room, team, round = room.round) {
  const members = teamMembers(room, team);
  if (!members.length) return null;
  return members[(Math.max(1, round) - 1) % members.length];
}

export function canStart(room) {
  const red = teamMembers(room, 'red').length;
  const blue = teamMembers(room, 'blue').length;
  if (red < 2 || blue < 2) return 'Cada equipo necesita al menos 2 agentes (1 operador + 1 espía)';
  return null;
}

export function startRound(room) {
  const err = canStart(room);
  if (err) throw new Error(err);

  room.round += 1;
  room.roundResult = null;

  // Asigna roles: operador rotativo por equipo, el resto espías de campo.
  for (const team of ['red', 'blue']) {
    const boss = spymasterFor(room, team);
    for (const p of teamMembers(room, team)) p.role = p.id === boss.id ? 'spymaster' : 'operative';
  }

  const starting = room.round % 2 === 1 ? 'red' : 'blue';
  const words = pickWords(BOARD_SIZE, room.usedWords);
  words.forEach((w) => room.usedWords.add(w));
  if (room.usedWords.size > 600) room.usedWords = new Set(words);

  const types = [
    ...Array(9).fill(starting),
    ...Array(8).fill(OTHER[starting]),
    ...Array(7).fill('neutral'),
    'assassin',
  ];
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }

  room.game = {
    board: words.map((word, i) => ({ word, type: types[i], revealed: false, revealedBy: null })),
    startingTeam: starting,
    turn: starting,
    clue: null,
    guessesLeft: 0,
    remaining: { red: starting === 'red' ? 9 : 8, blue: starting === 'blue' ? 9 : 8 },
    deadline: null,
  };
  room.phase = 'playing';
  room.log = [];
  logLine(room, { kind: 'round', text: `Ronda ${room.round}: empieza el equipo ${starting === 'red' ? 'ROJO' : 'AZUL'}` });
  armTimer(room);
  return room;
}

function armTimer(room) {
  const secs = room.settings.turnSeconds;
  room.game.deadline = secs > 0 ? Date.now() + secs * 1000 : null;
}

export function giveClue(room, player, word, count) {
  const g = room.game;
  if (room.phase !== 'playing') throw new Error('La ronda no está activa');
  if (player.role !== 'spymaster' || player.team !== g.turn) throw new Error('No eres el operador en turno');
  if (g.clue) throw new Error('Ya diste una pista este turno');

  const clean = String(word || '').trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > 24 || /\s/.test(clean)) throw new Error('La pista debe ser una sola palabra');
  const n = Math.max(0, Math.min(9, parseInt(count, 10) || 0));

  g.clue = { word: clean.toUpperCase(), count: n, by: player.name, team: player.team };
  g.guessesLeft = n === 0 ? 99 : n + 1;
  logLine(room, { kind: 'clue', team: player.team, text: `${player.name}: ${clean.toUpperCase()} — ${n === 0 ? '∞' : n}` });
  armTimer(room);
}

export function guess(room, player, index) {
  const g = room.game;
  if (room.phase !== 'playing') throw new Error('La ronda no está activa');
  if (!g.clue) throw new Error('Esperando la pista del operador');
  if (player.role !== 'operative' || player.team !== g.turn) throw new Error('No es tu turno de adivinar');
  const card = g.board[index];
  if (!card || card.revealed) throw new Error('Esa carta no está disponible');

  const team = g.turn;
  card.revealed = true;
  card.revealedBy = team;
  const labels = { red: 'ROJO', blue: 'AZUL', neutral: 'transeúnte', assassin: 'ASESINO' };
  logLine(room, { kind: 'guess', team, text: `${player.name} destapó ${card.word} → ${labels[card.type]}` });

  if (card.type === 'assassin') {
    endRound(room, OTHER[team], 'assassin');
    return { hit: 'assassin' };
  }
  if (card.type === 'neutral') {
    endTurn(room);
    return { hit: 'neutral' };
  }

  g.remaining[card.type] -= 1;
  if (g.remaining[card.type] === 0) {
    endRound(room, card.type, 'words');
    return { hit: card.type === team ? 'own' : 'enemy' };
  }
  if (card.type !== team) {
    endTurn(room);
    return { hit: 'enemy' };
  }
  g.guessesLeft -= 1;
  if (g.guessesLeft <= 0) endTurn(room);
  else armTimer(room);
  return { hit: 'own' };
}

export function endTurn(room, reason = null) {
  const g = room.game;
  if (room.phase !== 'playing') return;
  g.turn = OTHER[g.turn];
  g.clue = null;
  g.guessesLeft = 0;
  const texts = {
    time: 'Se acabó el tiempo. Cambio de turno.',
    host: 'El anfitrión saltó el turno.',
  };
  logLine(room, { kind: 'turn', team: g.turn, text: texts[reason] || `Turno del equipo ${g.turn === 'red' ? 'ROJO' : 'AZUL'}` });
  armTimer(room);
}

export function endRound(room, winner, reason) {
  const g = room.game;
  const total = { red: g.startingTeam === 'red' ? 9 : 8, blue: g.startingTeam === 'blue' ? 9 : 8 };
  const found = { red: total.red - g.remaining.red, blue: total.blue - g.remaining.blue };
  const points = {
    red: found.red + (winner === 'red' ? 3 : 0),
    blue: found.blue + (winner === 'blue' ? 3 : 0),
  };
  room.scores.red += points.red;
  room.scores.blue += points.blue;

  room.roundResult = { round: room.round, winner, reason, points, found, spymasters: {
    red: spymasterFor(room, 'red')?.name || '—',
    blue: spymasterFor(room, 'blue')?.name || '—',
  } };
  room.history.push(room.roundResult);
  g.deadline = null;
  g.clue = null;
  room.phase = 'roundEnd';
  logLine(room, {
    kind: 'round',
    team: winner,
    text: reason === 'assassin'
      ? `¡Asesino! Gana la ronda el equipo ${winner === 'red' ? 'ROJO' : 'AZUL'}`
      : `Equipo ${winner === 'red' ? 'ROJO' : 'AZUL'} completó sus contactos`,
  });
}

export function nextRound(room) {
  if (room.phase !== 'roundEnd') throw new Error('La ronda sigue en curso');
  if (room.round >= room.settings.rounds) {
    room.phase = 'gameEnd';
    return;
  }
  startRound(room);
}

export function resetGame(room) {
  room.scores = { red: 0, blue: 0 };
  room.round = 0;
  room.phase = 'lobby';
  room.game = null;
  room.roundResult = null;
  room.history = [];
  room.log = [];
  room.usedWords = new Set();
  for (const p of room.players) p.role = null;
}

export function tick(room) {
  if (room.phase !== 'playing' || !room.game?.deadline) return false;
  if (Date.now() >= room.game.deadline) {
    endTurn(room, 'time');
    return true;
  }
  return false;
}

/** Estado personalizado: solo el operador (o al final de ronda) ve los colores. */
export function stateFor(room, token) {
  const me = byToken(room, token);
  const revealAll = room.phase !== 'playing' || me?.role === 'spymaster';
  const g = room.game;
  return {
    t: 'state',
    code: room.code,
    hostId: room.hostId,
    you: me && { id: me.id, name: me.name, team: me.team, role: me.role },
    players: room.players.map((p) => ({ id: p.id, name: p.name, team: p.team, role: p.role, connected: p.connected })),
    settings: room.settings,
    scores: room.scores,
    round: room.round,
    phase: room.phase,
    startError: room.phase === 'lobby' ? canStart(room) : null,
    nextSpymasters: {
      red: spymasterFor(room, 'red', room.phase === 'playing' ? room.round : room.round + 1)?.id || null,
      blue: spymasterFor(room, 'blue', room.phase === 'playing' ? room.round : room.round + 1)?.id || null,
    },
    roundResult: room.roundResult,
    history: room.history,
    log: room.log,
    game: g && {
      turn: g.turn,
      startingTeam: g.startingTeam,
      clue: g.clue,
      guessesLeft: g.guessesLeft > 90 ? null : g.guessesLeft,
      remaining: g.remaining,
      deadline: g.deadline,
      board: g.board.map((c) => ({
        word: c.word,
        revealed: c.revealed,
        revealedBy: c.revealedBy,
        type: c.revealed || revealAll ? c.type : null,
      })),
    },
  };
}
