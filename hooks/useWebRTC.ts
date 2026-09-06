"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/utils/supabase/client";

/**
 * STUN público de Google. Suficiente para la mayoría de redes domésticas.
 *
 * OJO: sin un servidor TURN, los usuarios tras NAT simétrico (muchas redes
 * móviles y corporativas) no llegarán nunca a conectar. Hay que añadir TURN
 * antes de abrir esto al público.
 */
const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  },
];

const SIGNAL_EVENT = "signal";

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

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

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
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;

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
    };
  }, [supabase, matchId, userId, isInitiator, localStream]);

  return { remoteStream, status };
}
