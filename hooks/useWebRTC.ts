"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { TurnResponse } from "@/app/api/turn/route";
import { createClient } from "@/utils/supabase/client";

const SIGNAL_EVENT = "signal";

/**
 * La configuración ICE ya no vive en el bundle: se pide a /api/turn, que
 * autentica la sesión y firma credenciales efímeras con el secreto del
 * servidor. Aquí nunca llega ningún secreto de larga duración.
 */
const TURN_ENDPOINT = "/api/turn";

type IceState =
  | { status: "loading" }
  | { status: "ready"; iceServers: RTCIceServer[]; turnEnabled: boolean }
  | { status: "error"; message: string };

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
  /**
   * true cuando ya tenemos servidores ICE. Hasta entonces no se pide la cámara
   * ni se crea la RTCPeerConnection: sin ICE la negociación no llegaría a nada.
   */
  iceReady: boolean;
  /** Mensaje si /api/turn falló. */
  iceError: string | null;
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
  const [ice, setIce] = useState<IceState>({ status: "loading" });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // --- Credenciales ICE efímeras --------------------------------------------
  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch(TURN_ENDPOINT, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`El servidor respondió ${response.status}`);
        }

        const data = (await response.json()) as TurnResponse;

        if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
          throw new Error("Respuesta sin servidores ICE");
        }

        setIce({
          status: "ready",
          iceServers: data.iceServers,
          turnEnabled: Boolean(data.turnEnabled),
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        setIce({
          status: "error",
          message:
            "No pudimos obtener la configuración de red para el duelo. Recarga la página.",
        });
        console.error("[webrtc] /api/turn falló:", error);
      }
    };

    void load();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    // Sin cámara no hay nada que negociar (permiso denegado, por ejemplo).
    // Sin ICE tampoco: la negociación no encontraría ninguna ruta.
    if (!localStream || ice.status !== "ready") return;

    let disposed = false;
    let negotiationStarted = false;

    /**
     * Los candidatos ICE pueden llegar antes que la descripción remota.
     * addIceCandidate() fallaría, así que los guardamos hasta tener SDP.
     */
    const pendingCandidates: RTCIceCandidateInit[] = [];

    if (ice.turnEnabled) {
      console.info(
        `Inicializando WebRTC con soporte TURN (${ice.iceServers.length} servidores ICE, credenciales efímeras).`,
      );
    } else {
      console.warn(
        "Inicializando WebRTC solo con STUN: los usuarios tras NAT simétrico (redes móviles y corporativas) no podrán conectar. Configura TURN_URLS y TURN_SECRET en el servidor.",
      );
    }

    const pc = new RTCPeerConnection({ iceServers: ice.iceServers });
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
  }, [supabase, matchId, userId, isInitiator, localStream, ice]);

  return {
    remoteStream,
    status,
    networkError,
    iceReady: ice.status === "ready",
    iceError: ice.status === "error" ? ice.message : null,
  };
}
