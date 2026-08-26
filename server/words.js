// Diccionario de palabras en español para el tablero.
// Sustantivos concretos, de una sola palabra, fáciles de asociar.
const RAW = `
abeja abogado abrigo abuela aceite acero agua aguja ajedrez ala alambre alarma alas albañil alcohol aldea alfombra algodón alma almohada altar amazonas ancla ángel anillo antena araña árbitro árbol arco arena armario arroz arte asado ascensor astro atlas ático autobús avión ayuntamiento azúcar
bahía baile balcón ballena balón bambú banco bandera bandido baño barba barco barra bastón basura batería bebé beso biblioteca bicicleta bigote billete bisonte bloque boca boda bola bolsa bomba bosque bota botella botón boxeo brazo bruja brújula buceo búho buque burbuja burro buzón
caballo cabaña cable cabra cadena café caja calavera calcetín calle cama cámara camello camino camión campana campo canal canario canción candado cangrejo canoa cañón capa capital cápsula cara caracol carbón cárcel carne carpa carta cartera casa cascada casco castillo catedral cebolla cebra cementerio cena centro cepillo cerdo cereza cerradura cerveza césped chaleco champiñón chaqueta cheque chicle chimenea chocolate chuleta cicatriz cielo ciervo cifra cigarro cine cinta circo ciudad clavo clima club cobre coche cocina cocodrilo codo cohete cojín cola colchón colegio collar colmena color columna comedia cometa compás concha conejo cono copa corazón corbata cordero corona correo cortina cráneo cristal cruz cuaderno cuadro cuchara cuchillo cuello cuerda cuerno cuervo cueva culebra cumbre cuna cura
dado dama dardo dedo delfín demonio desierto detective día diamante diente dinero dios disco disfraz dragón ducha duende dulce duque
eco edificio elefante elenco embajada emperador enano energía enfermera ensalada equipo escalera escoba escritorio escuela esfera espada espalda espejo esposa espuma esqueleto esquina estación estatua estrella estudio estufa examen éxito
fábrica falda familia fantasma faro fecha felpudo feria fiebre fiesta figura filtro fin flauta flecha flor foca foco fondo forma foto fresa frontera fruta fuego fuente fuerza fútbol fusil
gafas galleta gallina gancho ganso garaje garganta garra gas gato gaviota gemelo general gigante gimnasio gitano globo gol golf goma gorila gorra gota granada granero granja grifo gripe grito gruta guante guerra guía guitarra gusano
habitación hacha hada hambre harina hebilla helado helicóptero herida hermano héroe herradura hielo hierba hierro hija hilo hipopótamo historia hocico hogar hoja hombro honda hongo hora hormiga horno hospital hotel hoyo hueso huevo humo huracán
idea iglesia iglú imán imperio impresora incendio indio infierno insecto invierno isla
jabón jamón jardín jarra jaula jefe jinete jirafa joya juez juego jugo juguete jungla
kilo kiosco koala
labio laboratorio ladrillo ladrón lago lágrima lámpara lana lancha langosta lanza lápiz laurel lava leche lechuga lengua león leopardo letra ley leyenda libertad libro licor liebre lienzo liga lima limón línea linterna lío lirio lista lobo locomotora loro losa lote lucha luna lupa luz
madera madre maestro mago maíz maleta malla mano manta manzana mapa máquina mar marco marea marfil mariposa mármol martillo máscara mástil mate mecánico medalla medusa mejilla melón mensaje mercado mesa metal metro miel militar mina minuto misa misión mochila moda molino momia moneda monje mono monstruo montaña morsa mosca mosquito mostaza motor muelle muerte mujer mula multa mundo muñeca muralla murciélago museo música muslo
nabo nación nadador naipe naranja nariz nata nave navidad neblina negocio nervio nido nieve niño noche nombre norte nota noticia nube nudo nuez número
oasis obra oca océano oficina ojo ola olla ombligo onda ópera oreja órgano orilla oro oruga oscuridad oso ostra otoño oveja ovni
paciente padre paella página pájaro palacio palma paloma pan pandilla pantalla pantalón pantano papel paquete paraguas parche pared parque partido pasaporte paseo pastel pata patín pato pecho pegamento peine película peligro pelo pelota peluca pena península perfume periódico perla perro pesca peso pestaña petróleo pez piano pico pie piedra piel pierna pijama pila piloto pimienta pincel pingüino pino pintura pipa pirámide pirata piscina piso pista pistola pizarra planeta planta plata plátano plato playa pluma pobre poeta policía pollo polvo pomada portal postre pozo precio premio prensa presa primavera príncipe prisión profesor puente puerta pueblo puerto pulga pulmón pulpo pulsera puñal pupila
queso química quinta quiosco
rabo radar radio raíz rama rana rancho rascacielos rastro rata ratón rayo receta red regalo regla reina reja reloj remo renta reptil resorte revista rey rezo riel rifle rincón río riqueza risa rizo robot roca rodilla romance ropa rosa rueda ruido ruina rumbo
sable sabor sacerdote saco sal sala salida salsa salto sandía sangre santo sapo sardina sartén sastre satélite sauce secreto seda seguro selva semáforo semilla senda seño serpiente sierra siesta silla símbolo sirena sistema sofá sol soldado sombra sombrero sonido sopa soplo sótano suelo sueño suerte sur
tabaco tabla taco taller tambor tanque tapa tarjeta taxi taza teatro techo tecla tejado tela teléfono telescopio televisión tema templo tenedor tenis terraza tesoro tiburón tiempo tienda tierra tigre tijera timbre tinta tío tiza toalla tobillo tocino tomate tono tormenta torneo toro torre tortuga tos trampa tren trigo trineo trofeo trompeta tronco trono tropa trueno tubo tumba túnel turista
uña unicornio uniforme universo uva
vaca vacío valle vampiro vapor vaquero varilla vaso vela veneno ventana verano verdad verja vestido viaje víbora vidrio viento viernes vino violín virus visita viuda volcán volumen voto voz vuelo
yate yema yeso yogur
zanahoria zapato zorro zumo
`;

export const WORDS = [...new Set(RAW.split(/\s+/).map((w) => w.trim()).filter(Boolean))];

export function pickWords(n, exclude = new Set()) {
  const pool = WORDS.filter((w) => !exclude.has(w));
  const src = pool.length >= n ? pool : WORDS.slice();
  // Fisher-Yates parcial
  const arr = src.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}
