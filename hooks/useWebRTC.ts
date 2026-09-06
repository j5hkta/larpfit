"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { buildIceServers } from "@/lib/webrtc/ice";
import { createClient } from "@/utils/supabase/client";

/**
 * Configuración ICE. Las referencias a process.env tienen que ser literales
 * para que Next las inyecte en el bundle del navegador en tiempo de build.
 *
 * ADVERTENCIA DE SEGURIDAD: al ser NEXT_PUBLIC_*, la credencial del TURN viaja
 * al navegador en texto plano y cualquiera puede extraerla del bundle y usar el
 * servidor por su cuenta (te comes tú el ancho de banda). Para producción, lo
 * correcto son credenciales efímeras firmadas en el servidor (coturn con
 * `use-auth-secret` y HMAC con caducidad).
 */
const { iceServers: ICE_SERVERS, turnEnabled: TURN_ENABLED } = buildIceServers({
  urls: process.env.NEXT_PUBLIC_TURN_URLS,
  username: process.env.NEXT_PUBLIC_TURN_USERNAME,
  credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
});

const SIGNAL_EVENT = "signal";

/**
 * `disconnected` en ICE suele ser un bache pasajero de red (wifi, cambio de
 * celda) del que la conexión se recupera sola. Solo lo damos por perdido si
 * persiste: abortar un duelo por un parpadeo de dos segundos sería peor.
 */
const DISCONNECT_GRACE_MS = 5000;

const NETWORK_ERROR_MESSAGE = "Conexión de red fallida o rival desconectado.";

type SignalMessage =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice-candidate"; candidate: RTCIceCandidateInit };

export type PeerStatus =
  "idle" | "waiting" | "connecting" | "connected" | "disconnected" | "failed";

type UseWebRTCArgs = {
  matchId: string;
  userId: string;
  /** player1 del match. Regla fija: siempre es quien crea la oferta SDP. */
  isInitiator: boolean;
  localStream: MediaStream | null;
};

type UseWebRTCResult = {
  remoteStream: MediaStream | null;
  status: PeerStatus;
  /** Mensaje si la conexión se cae de forma irrecuperable; null si todo va bien. */
  networkError: string | null;
};

/**
 * Conexión WebRTC peer-to-peer señalizada por Supabase Realtime (Broadcast).
 *
 * El vídeo NUNCA pasa por nuestro backend: Supabase solo transporta las ofertas
 * y respuestas SDP y los candidatos ICE.
 */
