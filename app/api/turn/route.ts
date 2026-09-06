import { NextResponse } from "next/server";

import { buildIceServers, parseTurnUrls, STUN_SERVERS } from "@/lib/webrtc/ice";
import {
  credentialEndpoint,
  iceServersEndpoint,
  meteredBaseUrl,
  parseMeteredCredential,
  parseMeteredIceServers,
} from "@/lib/webrtc/metered";
import { createClient } from "@/utils/supabase/server";

/**
 * GET /api/turn — configuración ICE para el cliente.
 *
 * Pide a Metered una credencial TURN con caducidad y se la entrega al
 * navegador. La `secretKey` de Metered NUNCA sale de aquí: el cliente solo
 * recibe un usuario y una contraseña que expiran.
 *
 * Requiere sesión: sin ella, este endpoint sería una fábrica gratuita de
 * credenciales para nuestro TURN de pago.
 */

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
} as const;

/** Si Metered no responde en este plazo, seguimos con STUN. */
const REQUEST_TIMEOUT_MS = 5000;

const DEFAULT_TTL_SECONDS = 3600;
/** Metered rechaza caducidades absurdas y no queremos credenciales eternas. */
const MAX_TTL_SECONDS = 86_400;

export type TurnResponse = {
  iceServers: RTCIceServer[];
  turnEnabled: boolean;
  /** Segundos unix de caducidad, o null si solo hay STUN. */
  expiresAt: number | null;
};

const stunOnly = (): TurnResponse => ({
  iceServers: [...STUN_SERVERS],
  turnEnabled: false,
  expiresAt: null,
});

function ttlSeconds(): number {
  const raw = Number.parseInt(process.env.TURN_TTL_SECONDS ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(raw, MAX_TTL_SECONDS);
}

/**
 * Caché en memoria, mejor esfuerzo.
 *
 * Cada llamada a Metered crea una credencial nueva en su panel. Sin esto, un
 * usuario que pulse "buscar otro rival" diez veces genera diez credenciales.
 * Las funciones de Vercel son efímeras, así que esto es solo una optimización:
 * si la instancia muere, se pide otra credencial y no pasa nada. Ningún dato
 * importante depende de esta caché.
 */
type CachedEntry = { body: TurnResponse; expiresAtMs: number };
const credentialCache = new Map<string, CachedEntry>();

/** Renovamos un poco antes de que caduque, para no dar credenciales al límite. */
const RENEW_MARGIN_MS = 60_000;

async function requestMeteredCredential(
  baseUrl: URL,
  secretKey: string,
  identity: string,
  expiryInSeconds: number,
) {
  const response = await fetch(credentialEndpoint(baseUrl, secretKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `label` deja rastro de qué usuario generó la credencial: si alguien abusa,
    // se puede identificar y revocar desde el panel de Metered.
    body: JSON.stringify({ expiryInSeconds, label: identity }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Metered respondió ${response.status} al crear la credencial.`,
    );
  }

  return parseMeteredCredential(await response.json());
}

async function requestMeteredIceServers(baseUrl: URL, apiKey: string) {
  const response = await fetch(iceServersEndpoint(baseUrl, apiKey), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Metered respondió ${response.status} al pedir los servidores ICE.`,
    );
  }

  return parseMeteredIceServers(await response.json());
}

export async function GET() {
  const supabase = await createClient();

  // getUser() valida el token contra el servidor de Auth. getSession() se
  // limita a leer la cookie y aquí eso no basta.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "No autenticado" },
      { status: 401, headers: NO_STORE },
    );
  }

  const secretKey = process.env.TURN_SECRET;
  const apiUrl = process.env.TURN_API_URL;

  // Sin TURN configurado degradamos a STUN en vez de romper: la mayoría de las
  // redes domésticas conectan igual.
  if (!secretKey || !apiUrl) {
    console.warn(
      "[turn] Falta %s. Sirviendo solo STUN.",
      !apiUrl ? "TURN_API_URL" : "TURN_SECRET",
    );
    return NextResponse.json(stunOnly(), { headers: NO_STORE });
  }

  const cached = credentialCache.get(user.id);
  if (cached && cached.expiresAtMs > Date.now() + RENEW_MARGIN_MS) {
    return NextResponse.json(cached.body, { headers: NO_STORE });
  }

  try {
    const baseUrl = meteredBaseUrl(apiUrl);
    const expiryInSeconds = ttlSeconds();

    const credential = await requestMeteredCredential(
      baseUrl,
      secretKey,
      user.id,
      expiryInSeconds,
    );

    // Si tenemos las URLs del relay configuradas, componemos aquí y nos
    // ahorramos la segunda llamada. Si no, se las pedimos a Metered.
    const configuredUrls = process.env.TURN_URLS;

    let iceServers: RTCIceServer[];
    let turnEnabled: boolean;

    if (parseTurnUrls(configuredUrls).length > 0) {
      ({ iceServers, turnEnabled } = buildIceServers({
        urls: configuredUrls,
        username: credential.username,
        credential: credential.password,
      }));
    } else if (credential.apiKey) {
      iceServers = [
        ...STUN_SERVERS,
        ...(await requestMeteredIceServers(baseUrl, credential.apiKey)),
      ];
      turnEnabled = true;
    } else {
      throw new Error(
        "Sin TURN_URLS y sin apiKey en la respuesta no hay forma de construir los servidores.",
      );
    }

    const effectiveTtl = credential.expiryInSeconds ?? expiryInSeconds;
    const body: TurnResponse = {
      iceServers,
      turnEnabled,
      expiresAt: turnEnabled
        ? Math.floor(Date.now() / 1000) + effectiveTtl
        : null,
    };

    if (turnEnabled) {
      credentialCache.set(user.id, {
        body,
        expiresAtMs: Date.now() + effectiveTtl * 1000,
      });
    }

    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    // Nunca registramos la URL de la petición: lleva la secretKey en la query.
    console.error(
      "[turn] Metered falló, sirviendo solo STUN:",
      error instanceof Error ? error.message : error,
    );

    return NextResponse.json(stunOnly(), { headers: NO_STORE });
  }
}
