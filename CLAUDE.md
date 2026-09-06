# Larpfit — Directrices Globales del Proyecto

> **Lee este archivo antes de escribir cualquier línea de código.** Es la fuente de verdad
> sobre la visión, el stack, la arquitectura y los estándares de Larpfit. Si una petición
> entra en conflicto con lo definido aquí, señálalo antes de implementar.

---

## 1. Visión General del Proyecto

**Nombre:** Larpfit

**Descripción:**
Aplicación web estilo **ruleta 1v1**. Los usuarios se autentican, seleccionan su país y son
emparejados aleatoriamente con personas de su misma región. Cada pareja dispone de
**15 segundos de videollamada** para "flexear" su físico. Un **juez basado en IA** analiza la
pose de ambos competidores y determina al ganador.

**Bucle de juego (game loop):**

1. **Auth** → el usuario inicia sesión (email + contraseña + nombre de usuario).
2. **Selección de país** → define la región de emparejamiento.
3. **Cola (queue)** → el usuario entra a la cola de su país.
4. **Match** → el sistema empareja a dos usuarios de la misma región de forma instantánea.
5. **Handshake WebRTC** → intercambio de SDP/ICE vía señalización.
6. **Duelo (15 s)** → videollamada P2P con cuenta atrás visible.
7. **Juicio IA** → MediaPipe Pose evalúa la proporción del torso (V-taper).
8. **Resultado** → se muestra ganador/perdedor y se persiste el resultado.

**Tono y estética:** oscuro, gamer/fitness. Alto contraste, acentos neón, sensación de arena
de combate. Nada de blancos lavados ni interfaces "corporativas".

---

## 2. Stack Tecnológico Principal

| Capa | Tecnología |
| --- | --- |
| Framework | **Next.js** (App Router) |
| Lenguaje | **TypeScript estricto** (`strict: true`, sin `any`) |
| Estilos | **Tailwind CSS** (responsivo, tema oscuro, estilo gamer/fitness) |
| Backend / DB | **Supabase** (Postgres, Auth, Realtime) |
| Video | **WebRTC** peer-to-peer |
| IA | **MediaPipe Pose** (en el navegador) |
| Despliegue | **Vercel** |

### Reglas del stack

- **App Router siempre.** Nada de `pages/`. Server Components por defecto;
  `"use client"` solo donde se necesite estado, efectos, cámara o WebRTC.
- **TypeScript estricto.** Prohibido `any`. Si un tipo es desconocido, usa `unknown` y
  refina. Los tipos de la base de datos se generan desde Supabase y se importan, no se
  escriben a mano.
- **Tailwind, no CSS suelto.** Sin archivos `.css` por componente salvo el `globals.css`
  base. Sin estilos inline salvo valores calculados en runtime (ej. posiciones del overlay
  de pose).
- **Vercel-friendly.** Nada que dependa de un servidor con estado persistente en memoria:
  las funciones son efímeras. El estado vive en Supabase o en el cliente.

---

## 3. Backend, Base de Datos y Emparejamiento

**Plataforma:** Supabase.

### Autenticación

- **Supabase Auth** con registro por **email + contraseña**, más **nombre de usuario**.
- El `username` se guarda en una tabla `profiles` vinculada 1:1 a `auth.users` (`id` como
  FK a `auth.users.id`), con restricción `UNIQUE` sobre el nombre de usuario.
- El perfil se crea automáticamente al registrarse (trigger sobre `auth.users`), no desde
  el cliente.
- La sesión se maneja con el cliente SSR de Supabase (middleware para refrescar el token).
  Nunca leas el usuario desde el cliente para decisiones de seguridad: valídalo en servidor.

### Emparejamiento (Matchmaking)

- Cola persistida en **Supabase Database** (ej. `matchmaking_queue`: `user_id`, `country`,
  `status`, `created_at`).
- **Supabase Realtime** notifica al cliente cuando aparece su match.
- El emparejamiento **se resuelve en el servidor** (función de Postgres / RPC con bloqueo,
  o Edge Function), nunca con dos clientes decidiendo por su cuenta. Debe ser atómico:
  dos usuarios no pueden reclamar el mismo oponente.
- El match se materializa en una tabla `matches` (`player_a`, `player_b`, `country`,
  `status`, `winner_id`, timestamps).
- Solo se emparejan usuarios con el **mismo país**.
- Contempla siempre: cancelación de cola, desconexión antes del match, y timeout si no
  aparece rival.

---

## 4. Infraestructura de Video y Señalización

**Tecnología:** **WebRTC** peer-to-peer — la latencia debe ser casi nula y no queremos
saturar servidores retransmitiendo video. **El video nunca pasa por nuestro backend.**

**Señalización (Signaling):** **Supabase Realtime** (canales / Presence) para intercambiar
entre los dos clientes emparejados:

- la **oferta SDP** (offer) del iniciador,
- la **respuesta SDP** (answer) del receptor,
- los **candidatos ICE** de ambos.

### Reglas de WebRTC

