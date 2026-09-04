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
5. Su equipo tiene ese número de intentos **+1**, y son del **equipo entero, no de cada
   persona**: como en el juego de mesa, se discute en voz alta y cualquiera de los espías
   de campo puede destapar cualquier carta, en el orden que sea. El primero que confirma,
   manda. Cada carta se destapa con dos clics (el segundo confirma, para evitar resbalones).
   El operador no puede destapar ni cortar el turno de los suyos: sabe la clave.
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

## Ampliar el vocabulario

El tablero usa 828 palabras revisadas a mano (`server/words.js`). Para referencia,
el Codenames original trae **400** (200 cartas a doble cara), así que ya va sobrado.

Si algún día quieres más, `scripts/build-words.mjs` propone candidatas cruzando dos
fuentes públicas y gratuitas:

```bash
node scripts/build-words.mjs > scripts/candidatas.txt
```

- **Wiktionary en español**, categoría `ES:Sustantivos` (~73.000 palabras): dice qué
  palabras *son sustantivos*. Se descarga paginada y queda en caché en `.cache/`
  (el ritmo va limitado a propósito: la API responde 429 si aprietas).
- **Frecuencias de OpenSubtitles** (`hermitdave/FrequencyWords`, 50.000 palabras):
  dice cuáles se usan de verdad.

El cruce importa. Una lista de frecuencias sola te mete artículos y verbos
conjugados ("quizá", "deja", "escucha"); un diccionario general solo te mete
palabras rarísimas. Y aun cruzándolas, el script descarta sufijos abstractos
(-ción, -dad, -ismo…) porque una carta como ABSTRACCIÓN no da juego.

Lo que sale son **candidatas, no un diccionario final**: la última criba conviene
hacerla a ojo. Más palabras no es mejor si la mitad no sirve para dar pistas.

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

## Seguridad del juego

Lo único que hay que proteger aquí es la clave del tablero, y se protege en el
servidor: `stateFor()` arma un estado distinto por jugador y el color viaja como
`null` para quien no es operador. No es que la interfaz lo tape — el dato no sale
del servidor, así que mirar el tráfico o la consola no revela nada.

Cada jugador tiene **dos identificadores**: un `token` secreto (lo emite el servidor,
sirve para volver a tu sitio tras recargar y nunca se difunde) y un `id` público que
viaja en el estado para pintar equipos y roles. Antes había uno solo y se difundía:
cualquiera podía reconectarse con el identificador del operador y quedarse con su
vista del tablero. `npm test` incluye la regresión de ese caso.

Lo que **no** hay, y conviene saberlo: no hay cuentas ni contraseñas. Quien tenga el
código de sala entra, y las salas abiertas se listan en la portada. Para jugar entre
amigos está bien; no metas nada sensible en los nombres.

## Detalles útiles

- **Reconexión**: si recargas o se cae el wifi, vuelves a tu sitio con tu mismo rol (el `playerId`
  queda en `localStorage`). Abrir la sala en otra pestaña pausa la anterior en vez de pelearse con ella.
- **Turno atascado**: si el operador desaparece, el anfitrión (★) tiene *Saltar turno*.
- **Temporizador opcional** por turno (60 s a 3 min); al agotarse, cambia el turno.
- Las palabras no se repiten entre rondas de una misma partida.

## Prueba de extremo a extremo (Playwright)

Cuatro navegadores de verdad jugando una partida contra el servidor desplegado:

```bash
npx playwright install chromium   # solo la primera vez
npm run e2e                       # contra codenames.cnexans.com
E2E_URL=http://localhost:3000 npm run e2e
```

No comprueba "que la página carga", sino lo que solo se ve jugando entre varios:

- el operador ve las 25 cartas pintadas y **los demás ninguna**;
- la pista aparece en las cuatro pantallas;
- una carta destapada por un espía se ve destapada en las cuatro;
- destapar al asesino cierra la ronda y **entonces sí** todos ven el mapa completo;
- al pasar de ronda, el operador rota y las 25 palabras son nuevas.

