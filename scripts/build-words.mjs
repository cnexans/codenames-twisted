/**
 * Propone palabras nuevas para el tablero a partir de fuentes públicas.
 *
 *   node scripts/build-words.mjs > scripts/candidatas.txt
 *
 * Cruza dos fuentes libres:
 *   · Wiktionary en español, categoría "ES:Sustantivos" → qué palabras SON sustantivos
 *   · frecuencias de OpenSubtitles (hermitdave/FrequencyWords) → cuáles se usan de verdad
 *
 * El cruce importa: un diccionario a secas mete verbos y palabras rarísimas, y una
 * lista de frecuencias sola mete artículos y conjugaciones. Para Codenames hacen
 * falta sustantivos CONCRETOS y reconocibles; lo que sale de aquí son candidatas,
 * no un diccionario final: la última criba es a ojo.
 */
import fs from 'node:fs/promises';

const FREQ = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/es/es_50k.txt';
const WIKI = 'https://es.wiktionary.org/w/api.php';
const UA = 'nombres-clave-wordlist/1.0 (juego de mesa; contacto vía repositorio)';

const RANGO = [200, 16000];  // ventana de frecuencia: ni funcionales ni cola rara
const LARGO = [4, 11];
// Sufijos que casi siempre indican algo abstracto: no funcionan como carta.
const ABSTRACTO = /(ción|sión|cion|dad|tad|tud|ismo|ista|encia|ancia|anza|eza|ura|miento|umbre|idad|logía|grafía)$/;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wiktionary limita el ritmo: vamos despacio y reintentamos con espera creciente. */
async function pedir(url, intento = 0) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (r.status === 429 || r.status >= 500) {
    if (intento > 6) throw new Error(`Wiktionary ${r.status} tras ${intento} reintentos`);
    const espera = Number(r.headers.get('retry-after')) * 1000 || 2000 * 2 ** intento;
    console.error(`  ${r.status}, esperando ${Math.round(espera / 1000)}s…`);
    await dormir(espera);
    return pedir(url, intento + 1);
  }
  if (!r.ok) throw new Error(`Wiktionary ${r.status}`);
  return r.json();
}

async function sustantivos() {
  const cache = new URL('../.cache/sustantivos-es.txt', import.meta.url);
  try {
    const guardado = (await fs.readFile(cache, 'utf8')).split('\n').filter(Boolean);
    console.error(`  usando caché: ${guardado.length} sustantivos`);
    return new Set(guardado);
  } catch {}

  const set = new Set();
  let cont = '';
  for (let i = 0; i < 250; i++) {
    const d = await pedir(`${WIKI}?action=query&list=categorymembers&cmtitle=Categor%C3%ADa:ES:Sustantivos`
      + `&cmlimit=500&cmnamespace=0&format=json${cont}`);
    for (const m of d.query.categorymembers) set.add(m.title.toLowerCase());
    if (!d.continue?.cmcontinue) break;
    cont = `&cmcontinue=${encodeURIComponent(d.continue.cmcontinue)}`;
    if (i % 20 === 0) console.error(`  …${set.size} sustantivos`);
    await dormir(600);
  }
  await fs.mkdir(new URL('../.cache/', import.meta.url), { recursive: true });
  await fs.writeFile(cache, [...set].join('\n'));
  return set;
}

const nombres = await sustantivos();
const frecuencia = (await fetch(FREQ).then((r) => r.text()))
  .split('\n').map((l) => l.split(' ')[0]?.trim().toLowerCase()).filter(Boolean);

const { WORDS } = await import('../server/words.js');
const yaTenemos = new Set(WORDS);

const candidatas = [];
for (let i = RANGO[0]; i < Math.min(frecuencia.length, RANGO[1]); i++) {
  const w = frecuencia[i];
  if (yaTenemos.has(w) || !nombres.has(w)) continue;
  if (w.length < LARGO[0] || w.length > LARGO[1]) continue;
  if (!/^[a-záéíóúüñ]+$/.test(w)) continue;
  if (ABSTRACTO.test(w)) continue;
  candidatas.push(w);
}

console.error(`sustantivos de Wiktionary: ${nombres.size} · frecuencias: ${frecuencia.length}`);
console.error(`ya teníamos: ${yaTenemos.size} · candidatas nuevas: ${candidatas.length}`);
console.log(candidatas.join('\n'));