- Un **canal Realtime por match** (ej. `match:{matchId}`), al que solo se suscriben los dos
  participantes.
- Rol determinista: el iniciador (quien crea la offer) se decide por una regla fija del
  match (ej. `player_a`), no por quien llegue primero.
- Configura **STUN** siempre; deja el hueco listo para **TURN** — sin TURN, un porcentaje
  real de usuarios tras NAT simétrico no conectará.
- **Limpieza obligatoria:** al terminar el duelo o al desmontar el componente, cierra el
  `RTCPeerConnection`, detén todos los `MediaStreamTrack` (se apaga la luz de la cámara) y
  abandona el canal Realtime. Una cámara que se queda encendida es un bug crítico.
- Usa **Presence** para detectar que el oponente abandonó y terminar el duelo con gracia.

---

## 5. Motor de IA (El Juez)

**Librería:** **MediaPipe Pose**, ejecutándose **en el cliente / navegador**.

**Función:** capturar los puntos clave del torso (**hombros y cintura/caderas**) para evaluar
la **proporción (V-taper)**: relación entre la anchura de hombros y la anchura de cintura.

### Reglas del juez

- **Todo el análisis ocurre en el navegador.** No subimos video ni frames a ningún servidor:
  es más rápido, más barato y respeta la privacidad del usuario.
- Se muestrea la pose durante los 15 segundos; la puntuación del competidor es una
  **agregación** de esas muestras (no un único frame afortunado), descartando frames con
  baja confianza en los landmarks.
- Si la pose no es detectable (mala luz, usuario fuera de cuadro), el estado debe ser
  explícito en la UI — nunca inventes una puntuación.
- La puntuación de cada jugador se calcula localmente y se envía; **el resultado final del
  match se escribe en `matches` desde el servidor**, no directamente por el cliente. Asume
  que un cliente puede mentir.
- Mantén la lógica de puntuación aislada en funciones puras y testeables, separada del
  código de cámara y de render.

---

## 6. Reglas y Estándares de Código

### Componentes

- Componentes **pequeños, modulares y reutilizables**. Si un componente hace dos cosas,
  divídelo.
- Separa **lógica** (hooks: `useMatchmaking`, `usePeerConnection`, `usePoseJudge`) de
  **presentación** (componentes que solo reciben props y pintan).
- Nombres explícitos. Un archivo, una responsabilidad.

### Cámara y permisos

- **Trata los permisos de cámara con cuidado.** Estados a cubrir siempre con UI clara:
  - permiso no solicitado todavía,
  - solicitando,
  - **denegado** → mensaje explicando qué pasó y cómo reactivarlo en el navegador,
  - sin cámara disponible / en uso por otra app,
  - error inesperado.
- Nunca dejes al usuario ante una pantalla negra sin explicación.
- Pide la cámara **antes** de entrar a la cola, no en mitad del duelo.

### Seguridad (Supabase)

- **Row Level Security (RLS) activado en todas las tablas**, sin excepciones. Una tabla sin
  RLS es una fuga de datos.
- Políticas mínimas necesarias: un usuario solo lee/escribe lo suyo; un match solo es
  visible para sus dos participantes.
- El `winner_id` y los resultados **solo los escribe el servidor** (RPC `SECURITY DEFINER` o
  Edge Function con service role). Ningún cliente puede declararse ganador.
- La **service role key jamás** llega al cliente. Solo `NEXT_PUBLIC_SUPABASE_URL` y
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` son públicas.
- Valida toda entrada del cliente en el servidor. Asume entrada hostil.

### Estilo general

- Errores manejados de forma visible y accionable; nada de `catch {}` silencioso.
- Estados de carga y de vacío diseñados, no improvisados.
- Accesibilidad básica: foco visible, contraste suficiente incluso con la paleta oscura,
  la cuenta atrás no debe depender solo del color.

---

## 7. Estructura de Carpetas (referencia)

```
larpfit/
├── claude.md
├── app/                  # Next.js App Router
│   ├── (auth)/           # login / registro
│   ├── lobby/            # selección de país y cola
│   ├── match/[id]/       # arena del duelo (client)
│   └── api/              # route handlers (server)
├── components/           # UI reutilizable
│   ├── ui/               # primitivas (botón, modal, contador)
│   └── match/            # video, overlay de pose, resultado
├── hooks/                # useMatchmaking, usePeerConnection, usePoseJudge
├── lib/
│   ├── supabase/         # clientes browser / server / middleware
│   ├── webrtc/           # señalización y peer connection
│   └── judge/            # lógica pura de puntuación V-taper
├── types/                # tipos generados de la DB y del dominio
└── supabase/migrations/  # SQL: tablas, políticas RLS, funciones
```

---

## 8. Decisiones Cerradas (no reabrir sin pedirlo)

- Video **P2P con WebRTC**, no SFU ni servidor de retransmisión.
- Señalización sobre **Supabase Realtime**, no un servidor WebSocket propio.
- IA **en el cliente** con MediaPipe, no inferencia en backend.
- **App Router** de Next.js, no Pages Router.
- **RLS activo** en toda tabla.