Cada ejecución crea una sala real en producción; se limpia sola al quedarse vacía.

## Pruebas de carga

```bash
node test/load/room20.mjs   wss://codenames.cnexans.com/ws 20 2      # una sala llena jugando
node test/load/capacity.mjs wss://codenames.cnexans.com/ws 16 9 20 108   # rampa de salas
```

La salud del servidor se mide con una sonda aparte que manda *pings del propio
protocolo WebSocket*: los contesta el bucle de eventos de Node, así que el retraso
delata la saturación antes de que nadie note nada en la partida.

Medido contra la instancia t2.micro en producción (agosto 2026, cliente doméstico
en Buenos Aires, ~160 ms de ida y vuelta hasta us-east-1):

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

### Cuánto cuesta

Ojo con la expresión "capa gratuita": los 750 h/mes de EC2 son la **capa gratuita de
12 meses**, que se cuenta desde que se crea la cuenta de AWS. En una cuenta con más
de un año, la instancia se paga a precio normal. Precios verificados en us-east-1
(agosto 2026, consultados a la API de precios de AWS):

| Recurso | Precio | Al mes |
| --- | --- | --- |
| EC2 t2.micro | $0.0116/h | **$8.47** |
| IPv4 pública (la IP elástica) | $0.005/h | **$3.65** |
| EBS gp3 8 GB | $0.08/GB-mes | **$0.64** |
| Bucket S3 (tarball de ~60 KB) | — | ~$0.00 |
| Tráfico de salida | 100 GB/mes gratis, luego $0.09/GB | **$0.00** |
| | | **≈ $12.76/mes** |

Sale más barato con Graviton (ARM): `pulumi config set instanceType t4g.micro` baja
la instancia a $0.0084/h → **≈ $10.42/mes**. La infraestructura ya elige la AMI arm64
sola, pero hay que cambiar la descarga de Caddy en `user-data.sh` de `linux_amd64`
a `linux_arm64`.

Con la capa gratuita de 12 meses vigente (cuenta nueva), todo lo de arriba sale $0
salvo detalles menores.

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

Mientras el DNS propaga, el juego puede responder en `http://<IP>:3000` si activas
`openTestPort`. Está **desactivado a propósito**: ese puerto se salta a Caddy, o sea
que expone el juego sin cifrar. Úsalo solo para depurar y vuelve a cerrarlo:

```bash
pulumi config set openTestPort true && pulumi up    # abrir temporalmente
pulumi config set openTestPort false && pulumi up   # cerrar
```

Caddy redirige `http://` a `https://` con un 308 automáticamente; no hace falta configurarlo.

### Encender y apagar

```bash
cd infra
./servidor.sh estado     # dónde está y con qué IP
./servidor.sh off        # apagar: detiene el reloj de cómputo
./servidor.sh on --wait  # encender y esperar a que el juego conteste
```

Apagado sigues pagando disco e IPv4 (~$4.3/mes) pero no las horas de EC2, así que
el ahorro es de unos **$8.5/mes** si solo lo enciendes para jugar. La IP elástica no
se suelta al apagar, o sea que el DNS de Cloudflare sigue apuntando bien al volver.
Arrancar tarda ~75 s (systemd levanta la app y Caddy recupera el certificado del disco).

Para automatizarlo desde **GitHub Actions**, el script usa la cadena de credenciales
normal del AWS CLI, así que basta con configurar el rol y llamarlo:

```yaml
jobs:
  apagar:
    runs-on: ubuntu-latest
    permissions: { id-token: write, contents: read }   # OIDC, sin llaves guardadas
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::<CUENTA>:role/codenames-power
          aws-region: us-east-1
      - run: ./infra/servidor.sh off
```

El rol solo necesita esto (la condición por etiqueta evita tener que actualizar el
ARN cada vez que `pulumi up` reemplaza la instancia):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "ec2:DescribeInstances", "Resource": "*" },
    { "Effect": "Allow",
      "Action": ["ec2:StartInstances", "ec2:StopInstances"],
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:ResourceTag/App": "nombres-clave" } } }
  ]
}
```

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
