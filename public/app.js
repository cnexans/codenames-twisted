/* ══════════ Nombres Clave · cliente ══════════ */
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const TEAM_ES = { red: 'ROJO', blue: 'AZUL' };

const store = {
  get id() {
    let v = localStorage.getItem('nc:id');
    if (!v) { v = Math.random().toString(36).slice(2, 12); localStorage.setItem('nc:id', v); }
    return v;
  },
  get name() { return localStorage.getItem('nc:name') || ''; },
  set name(v) { localStorage.setItem('nc:name', v); },
};

let ws = null, state = null, pending = null, retry = 0, rooms = [];
let armed = -1, peeking = false, lastPhaseKey = '';

/* ── conexión ── */
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0;
    if (pending) ws.send(JSON.stringify(pending));
    else ws.send(JSON.stringify({ t: 'rooms' })); // portada: lista de salas en vivo
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'state') { state = m; render(); }
    else if (m.t === 'roomList') { rooms = m.rooms; renderRooms(); }
    else if (m.t === 'joined') { pending = { t: 'join', code: m.code, name: nameValue(), playerId: store.id }; location.hash = m.code; }
    else if (m.t === 'error') toast(m.msg, true);
    else if (m.t === 'fx') sfx(m);
  };
  ws.onclose = (ev) => {
    if (ev.code === 4001) { // esta misma cuenta abrió la sala en otra pestaña
      pending = null; state = null;
      return toast('Abriste esta sala en otra pestaña. Esta se quedó en pausa.', true);
    }
    if (pending) toast('Reconectando…');
    setTimeout(connect, Math.min(4000, 400 * ++retry));
  };
  ws.onerror = () => ws.close();
}
const send = (obj) => ws?.readyState === 1 ? ws.send(JSON.stringify(obj)) : toast('Sin conexión…', true);
const nameValue = () => ($('#in-name').value.trim() || store.name || 'Agente').slice(0, 18);

/* ── entrada ── */
$('#in-name').value = store.name;
$('#btn-create').onclick = () => {
  store.name = nameValue();
  pending = { t: 'create', name: store.name, playerId: store.id };
  send(pending);
};
$('#form-join').onsubmit = (e) => {
  e.preventDefault();
  const code = $('#in-code').value.trim().toUpperCase();
  if (code.length !== 4) return toast('El código tiene 4 caracteres', true);
  joinCode(code);
};
function joinCode(code) {
  store.name = nameValue();
  pending = { t: 'join', code, name: store.name, playerId: store.id };
  send(pending);
}

function renderRooms() {
  const panel = $('#rooms-panel'), ul = $('#rooms');
  panel.hidden = false;
  ul.innerHTML = '';
  if (!rooms.length) {
    const p = el('p', 'rooms-empty', 'Todavía no hay salas abiertas. Crea una y comparte el código.');
    ul.append(p);
    return;
  }
  for (const r of rooms) {
    const li = el('li', 'room' + (r.phase === 'lobby' ? '' : ' playing'));
    li.append(el('div', 'room-code', r.code));
    const info = el('div', 'room-info');
    info.append(el('b', 'live', r.phase === 'lobby' ? 'Armando equipos' : `Ronda ${r.round}/${r.rounds}`));
    const meta = el('span');
    meta.append(el('i', 't-red', String(r.teams.red)), document.createTextNode(' vs '), el('i', 't-blue', String(r.teams.blue)));
    meta.append(document.createTextNode(` · ${r.players} ${r.players === 1 ? 'conectado' : 'conectados'} · ${r.host}`));
    info.append(meta);
    li.append(info);
    const b = el('button', 'btn', r.phase === 'lobby' ? 'Entrar' : 'Mirar');
    b.onclick = () => joinCode(r.code);
    li.append(b);
    ul.append(li);
  }
}

if (location.hash.length === 5) {
  const code = location.hash.slice(1).toUpperCase();
  $('#in-code').value = code;
  // Volver a entrar sin fricción tras un refresco (mismo playerId guardado).
  if (store.name) pending = { t: 'join', code, name: store.name, playerId: store.id };
}

