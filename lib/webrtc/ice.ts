/**
 * Construcción de la lista de servidores ICE. Lógica pura y testeable:
 * sin React, sin DOM, sin leer process.env aquí dentro.
 */

/**
 * STUN público de Google. Va SIEMPRE primero: si los dos peers pueden hablar
 * directamente, la conexión no consume ancho de banda de nuestro TURN.
 */
export const STUN_SERVERS: readonly RTCIceServer[] = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  },
];

export type TurnConfig = {
  /** Cadena separada por comas: "turn:host:3478,turns:host:5349". */
  urls?: string;
  username?: string;
  credential?: string;
};

export type IceSetup = {
  iceServers: RTCIceServer[];
  /** true solo si hay URLs, usuario Y credencial. */
  turnEnabled: boolean;
};

/** Parte la cadena de URLs, recorta espacios y descarta entradas vacías. */
export function parseTurnUrls(raw: string | undefined): string[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

export function isRelayUrl(url: string): boolean {
  return url.startsWith("turn:") || url.startsWith("turns:");
}

/**
 * STUN primero, TURN después y solo si la configuración está completa.
 *
 * Las URLs `stun:` que vengan en la configuración se separan en su propia
 * entrada sin credenciales: adjuntarle usuario y contraseña a un STUN no sirve
 * de nada y ensucia el diagnóstico.
 *
 * Un TURN sin usuario o sin credencial no solo es inútil: hace que el navegador
 * descarte el servidor tras un error de autenticación, así que es mejor no
 * añadirlo y decirlo por consola.
 */
export function buildIceServers(turn: TurnConfig): IceSetup {
  const configured = parseTurnUrls(turn.urls);
  const stunUrls = configured.filter((url) => url.startsWith("stun:"));
  const relayUrls = configured.filter(isRelayUrl);

  const username = turn.username?.trim();
  const credential = turn.credential?.trim();

  const turnEnabled =
    relayUrls.length > 0 && Boolean(username) && Boolean(credential);

  const iceServers: RTCIceServer[] = [...STUN_SERVERS];

  if (stunUrls.length > 0) {
    iceServers.push({ urls: stunUrls });
  }

  if (turnEnabled) {
    iceServers.push({ urls: relayUrls, username, credential });
  }

  return { iceServers, turnEnabled };
}