export function useWebRTC({
  matchId,
  userId,
  isInitiator,
  localStream,
}: UseWebRTCArgs): UseWebRTCResult {
  const supabase = useMemo(() => createClient(), []);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<PeerStatus>("idle");
  const [networkError, setNetworkError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    // Sin cámara no hay nada que negociar (permiso denegado, por ejemplo).
    if (!localStream) return;

    let disposed = false;
    let negotiationStarted = false;

    /**
     * Los candidatos ICE pueden llegar antes que la descripción remota.
     * addIceCandidate() fallaría, así que los guardamos hasta tener SDP.
     */
    const pendingCandidates: RTCIceCandidateInit[] = [];

    if (TURN_ENABLED) {
      console.info(
        `Inicializando WebRTC con soporte TURN (${ICE_SERVERS.length} servidores ICE).`,
      );
    } else {
      console.warn(
        "Inicializando WebRTC solo con STUN: los usuarios tras NAT simétrico (redes móviles y corporativas) no podrán conectar. Configura NEXT_PUBLIC_TURN_URLS, NEXT_PUBLIC_TURN_USERNAME y NEXT_PUBLIC_TURN_CREDENTIAL.",
      );
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    /** Timer de gracia para el estado `disconnected` de ICE. */
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const clearDisconnectTimer = () => {
      if (disconnectTimer === null) return;
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    };

    const channel = supabase.channel(`room-${matchId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: userId },
      },
    });
    channelRef.current = channel;

    const send = (message: SignalMessage) =>
      channel.send({
        type: "broadcast",
        event: SIGNAL_EVENT,
        payload: message,
      });

    // --- Pistas locales hacia el peer ---------------------------------------
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    // --- Eventos de la conexión ---------------------------------------------
    pc.ontrack = (event) => {
      if (disposed) return;
      setRemoteStream(event.streams[0] ?? new MediaStream([event.track]));
    };

    pc.onicecandidate = (event) => {
      if (disposed || !event.candidate) return;
      void send({ kind: "ice-candidate", candidate: event.candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      if (disposed) return;

      switch (pc.connectionState) {
        case "connected":
          setStatus("connected");
          break;
        case "connecting":
        case "new":
          setStatus("connecting");
          break;
        case "disconnected":
        case "closed":
          setStatus("disconnected");
          break;
        case "failed":
          setStatus("failed");
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (disposed) return;

      switch (pc.iceConnectionState) {
        case "connected":
        case "completed":
          // Se recuperó sola: retiramos el aviso.
          clearDisconnectTimer();
          setNetworkError(null);
          setStatus("connected");
          break;

        case "failed":
          // ICE agotó todos los candidatos: no hay ruta posible.
          clearDisconnectTimer();
          setStatus("failed");
          setNetworkError(NETWORK_ERROR_MESSAGE);
          break;

        case "disconnected":
          setStatus("disconnected");
          disconnectTimer ??= setTimeout(() => {
            if (!disposed) setNetworkError(NETWORK_ERROR_MESSAGE);
          }, DISCONNECT_GRACE_MS);
          break;
      }
    };

    const flushCandidates = async () => {
      while (pendingCandidates.length > 0) {
        const candidate = pendingCandidates.shift();
        if (!candidate) continue;
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          // Un candidato inválido no debe tumbar la negociación entera.
        }
      }
    };

    // --- Señalización -------------------------------------------------------
    const handleSignal = async (message: SignalMessage) => {
      if (disposed) return;

      try {
        if (message.kind === "offer") {
          await pc.setRemoteDescription(message.sdp);
          await flushCandidates();

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await send({ kind: "answer", sdp: answer });
          return;
        }

        if (message.kind === "answer") {
          // Llega una answer sin haber ofertado: descartar en vez de romper.
          if (pc.signalingState !== "have-local-offer") return;

          await pc.setRemoteDescription(message.sdp);
          await flushCandidates();
          return;
        }

        if (pc.remoteDescription) {
          await pc.addIceCandidate(message.candidate);
        } else {
          pendingCandidates.push(message.candidate);
        }
      } catch {
        if (!disposed) setStatus("failed");
      }
    };

    /**
     * La oferta se lanza cuando Presence confirma que el rival está en la sala.
     * Broadcast no guarda mensajes: si ofertáramos antes de que el otro se
     * suscribiera, la oferta se perdería en el vacío y nadie conectaría.
     */
    const startNegotiationIfReady = async () => {
      if (disposed || !isInitiator || negotiationStarted) return;

      const peers = Object.keys(channel.presenceState()).filter(
        (key) => key !== userId,
      );
      if (peers.length === 0) return;

      negotiationStarted = true;
      setStatus("connecting");

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await send({ kind: "offer", sdp: offer });
      } catch {
        if (!disposed) setStatus("failed");
      }
    };

    channel
      .on("broadcast", { event: SIGNAL_EVENT }, ({ payload }) => {
        void handleSignal(payload as SignalMessage);
      })
      .on("presence", { event: "sync" }, () => {
        void startNegotiationIfReady();
      })
      .on("presence", { event: "join" }, () => {
        void startNegotiationIfReady();
      })
      .subscribe(async (channelStatus) => {
        if (disposed) return;

        if (
          channelStatus === "CHANNEL_ERROR" ||
          channelStatus === "TIMED_OUT"
        ) {
          setStatus("failed");
          return;
        }

        if (channelStatus !== "SUBSCRIBED") return;

        setStatus("waiting");
        await channel.track({ userId, at: Date.now() });
      });

    // --- Limpieza -----------------------------------------------------------
    return () => {
      disposed = true;

      // Quitar los listeners antes de cerrar para que no disparen sobre una
      // conexión muerta.
      clearDisconnectTimer();

      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;

      for (const sender of pc.getSenders()) {
        try {
          pc.removeTrack(sender);
        } catch {
          // La conexión ya podía estar cerrándose.
        }
      }

      pc.close();
      pcRef.current = null;

      // OJO: no paramos las pistas de localStream. Son de VideoRoom, que es
      // quien las apaga; hacerlo aquí dejaría la cámara muerta al reconectar.
      void channel.untrack();
      void supabase.removeChannel(channel);
      channelRef.current = null;

      setRemoteStream(null);
      setStatus("idle");
      setNetworkError(null);
    };
  }, [supabase, matchId, userId, isInitiator, localStream]);

  return { remoteStream, status, networkError };
}