document.querySelectorAll('[data-team]').forEach((b) => {
  b.onclick = () => send({ t: 'team', team: b.dataset.team === 'none' ? null : b.dataset.team });
});
const nameField = $('#lobby-name');
nameField.onchange = () => {
  const nuevo = nameField.value.trim().slice(0, 18);
  if (!nuevo || nuevo === state?.you?.name) { nameField.value = state?.you?.name || ''; return; }
  store.name = nuevo;
  $('#in-name').value = nuevo;
  send({ t: 'name', name: nuevo });
};
nameField.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); nameField.blur(); } };
$('#btn-shuffle').onclick = () => send({ t: 'shuffle' });
$('#btn-start').onclick = () => send({ t: 'start' });
$('#btn-next').onclick = () => { peeking = false; send({ t: 'next' }); };
$('#btn-reset').onclick = () => { peeking = false; send({ t: 'reset' }); };
$('#btn-peek').onclick = () => { peeking = true; render(); };
$('#set-rounds').onchange = () => send({ t: 'settings', rounds: +$('#set-rounds').value });
$('#set-timer').onchange = () => send({ t: 'settings', turnSeconds: +$('#set-timer').value });
$('#btn-copy').onclick = async () => {
  try { await navigator.clipboard.writeText(`${location.origin}/#${state.code}`); toast('Enlace copiado'); }
  catch { toast(`Código: ${state.code}`); }
};

/* ── render ── */
function render() {
  if (!state?.you) { show('#screen-home'); return; }
  const phaseKey = `${state.phase}:${state.round}:${state.game?.turn}:${state.game?.clue?.word || ''}`;
  if (phaseKey !== lastPhaseKey) { armed = -1; lastPhaseKey = phaseKey; }

  if (state.phase === 'lobby') { show('#screen-lobby'); renderLobby(); }
  else { show('#screen-game'); renderGame(); }
  renderOverlay();
}
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id.slice(1);
}

function renderLobby() {
  $('#lobby-code').textContent = state.code;
  if (document.activeElement !== nameField) nameField.value = state.you.name;
  const groups = { red: $('#lobby-red'), blue: $('#lobby-blue'), none: $('#lobby-none') };
  Object.values(groups).forEach((u) => (u.innerHTML = ''));
  for (const p of state.players) {
    const li = playerChip(p, state.nextSpymasters[p.team] === p.id ? `operador ronda ${state.round + 1}` : null);
    groups[p.team || 'none'].appendChild(li);
  }
  for (const t of ['red', 'blue']) {
    const slot = $(`#pick-${t}`);
    slot.innerHTML = '';
    slot.append(spymasterPicker(t));
  }
  const host = state.hostId === state.you.id;
  $('#set-rounds').value = state.settings.rounds;
  $('#set-timer').value = state.settings.turnSeconds;
  for (const n of ['#set-rounds', '#set-timer', '#btn-shuffle']) $(n).disabled = !host;
  $('#btn-start').disabled = !host || !!state.startError;
  $('#lobby-warn').textContent = state.startError || '';
  $('#host-note').textContent = host ? 'Eres el anfitrión: tú controlas la configuración y el inicio.' : 'El anfitrión inicia la partida.';
}

/**
 * Selector del operador de la próxima ronda. Puede tocarlo quien esté en ese
 * equipo (o el anfitrión); el resto solo ve quién será.
 */
