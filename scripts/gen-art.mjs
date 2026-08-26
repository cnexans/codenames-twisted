// Genera las ilustraciones del juego con la API de imágenes de OpenAI (gpt-image-1).
// Uso: OPENAI_API_KEY=... npm run art
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img');
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error('Falta OPENAI_API_KEY'); process.exit(1); }

const STYLE =
  'flat vector illustration, bold clean shapes, thick confident outlines, limited palette, ' +
  'mid-century spy-thriller poster style, subtle paper grain, no text, no letters, no watermark';

const SPECS = [
  { file: 'spy-red.png', bg: 'transparent', size: '1024x1024',
    prompt: `Portrait of a mysterious spy in a crimson red trench coat and red fedora, face hidden in shadow under the hat brim, holding a small red envelope, ${STYLE}, dominant crimson and burgundy palette with cream highlights, centered character, isolated on transparent background` },
  { file: 'spy-blue.png', bg: 'transparent', size: '1024x1024',
    prompt: `Portrait of a mysterious spy in a deep blue trench coat and blue fedora, face hidden in shadow under the hat brim, holding small binoculars, ${STYLE}, dominant cobalt and navy palette with cream highlights, centered character, isolated on transparent background` },
  { file: 'assassin.png', bg: 'transparent', size: '1024x1024',
    prompt: `Sinister black silhouette of an assassin in a long coat and wide brimmed hat, glowing pale eyes, wisps of smoke around the shoulders, ${STYLE}, near-black palette with charcoal and bone white accents, centered figure, isolated on transparent background` },
  { file: 'hero.png', bg: 'opaque', size: '1536x1024',
    prompt: `Wide atmospheric scene: two rival spy teams, one in red and one in blue, facing each other across a table covered with 25 blank word cards in a dim smoky room, single hanging lamp, venetian blind shadows on the wall, ${STYLE}, teal-black background with red and blue rim light, cinematic, no text anywhere` },
];

async function gen({ file, prompt, size, bg }) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size, quality: 'medium', background: bg, output_format: 'png', n: 1 }),
  });
  if (!res.ok) throw new Error(`${file}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, file), Buffer.from(json.data[0].b64_json, 'base64'));
  console.log('✔', file);
}

const only = process.argv.slice(2);
const todo = only.length ? SPECS.filter((s) => only.includes(s.file)) : SPECS;
const results = await Promise.allSettled(todo.map(gen));
for (const r of results) if (r.status === 'rejected') console.error('✖', r.reason.message);
