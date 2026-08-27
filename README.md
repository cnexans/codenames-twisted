# 🕵️ Nombres Clave

**En vivo: https://codenames.cnexans.com**

Juego de palabras por equipos (rojo vs. azul) al estilo *Codenames*, en español y en tiempo real.
Cada ronda cambian las 25 palabras **y** el operador de cada equipo, y los puntos se acumulan
hasta el final de la partida.

## Cómo se juega

1. Alguien crea una sala y comparte el código de 4 letras (o el enlace). La portada
   también lista **las salas abiertas en vivo**: se puede entrar de un clic, o mirar
   una partida en curso como espectador (sin ver los colores, claro).
2. Cada quien elige equipo **rojo** o **azul** (mínimo 2 por equipo). También hay espectadores.
   Mientras se arman los equipos cualquiera puede cambiarse el nombre desde el panel
   *Tu agente* (útil si entraste sin ponerlo); en plena ronda queda bloqueado.
3. En cada ronda, **un integrante distinto de cada equipo es el operador**: solo esa persona ve
   los colores del tablero. La rotación sigue el orden de llegada al equipo, así que en una
   partida de 5 rondas con 3 personas por equipo, todas terminan siendo operador.
4. El operador da una pista de **una sola palabra** + un número (o ∞): cuántas cartas se relacionan.
5. Su equipo tiene ese número de intentos **+1**. Cada carta se destapa con dos clics (el segundo confirma).
   - Carta de tu color → sigue el turno.
   - Transeúnte (beige) → termina el turno.
   - Carta del rival → se la regalas y termina el turno.
   - **Asesino** (negra) → pierdes la ronda al instante.
6. La ronda termina cuando un equipo descubre todos sus contactos o alguien destapa al asesino.

### Puntuación

| Concepto | Puntos |
| --- | --- |
| Cada carta propia descubierta en la ronda | +1 |
| Ganar la ronda | +3 |

Gana la partida quien acumule más puntos tras el número de rondas configurado (3, 5, 7 o 9).
Así una ronda perdida por poco sigue sumando, y el marcador se mantiene interesante hasta el final.

## Arrancar

```bash
npm install
npm start           # http://localhost:3000
npm test            # prueba las reglas contra un servidor en marcha
```

`npm test` levanta cuatro jugadores por WebSocket y juega dos rondas completas
(pistas inválidas, transeúnte, asesino, rotación de operador, puntaje). También
sirve contra el servidor desplegado: `node test/flow.mjs wss://codenames.cnexans.com/ws`.

Para jugar desde otros dispositivos en la misma red, entra a `http://TU_IP_LOCAL:3000`.

## Sobre el tiempo real: WebSockets, no WebRTC

Pediste WebRTC si era posible. Aquí **no lo es sin romper el juego**, por dos razones:

1. **El estado tiene que ser secreto.** El mapa de colores solo puede conocerlo el operador. Con WebRTC
   (peer-to-peer) el tablero completo viviría en los navegadores de los jugadores: cualquiera podría
   abrir la consola y ver dónde está el asesino. El servidor es *autoritativo* y a cada quien le manda
   solo lo que le toca ver (`stateFor()` en `server/game.js`).
2. **WebRTC igual necesita un servidor de señalización** (y normalmente STUN/TURN) para conectar a los
   pares, así que no ahorra infraestructura en un juego por turnos, donde la latencia de un WebSocket
   (unos milisegundos en LAN) es irrelevante.

Si algún día se agrega voz o video entre compañeros de equipo, *ese* canal sí conviene por WebRTC,
usando este mismo WebSocket como señalización.

## Ilustraciones

Los espías y el asesino son SVG hechos a mano (`public/img/`), así que el juego funciona sin conexión
ni API keys.

Hay además un script para regenerarlos con la API de imágenes de OpenAI:

```bash
OPENAI_API_KEY=... npm run art
```

Escribe `spy-red.png`, `spy-blue.png`, `assassin.png` y `hero.png` en `public/img/`; el cliente prefiere
el `.png` y cae al `.svg` si no existe. *Nota:* al escribir esto la cuenta asociada a `OPENAI_API_KEY`
devolvió `insufficient_quota` (sin créditos), por eso los SVG son los que se ven en el juego.

## Estructura

```
server/
  index.js   servidor Express + WebSocket, salas, reloj de turnos
  game.js    reglas: tablero, roles rotativos, turnos, puntaje, estado por jugador
  words.js   diccionario español (828 palabras, sin repetir dentro de la partida)
public/
  index.html · style.css · app.js · img/
scripts/gen-art.mjs   generación opcional de ilustraciones
```