function spymasterPicker(team, { conEquipo = false } = {}) {
  const ronda = state.round + 1;
  const miembros = state.players.filter((p) => p.team === team && p.connected);
  const wrap = el('label', `pick ${team}`);
  // En la sala de espera cada selector vive dentro de su tarjeta de equipo; en el
  // modal van uno al lado del otro, así que ahí sí hace falta decir de quién es.
  wrap.append(el('span', '', conEquipo ? `Operador ${TEAM_ES[team]} · ronda ${ronda}` : `Operador ronda ${ronda}`));
  const sel = el('select');
  if (!miembros.length) sel.append(new Option('—', ''));
  for (const p of miembros) {
    const o = new Option(p.name, p.id);
    if (p.id === state.nextSpymasters[team]) o.selected = true;
    sel.append(o);
  }
  const puedo = state.you.team === team || state.hostId === state.you.id;
  sel.disabled = !puedo || !miembros.length;
  sel.title = puedo ? 'Elige quién dará las pistas la próxima ronda' : `Lo elige el equipo ${TEAM_ES[team]}`;
  sel.onchange = () => send({ t: 'spymaster', team, playerId: sel.value });
  wrap.append(sel);
  return wrap;
}

function playerChip(p, extra) {
  const li = el('li', p.id === state.you.id ? 'me' : '');
  if (!p.connected) li.classList.add('off');
  li.append(el('span', '', p.name + (p.id === state.hostId ? ' ★' : '')));
  const label = p.role === 'spymaster' ? 'operador' : extra;
  if (label) li.append(el('span', 'tag' + (p.role === 'spymaster' ? ' boss' : ''), label));
  return li;
}

function renderGame() {
  const g = state.game, me = state.you;
  $('#game-code').textContent = state.code;
  $('#score-red').textContent = state.scores.red;
  $('#score-blue').textContent = state.scores.blue;
  $('#round-now').textContent = state.round;
  $('#round-total').textContent = state.settings.rounds;
  $('#left-red').textContent = g.remaining.red;
  $('#left-blue').textContent = g.remaining.blue;
  for (const t of ['red', 'blue']) {
    document.querySelector(`.side.${t}`).classList.toggle('active', state.phase === 'playing' && g.turn === t);
    const ul = $(`#team-${t}`); ul.innerHTML = '';
    state.players.filter((p) => p.team === t).forEach((p) => ul.appendChild(playerChip(p)));
  }

  const canGuess = state.phase === 'playing' && !!g.clue && me.role === 'operative' && me.team === g.turn;
  const board = $('#board');
  if (board.childElementCount !== g.board.length) board.innerHTML = '';
  g.board.forEach((c, i) => {
    let node = board.children[i];
    if (!node) {
      node = el('button', 'card');
      node.append(el('span', 'word'));
      node.onclick = () => onCard(i);
      board.appendChild(node);
    }
    node.querySelector('.word').textContent = c.word;
    node.className = 'card' + (c.revealed ? ` done ${c.type}` : c.type ? ` peek-${c.type}` : '') +
      (canGuess && !c.revealed ? ' clickable' : '') + (armed === i ? ' armed' : '');
    node.disabled = !canGuess || c.revealed;
    node.querySelector('.badge')?.remove();
    node.querySelector('.confirm')?.remove();
    if (c.revealed && c.type !== 'neutral') {
      const img = el('img', 'badge');
      img.src = c.type === 'assassin' ? '/img/assassin.svg' : `/img/spy-${c.type}.svg`;
      img.alt = ''; node.appendChild(img);
    }
    if (armed === i) node.appendChild(el('div', 'confirm', 'PULSA OTRA VEZ PARA CONFIRMAR'));
  });

  renderActionbar();
  const log = $('#log'); log.innerHTML = '';
  state.log.slice(-6).forEach((e) => log.appendChild(el('div', `entry ${e.team || ''} ${e.kind}`, e.text)));
  tickTimer();
}

function onCard(i) {
  const c = state.game.board[i];
  if (c.revealed) return;
  if (armed !== i) { armed = i; renderGame(); return; }
  armed = -1;
  send({ t: 'guess', index: i });
}

