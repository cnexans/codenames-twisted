import { test, expect } from '@playwright/test';

/**
 * Partida completa con cuatro navegadores de verdad contra el servidor desplegado.
 *
 * Lo que se comprueba no es que "la página carga", sino las reglas que solo se ven
 * jugando entre varios: que el operador vea los colores y los demás no, que una
 * jugada llegue a todas las pantallas, y que el operador rote al cambiar de ronda.
 */

const NOMBRES = ['Ana', 'Beto', 'Cris', 'Dani'];

/** Una carta concreta del tablero, buscando por su palabra exacta. */
const carta = (page, palabra) =>
  page.locator('#board .card').filter({ has: page.locator(`.word:text-is("${palabra}")`) }).first();

/** ¿Esta pantalla es la del operador? Su propia ficha lleva la etiqueta destacada. */
const soyOperador = (page) => page.locator('.roster li.me .tag.boss').count().then((n) => n > 0);

async function abrir(browser, nombre) {
  const context = await browser.newContext();      // localStorage propio = jugador distinto
  const page = await context.newPage();
  await page.goto('/');
  // El panel de salas aparece con el primer mensaje del servidor: prueba de que
  // el WebSocket ya está abierto y podemos pulsar botones sin perder el clic.
  await expect(page.locator('#rooms-panel')).toBeVisible();
  await page.fill('#in-name', nombre);
  return { context, page, nombre };
}

test('cuatro jugadores juegan una ronda entera', async ({ browser }) => {
  const jugadores = [];
  for (const nombre of NOMBRES) jugadores.push(await abrir(browser, nombre));
  const [ana, beto, cris, dani] = jugadores;

  await test.step('crear sala y entrar los cuatro', async () => {
    await ana.page.click('#btn-create');
    await expect(ana.page.locator('#screen-lobby')).toBeVisible();
    const codigo = (await ana.page.locator('#lobby-code').textContent()).trim();
    expect(codigo).toHaveLength(4);

    for (const j of [beto, cris, dani]) {
      await j.page.fill('#in-code', codigo);
      await j.page.click('.join-row button');
      await expect(j.page.locator('#screen-lobby')).toBeVisible();
    }
    for (const j of jugadores) {
      await expect(j.page.locator('.roster li')).toHaveCount(4);
    }
  });

  await test.step('repartir equipos', async () => {
    for (const j of [ana, beto]) await j.page.click('[data-team="red"]');
    for (const j of [cris, dani]) await j.page.click('[data-team="blue"]');
    for (const j of jugadores) {
      await expect(j.page.locator('#lobby-red li')).toHaveCount(2);
      await expect(j.page.locator('#lobby-blue li')).toHaveCount(2);
    }
  });

  let operadorRojo, espiaRojo, palabrasRonda1;

  await test.step('empezar: solo los operadores ven los colores', async () => {
    await ana.page.selectOption('#set-rounds', '3');
    await ana.page.click('#btn-start');
    for (const j of jugadores) await expect(j.page.locator('#board .card')).toHaveCount(25);

    const rojos = [ana, beto];
    operadorRojo = (await soyOperador(rojos[0].page)) ? rojos[0] : rojos[1];
    espiaRojo = operadorRojo === rojos[0] ? rojos[1] : rojos[0];

    // El operador ve las 25 pintadas; el resto, ninguna.
    await expect(operadorRojo.page.locator('#board .card[class*="peek-"]')).toHaveCount(25);
    for (const j of jugadores) {
      if (await soyOperador(j.page)) continue;
      await expect(j.page.locator('#board .card[class*="peek-"]')).toHaveCount(0);
    }
    palabrasRonda1 = await ana.page.locator('#board .word').allTextContents();
  });

  await test.step('la pista llega a todas las pantallas', async () => {
    await operadorRojo.page.fill('.clue-form input', 'SEÑUELO');
    await operadorRojo.page.selectOption('.clue-form select', '2');
    await operadorRojo.page.click('.clue-form button');
    for (const j of jugadores) {
      await expect(j.page.locator('.clue-pill')).toContainText('SEÑUELO');
    }
  });

  await test.step('una jugada se ve en todas las pantallas', async () => {
    // Elegimos una carta roja mirando el tablero del operador; el espía la destapa
    // sin tener esa información, que es justo la gracia del juego.
    const palabra = await operadorRojo.page.locator('#board .card.peek-red').first().locator('.word').textContent();
    const objetivo = carta(espiaRojo.page, palabra);
    await objetivo.click();                                   // primer clic: marcar
    await expect(objetivo).toHaveClass(/armed/);
    await objetivo.click();                                   // segundo clic: confirmar
    for (const j of jugadores) {
      await expect(carta(j.page, palabra)).toHaveClass(/done red/);
    }
    await expect(espiaRojo.page.locator('#left-red')).toHaveText('8');
  });

  await test.step('el asesino termina la ronda y se destapan todos los colores', async () => {
    const asesino = await operadorRojo.page.locator('#board .card.peek-assassin').locator('.word').textContent();
    const objetivo = carta(espiaRojo.page, asesino);
    await objetivo.click();
    await objetivo.click();

    for (const j of jugadores) {
      await expect(j.page.locator('#modal-title')).toContainText('gana AZUL');
      await expect(j.page.locator('#overlay')).toBeVisible();
      // Terminada la ronda, ya nadie tiene ventaja: todos ven el mapa completo.
      // Las destapadas quedan con 'done'; el resto se pintan como las ve el operador.
      await expect(j.page.locator('#board .card.done, #board .card[class*="peek-"]')).toHaveCount(25);
    }
  });

  await test.step('la ronda 2 rota el operador y estrena palabras', async () => {
    await ana.page.click('#btn-next');
    for (const j of jugadores) await expect(j.page.locator('#round-now')).toHaveText('2');

    expect(await soyOperador(espiaRojo.page)).toBe(true);
    expect(await soyOperador(operadorRojo.page)).toBe(false);

    const palabrasRonda2 = await ana.page.locator('#board .word').allTextContents();
    const repetidas = palabrasRonda2.filter((w) => palabrasRonda1.includes(w));
    expect(repetidas).toEqual([]);
  });

  for (const j of jugadores) await j.context.close();
});
