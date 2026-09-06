import { createHmac } from "node:crypto";

/**
 * Credenciales TURN efímeras (esquema REST de coturn, `use-auth-secret`).
 *
 * SOLO SERVIDOR: importa node:crypto y usa el secreto compartido. Nunca lo
 * importes desde un componente de cliente.
 *
 * Cómo funciona: el servidor TURN y nosotros compartimos un secreto. En vez de
 * dar de alta usuarios, se firma un nombre de usuario con caducidad incrustada.
 * El TURN recalcula el HMAC y acepta la conexión hasta que expire. Así la
 * credencial que llega al navegador solo sirve unos minutos, y si alguien la
 * extrae del tráfico no puede reutilizarla mañana.
 *
 * @see https://datatracker.ietf.org/doc/html/draft-uberti-behave-turn-rest-00
 */

/** Diez minutos: cubre de sobra un duelo de 15 s más reconexiones. */
export const DEFAULT_TTL_SECONDS = 600;

export type EphemeralCredentials = {
  /** `<caducidad unix>:<identidad>` */
  username: string;
  /** HMAC-SHA1 del username en base64. */
  credential: string;
  /** Segundos unix en los que la credencial deja de valer. */
  expiresAt: number;
};

type CreateArgs = {
  secret: string;
  /** Identidad que queda registrada en el TURN. Útil para rastrear abusos. */
  identity: string;
  ttlSeconds?: number;
  /** Inyectable para poder probarlo de forma determinista. */
  now?: number;
};

export function createTurnCredentials({
  secret,
  identity,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  now = Date.now(),
}: CreateArgs): EphemeralCredentials {
  if (!secret) throw new Error("Falta el secreto compartido del TURN.");
  if (!identity) throw new Error("Falta la identidad para la credencial TURN.");
  if (ttlSeconds <= 0) throw new Error("El TTL debe ser positivo.");

  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiresAt}:${identity}`;

  // HMAC-SHA1 es lo que exige el esquema REST de coturn. No es un hash de
  // contraseña: es un MAC con secreto compartido, y ahí SHA-1 sigue siendo
  // adecuado para este uso.
  const credential = createHmac("sha1", secret)
    .update(username)
    .digest("base64");

  return { username, credential, expiresAt };
}