function renderActionbar() {
  const bar = $('#actionbar'), g = state.game, me = state.you;
  bar.innerHTML = '';
  bar.className = 'actionbar ' + (g.turn === 'red' ? 'red-turn' : 'blue-turn');

  if (state.phase !== 'playing') {
    bar.append(el('span', 'hint', state.phase === 'gameEnd' ? 'Partida terminada.' : 'Ronda terminada. Todos los colores quedaron a la vista.'));
    const b = el('button', 'btn btn-primary', 'Ver resultados');
    b.onclick = () => { peeking = false; render(); };
    bar.append(el('span', 'spacer'), b);
    return;
  }
  const boss = state.players.find((p) => p.id === state.nextSpymasters[g.turn]);
  bar.append(el('span', `turn-label ${g.turn}`, `Turno del equipo ${TEAM_ES[g.turn]}`));

  if (!g.clue) {
    if (me.role === 'spymaster' && me.team === g.turn) {
      const form = el('form', 'clue-form');
      const input = el('input'); input.placeholder = 'PISTA (una palabra)'; input.maxLength = 24; input.autocomplete = 'off';
      const sel = el('select');
      for (let n = 0; n <= 9; n++) sel.append(new Option(n === 0 ? '∞' : n, n));
      sel.value = 1;
      const btn = el('button', 'btn btn-primary', 'Dar pista'); btn.type = 'submit';
      form.append(input, sel, btn);
      form.onsubmit = (e) => { e.preventDefault(); if (!input.value.trim()) return; send({ t: 'clue', word: input.value, count: +sel.value }); };
      bar.append(el('span', 'spacer'), form);
      setTimeout(() => input.focus(), 0);
    } else {
      bar.append(el('span', 'spacer'), el('span', 'hint', `${boss ? boss.name : 'El operador'} está pensando la pista…`));
      hostRescue(bar);
    }
    return;
  }

  const pill = el('div', 'clue-pill');
  pill.append(el('span', '', g.clue.word), el('span', 'n', g.clue.count === 0 ? '∞' : String(g.clue.count)));
  bar.append(pill);
  bar.append(el('span', 'hint', g.guessesLeft == null ? 'Intentos ilimitados' : `Intentos restantes: ${g.guessesLeft}`));
  bar.append(el('span', 'spacer'));
  if (me.role === 'operative' && me.team === g.turn) {
    const b = el('button', 'btn', 'Terminar turno');
    b.onclick = () => send({ t: 'endTurn' });
    bar.append(b);
  } else if (me.role === 'spymaster' && me.team === g.turn) {
    bar.append(el('span', 'hint', 'Silencio absoluto: tu equipo está adivinando.'));
  } else {
    bar.append(el('span', 'hint', `Adivina el equipo ${TEAM_ES[g.turn]}…`));
  }
  hostRescue(bar);
}

/** El anfitrión puede saltar un turno atascado (p. ej. si el operador se desconectó). */
function hostRescue(bar) {
  const me = state.you, g = state.game;
  if (state.hostId !== me.id) return;
  if (me.team === g.turn && (me.role === 'operative' ? g.clue : !g.clue)) return;
  const b = el('button', 'btn btn-ghost', 'Saltar turno');
  b.onclick = () => send({ t: 'endTurn' });
  bar.append(b);
}

