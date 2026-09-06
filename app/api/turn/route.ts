import { NextResponse } from "next/server";

import { buildIceServers, STUN_SERVERS } from "@/lib/webrtc/ice";
import {
  createTurnCredentials,
  DEFAULT_TTL_SECONDS,
} from "@/lib/webrtc/turn-credentials";
import { createClient } from "@/utils/supabase/server";

/**
 * GET /api/turn — configuración ICE para el cliente.
 *
 * Devuelve STUN siempre y, si hay TURN configurado, credenciales efímeras
 * firmadas aquí con el secreto compartido. El secreto NUNCA sale del servidor:
 * al navegador solo llega un usuario/credencial que caduca en minutos.
 *
 * Requiere sesión: si no, cualquiera podría usar este endpoint como fábrica
 * gratuita de credenciales para nuestro TURN.
 */

// Estas credenciales son distintas para cada usuario y caducan: cachear la
// respuesta sería una fuga de seguridad, no una optimización.
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
} as const;

export type TurnResponse = {
  iceServers: RTCIceServer[];
  turnEnabled: boolean;
  /** Segundos unix de caducidad, o null si solo hay STUN. */
  expiresAt: number | null;
};

function ttlSeconds(): number {
  const raw = Number.parseInt(process.env.TURN_TTL_SECONDS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_SECONDS;
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

  const turnUrls = process.env.TURN_URLS;
  const turnSecret = process.env.TURN_SECRET;

  // Sin TURN configurado degradamos a STUN en vez de romper: la mayoría de las
  // redes domésticas conectan igual. El cliente avisa por consola.
  if (!turnUrls || !turnSecret) {
    const body: TurnResponse = {
      iceServers: [...STUN_SERVERS],
      turnEnabled: false,
      expiresAt: null,
    };

    return NextResponse.json(body, { headers: NO_STORE });
  }

  try {
    const { username, credential, expiresAt } = createTurnCredentials({
      secret: turnSecret,
      // Atar la credencial al usuario permite rastrear y cortar abusos.
      identity: user.id,
      ttlSeconds: ttlSeconds(),
    });

    const { iceServers, turnEnabled } = buildIceServers({
      urls: turnUrls,
      username,
      credential,
    });

    const body: TurnResponse = {
      iceServers,
      turnEnabled,
      expiresAt: turnEnabled ? expiresAt : null,
    };

    return NextResponse.json(body, { headers: NO_STORE });
  } catch (error) {
    console.error(
      "[turn] No se pudieron generar credenciales efímeras:",
      error,
    );

    // Un TURN mal configurado no debe dejar sin jugar a quien sí conectaría
    // por STUN.
    const body: TurnResponse = {
      iceServers: [...STUN_SERVERS],
      turnEnabled: false,
      expiresAt: null,
    };

    return NextResponse.json(body, { headers: NO_STORE });
  }
}
