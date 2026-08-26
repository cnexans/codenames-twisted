import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import * as G from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, any>} */
const rooms = new Map();
/** Sockets mirando la portada: reciben la lista de salas abiertas en vivo. */
const lobbySubs = new Set();

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase().trim());
}

function broadcast(room) {
  for (const [pid, ws] of room.sockets) {
    if (ws.readyState !== ws.OPEN) continue;
    ws.send(JSON.stringify(G.stateFor(room, pid)));
  }
  pushLobby();
}

/** Salas visibles en la portada: solo las que tienen a alguien conectado. */
function roomList() {
  const list = [];
  for (const room of rooms.values()) {
    const online = room.players.filter((p) => p.connected).length;
    if (!online) continue;
    list.push({
      code: room.code,
      players: online,
      phase: room.phase,
      round: room.round,
      rounds: room.settings.rounds,
      host: room.players.find((p) => p.id === room.hostId)?.name || '—',
      teams: {
        red: room.players.filter((p) => p.team === 'red').length,
        blue: room.players.filter((p) => p.team === 'blue').length,
      },
    });
  }
  return list.sort((a, b) => (a.phase === b.phase ? b.players - a.players : a.phase === 'lobby' ? -1 : 1));
}

function pushLobby() {
  if (!lobbySubs.size) return;
  const msg = JSON.stringify({ t: 'roomList', rooms: roomList() });
  for (const ws of lobbySubs) if (ws.readyState === ws.OPEN) ws.send(msg);
}

function fx(room, event, payload = {}) {
  const msg = JSON.stringify({ t: 'fx', event, ...payload });
  for (const ws of room.sockets.values()) if (ws.readyState === ws.OPEN) ws.send(msg);
}

const send = (ws, obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
const fail = (ws, msg) => send(ws, { t: 'error', msg });

wss.on('connection', (ws) => {
  const ctx = { room: null, playerId: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    try { handle(ws, ctx, m); } catch (e) { fail(ws, e.message || 'Error'); }
  });

  ws.on('close', () => {
    lobbySubs.delete(ws);
    const room = ctx.room;
    if (!room) return;
    if (room.sockets.get(ctx.playerId) === ws) {
      room.sockets.delete(ctx.playerId);
      const p = room.players.find((x) => x.id === ctx.playerId);
      if (p) p.connected = false;
      broadcast(room);
    }
  });
});

function handle(ws, ctx, m) {
  // --- Portada: lista de salas abiertas ---
  if (m.t === 'rooms') {
    lobbySubs.add(ws);
    return send(ws, { t: 'roomList', rooms: roomList() });
  }

  // --- Entrada ---
  if (m.t === 'create' || m.t === 'join') {
    const playerId = String(m.playerId || '').slice(0, 40) || Math.random().toString(36).slice(2, 12);
    const name = String(m.name || '').trim().slice(0, 18) || 'Agente';
    let room;
    if (m.t === 'create') {
      let code;
      do { code = G.makeCode(); } while (rooms.has(code));
      room = G.createRoom(code, playerId);
      room.sockets = new Map();
      rooms.set(code, room);
    } else {
      room = getRoom(m.code);
      if (!room) return fail(ws, 'Esa sala no existe');
      const known = room.players.some((p) => p.id === playerId);
      if (!known && room.players.length >= 20) return fail(ws, 'La sala está llena');
    }
    const prev = room.sockets.get(playerId);
    if (prev && prev !== ws && prev.readyState === prev.OPEN) prev.close(4001, 'sesion-reemplazada');
    lobbySubs.delete(ws);
    ctx.room = room;
    ctx.playerId = playerId;
    G.addPlayer(room, { id: playerId, name });
    room.sockets.set(playerId, ws);
    send(ws, { t: 'joined', code: room.code, playerId });
    return broadcast(room);
  }

  const room = ctx.room;
  if (!room) return fail(ws, 'No estás en una sala');
  const me = room.players.find((p) => p.id === ctx.playerId);
  if (!me) return fail(ws, 'Jugador desconocido');
  const isHost = room.hostId === me.id;

  switch (m.t) {
    case 'name': {
      // Renombrarse está permitido mientras se acomodan los equipos, no en plena ronda.
      if (room.phase === 'playing') return fail(ws, 'Puedes cambiar tu nombre entre rondas, no en plena partida');
      const nuevo = String(m.name || '').trim().slice(0, 18);
      if (!nuevo) return fail(ws, 'El nombre no puede quedar vacío');
      me.name = nuevo;
      break;
    }
    case 'team':
      G.setTeam(room, me, m.team);
      break;
    case 'shuffle':
      if (!isHost) return fail(ws, 'Solo el anfitrión puede mezclar equipos');
      G.shuffleTeams(room);
      break;
    case 'settings': {
      if (!isHost) return fail(ws, 'Solo el anfitrión cambia la configuración');
      const r = parseInt(m.rounds, 10);
      const s = parseInt(m.turnSeconds, 10);
      if (Number.isFinite(r)) room.settings.rounds = Math.max(1, Math.min(12, r));
      if (Number.isFinite(s)) room.settings.turnSeconds = [0, 60, 90, 120, 180].includes(s) ? s : 0;
      break;
    }
    case 'start':
      if (!isHost) return fail(ws, 'Solo el anfitrión inicia la partida');
      if (room.phase === 'playing') return fail(ws, 'La partida ya empezó');
      if (room.phase !== 'lobby') G.resetGame(room);
      G.startRound(room);
      fx(room, 'round-start');
      break;
    case 'clue':
      G.giveClue(room, me, m.word, m.count);
      fx(room, 'clue', { team: me.team });
      break;
    case 'guess': {
      const res = G.guess(room, me, parseInt(m.index, 10));
      fx(room, 'reveal', { hit: res.hit, team: me.team, index: parseInt(m.index, 10) });
      break;
    }
    case 'endTurn': {
      if (room.phase !== 'playing') return fail(ws, 'La ronda no está activa');
      const mine = me.team === room.game.turn && room.game.clue;
      if (!mine && !isHost) return fail(ws, 'No es tu turno');
      G.endTurn(room, mine ? null : 'host'); // el anfitrión rescata un turno atascado
      break;
    }
    case 'next':
      if (!isHost) return fail(ws, 'Solo el anfitrión avanza de ronda');
      G.nextRound(room);
      if (room.phase === 'playing') fx(room, 'round-start');
      break;
    case 'reset':
      if (!isHost) return fail(ws, 'Solo el anfitrión reinicia');
      G.resetGame(room);
      break;
    case 'ping':
      return send(ws, { t: 'pong' });
    default:
      return fail(ws, 'Acción desconocida');
  }
  broadcast(room);
}

// Reloj de turnos + limpieza de salas abandonadas
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (G.tick(room)) broadcast(room);
    const alive = [...room.sockets.values()].some((s) => s.readyState === s.OPEN);
    if (!alive) {
      room.emptySince ||= now;
      if (now - room.emptySince > 45 * 60 * 1000) { rooms.delete(code); pushLobby(); }
    } else {
      room.emptySince = null;
    }
  }
}, 1000);

// Keep-alive de sockets
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`🕵️  Nombres Clave escuchando en http://localhost:${PORT}`);
});