function renderOverlay() {
  const ov = $('#overlay');
  const over = state.phase === 'roundEnd' || state.phase === 'gameEnd';
  if (!over || peeking) { ov.hidden = true; return; }
  ov.hidden = false;
  const host = state.hostId === state.you.id;
  const r = state.roundResult;
  const art = $('#modal-art');

  if (state.phase === 'gameEnd') {
    const { red, blue } = state.scores;
    const win = red === blue ? null : red > blue ? 'red' : 'blue';
    $('#modal-title').textContent = win ? `¡Gana el equipo ${TEAM_ES[win]}!` : '¡Empate técnico!';
    $('#modal-title').className = win || '';
    $('#modal-sub').textContent = `${state.settings.rounds} rondas jugadas · misión cumplida`;
    art.hidden = !win; if (win) art.src = `/img/spy-${win}.svg`;
    $('#btn-next').hidden = true;
    $('#btn-reset').hidden = !host;
    $('#btn-reset').textContent = 'Jugar otra vez';
  } else {
    $('#modal-title').textContent = `Ronda ${r.round}: gana ${TEAM_ES[r.winner]}`;
    $('#modal-title').className = r.winner;
    $('#modal-sub').textContent = r.reason === 'assassin'
      ? `El equipo ${TEAM_ES[r.winner === 'red' ? 'blue' : 'red']} destapó al asesino.`
      : `Contactó a todos sus agentes. Operadores: ${r.spymasters.red} (rojo) y ${r.spymasters.blue} (azul).`;
    art.hidden = false; art.src = r.reason === 'assassin' ? '/img/assassin.svg' : `/img/spy-${r.winner}.svg`;
    const last = state.round >= state.settings.rounds;
    $('#btn-next').hidden = !host;
    $('#btn-next').textContent = last ? 'Ver resultado final' : 'Siguiente ronda';
    $('#btn-reset').hidden = !host;
    $('#btn-reset').textContent = 'Reiniciar partida';
  }

  const pts = $('#modal-points'); pts.innerHTML = '';
  for (const t of ['red', 'blue']) {
    const box = el('div', `pt ${t}`);
    box.append(el('div', 't', `Equipo ${TEAM_ES[t]}`), el('div', 'v', String(state.scores[t])));
    box.append(el('div', 'd', r && state.phase === 'roundEnd' ? `+${r.points[t]} esta ronda` : 'puntos totales'));
    pts.append(box);
  }

  // Entre ronda y ronda se puede cambiar quién dará las pistas.
  const pick = $('#modal-pick'); pick.innerHTML = '';
  if (state.phase === 'roundEnd' && state.round < state.settings.rounds) {
    pick.append(spymasterPicker('red', { conEquipo: true }), spymasterPicker('blue', { conEquipo: true }));
  }

  const tbl = $('#modal-history'); tbl.innerHTML = '';
  if (state.history.length) {
    tbl.innerHTML = '<tr><th>Ronda</th><th>Operadores</th><th>Ganador</th><th>Puntos</th></tr>';
    for (const h of state.history) {
      const tr = el('tr');
      tr.append(el('td', '', `#${h.round}`), el('td', '', `${h.spymasters.red} / ${h.spymasters.blue}`));
      tr.append(el('td', `win-${h.winner}`, TEAM_ES[h.winner]), el('td', '', `${h.points.red} — ${h.points.blue}`));
      tbl.append(tr);
    }
  }
  $('#modal-note').textContent = host ? '' : 'Esperando al anfitrión…';
  $('#btn-peek').hidden = false;
}

/* ── reloj ── */
function tickTimer() {
  const t = $('#timer'), dl = state?.game?.deadline;
  if (!dl || state.phase !== 'playing') { t.hidden = true; return; }
  const left = Math.max(0, Math.round((dl - Date.now()) / 1000));
  t.hidden = false;
  t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  t.classList.toggle('urgent', left <= 15);
}
setInterval(() => { if (state && state.phase === 'playing') tickTimer(); }, 300);

/* ── avisos y sonido ── */
function toast(msg, bad = false) {
  const n = el('div', 'toast' + (bad ? ' bad' : ''), msg);
  $('#toasts').append(n);
  setTimeout(() => n.remove(), 3200);
}
let ac;
function beep(freq, dur = 0.12, type = 'sine', gain = 0.05) {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = gain;
    o.connect(g).connect(ac.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.stop(ac.currentTime + dur + 0.02);
  } catch {}
}
function sfx(m) {
  if (m.event === 'clue') beep(660, .09, 'triangle');
  else if (m.event === 'round-start') { beep(440, .12); setTimeout(() => beep(660, .16), 130); }
  else if (m.event === 'reveal') {
    if (m.hit === 'own') { beep(720, .1); setTimeout(() => beep(960, .12), 90); }
    else if (m.hit === 'assassin') { beep(120, .5, 'sawtooth', .09); }
    else beep(240, .18, 'square', .04);
  }
}

connect();