## Detalles útiles

- **Reconexión**: si recargas o se cae el wifi, vuelves a tu sitio con tu mismo rol (el `playerId`
  queda en `localStorage`). Abrir la sala en otra pestaña pausa la anterior en vez de pelearse con ella.
- **Turno atascado**: si el operador desaparece, el anfitrión (★) tiene *Saltar turno*.
- **Temporizador opcional** por turno (60 s a 3 min); al agotarse, cambia el turno.
- Las palabras no se repiten entre rondas de una misma partida.

## Pruebas de carga

```bash
node test/load/room20.mjs   wss://codenames.cnexans.com/ws 20 2      # una sala llena jugando
node test/load/capacity.mjs wss://codenames.cnexans.com/ws 16 9 20 108   # rampa de salas
```

La salud del servidor se mide con una sonda aparte que manda *pings del propio
protocolo WebSocket*: los contesta el bucle de eventos de Node, así que el retraso
delata la saturación antes de que nadie note nada en la partida.

Medido contra la instancia t2.micro en producción (agosto 2026, cliente en Ciudad
de México, ~160 ms de ida y vuelta):

| Escenario | Resultado |
| --- | --- |
| 1 sala de 20 jugando | jugada visible para los 20 en **167 ms p50 / 176 ms p95** (red: 161 ms) |
| 108 salas de 16 a la vez | **1.728 jugadores**, 75 jugadas/s, 7,1 MB/s, ping del servidor **sin moverse de 161 ms**, cero errores |

La rampa se quedó sin tope antes que el servidor: el límite real está por encima
de eso. El coste dominante es el tráfico, no la CPU: **~100 KB por jugada** en una
sala de 16-20 personas, porque cada cambio reenvía el estado completo a cada jugador.

## Despliegue en AWS (capa gratuita) con Pulumi

`infra/` levanta una EC2 **t2.micro** con Amazon Linux 2023, la app como servicio de systemd
y **Caddy** delante haciendo de proxy inverso con certificado de Let's Encrypt automático
(los WebSockets pasan sin configuración extra).

Lo que se crea y por qué sigue siendo gratis:

| Recurso | Capa gratuita |
| --- | --- |
| EC2 t2.micro | 750 h/mes durante 12 meses |
| EBS gp3 8 GB | de los 30 GB gratis |
| IP elástica | gratis mientras esté asociada a una instancia encendida |
| Bucket S3 (tarball de ~60 KB) | dentro de los 5 GB gratis |
| Tráfico de salida | 100 GB/mes gratis |

### Pasos

```bash
cd infra
npm install
pulumi stack init prod
pulumi config set aws:region us-east-1
pulumi config set domain codenames.cnexans.com
pulumi config set acmeEmail tu@correo.com     # avisos de Let's Encrypt
pulumi up
```

Al terminar imprime la IP elástica. En **Cloudflare** crea el registro:

```
Tipo: A   Nombre: codenames   Contenido: <IP del output>   Proxy: DNS only (nube gris)
```

La nube gris es importante al principio: Caddy valida el dominio por HTTP-01 y necesita
llegar directo a la instancia. Una vez que `https://codenames.cnexans.com` cargue, puedes
encender el proxy naranja poniendo el modo SSL en **Full (strict)**.

Si prefieres automatizarlo:

```bash
CLOUDFLARE_API_TOKEN=... ./cloudflare-dns.sh codenames.cnexans.com $(pulumi stack output ip)
```

Comprobación de que todo quedó bien: `./smoke-test.sh` (DNS, certificado y handshake WebSocket).

Mientras el DNS propaga, el juego ya responde en `http://<IP>:3000` (output `pruebaDirecta`).
Ese puerto es solo para probar: ciérralo con `pulumi config set openTestPort false && pulumi up`.

### Actualizar el juego

`pulumi up` vuelve a empaquetar `server/`, `public/` y el `package.json`. Si el contenido cambió,
cambia el hash del artefacto y la instancia se reemplaza con la versión nueva (la IP elástica
se mantiene, así que el DNS no se toca).

### Entrar a la máquina

No hay SSH abierto; se entra por SSM (sin llaves ni puerto 22):

```bash
aws ssm start-session --target $(pulumi stack output --json | jq -r .consola | awk '{print $4}')
sudo tail -f /var/log/codenames-boot.log     # arranque
sudo journalctl -u codenames -f              # servidor del juego
sudo journalctl -u caddy -f                  # TLS / proxy
```

Si prefieres SSH: `pulumi config set sshCidr TU.IP.PU.BLICA/32` y añade tu llave al stack.
