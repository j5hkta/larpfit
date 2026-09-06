/**
 * Contrato de la API REST de Metered. Lógica pura: construir URLs y validar
 * respuestas. Las peticiones HTTP las hace el Route Handler.
 *
 * Flujo de credenciales efímeras (dos endpoints distintos, no confundirlos):
 *
 *   1. POST /api/v1/turn/credential?secretKey=<SECRET>
 *      body: { expiryInSeconds, label }
 *      → { username, password, expiryInSeconds, label, apiKey }
 *
 *   2. GET /api/v1/turn/credentials?apiKey=<apiKey de la credencial>
 *      → [ { urls, username, credential }, … ]
 *
 * El `secretKey` NUNCA sale del servidor. El paso 2 solo hace falta si no
 * tenemos configuradas las URLs del relay por nuestra cuenta.
 *
 * @see https://www.metered.ca/docs/turnserver-guides/expiring-turn-credentials/
 */

/** Respuesta del paso 1. */
export type MeteredCredential = {
  username: string;
  password: string;
  /** Clave de esa credencial concreta. Sirve para el paso 2. */
  apiKey: string | null;
  expiryInSeconds: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/** Valida y normaliza el `origin` de la app de Metered. */
export function meteredBaseUrl(raw: string | undefined): URL {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new Error("Falta TURN_API_URL (https://<tu-app>.metered.live).");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`TURN_API_URL no es una URL válida: ${trimmed}`);
  }

  if (url.protocol !== "https:") {
    throw new Error("TURN_API_URL debe usar https.");
  }

  return url;
}

/** POST: crea una credencial con caducidad. */
export function credentialEndpoint(baseUrl: URL, secretKey: string): URL {
  const url = new URL("/api/v1/turn/credential", baseUrl.origin);
  url.searchParams.set("secretKey", secretKey);
  return url;
}

/** GET: lista de servidores ICE ya formateada por Metered. */
export function iceServersEndpoint(baseUrl: URL, apiKey: string): URL {
  const url = new URL("/api/v1/turn/credentials", baseUrl.origin);
  url.searchParams.set("apiKey", apiKey);
  return url;
}

/**
 * Valida la respuesta del paso 1.
 *
 * Metered llama `password` a lo que WebRTC llama `credential`; el renombrado
 * ocurre aquí y no se propaga al resto del código.
 */
export function parseMeteredCredential(payload: unknown): MeteredCredential {
  if (!isRecord(payload)) {
    throw new Error("Metered devolvió algo que no es un objeto.");
  }

  const username = nonEmptyString(payload.username);
  const password = nonEmptyString(payload.password);

  if (!username || !password) {
    throw new Error("Metered no devolvió username y password utilizables.");
  }

  return {
    username,
    password,
    apiKey: nonEmptyString(payload.apiKey),
    expiryInSeconds:
      typeof payload.expiryInSeconds === "number" &&
      Number.isFinite(payload.expiryInSeconds)
        ? payload.expiryInSeconds
        : null,
  };
}

/**
 * Valida la respuesta del paso 2: un array plano de RTCIceServer.
 * Descarta las entradas sin `urls` en vez de tumbar la conexión entera.
 */
export function parseMeteredIceServers(payload: unknown): RTCIceServer[] {
  if (!Array.isArray(payload)) {
    throw new Error("Metered no devolvió un array de servidores ICE.");
  }

  const servers: RTCIceServer[] = [];

  for (const entry of payload) {
    if (!isRecord(entry)) continue;

    const urls = nonEmptyString(entry.urls);
    if (!urls) continue;

    const username = nonEmptyString(entry.username);
    const credential = nonEmptyString(entry.credential);

    servers.push(
      username && credential ? { urls, username, credential } : { urls },
    );
  }

  if (servers.length === 0) {
    throw new Error("Metered devolvió una lista de servidores ICE vacía.");
  }

  return servers;
}
