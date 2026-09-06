"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraOff,
  Crown,
  Loader2,
  Minus,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  Skull,
  Video,
} from "lucide-react";

import { useMatchOutcome } from "@/hooks/useMatchOutcome";
import { usePoseDetector } from "@/hooks/usePoseDetector";
import { useWebRTC } from "@/hooks/useWebRTC";
import { createClient } from "@/utils/supabase/client";

/** Duración del duelo. */
const DUEL_SECONDS = 15;

type CameraState =
  | { status: "requesting" }
  | { status: "ready" }
  | { status: "denied" }
  | { status: "not-found" }
  | { status: "in-use" }
  | { status: "insecure" }
  | { status: "error"; message: string };

type VideoRoomProps = {
  matchId: string;
  userId: string;
  isInitiator: boolean;
  opponentUsername: string | null;
  onLeave: () => void;
};

const PEER_COPY: Record<string, string> = {
  idle: "Preparando la conexión…",
  waiting: "Esperando a que entre tu rival…",
  connecting: "Conectando peer-to-peer…",
  connected: "Conectado",
  disconnected: "Se ha perdido la conexión con tu rival.",
  failed:
    "No se pudo establecer la conexión. Puede que tu red necesite un servidor TURN.",
};

/** El navegador no expone mediaDevices fuera de un contexto seguro. */
class InsecureContextError extends Error {}

/** Traduce el DOMException de getUserMedia a un estado que sepamos explicar. */
function mapCameraError(error: unknown): CameraState {
  if (error instanceof InsecureContextError) return { status: "insecure" };

  const name = error instanceof DOMException ? error.name : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return { status: "denied" };
    case "NotFoundError":
    case "OverconstrainedError":
      return { status: "not-found" };
    case "NotReadableError":
    case "AbortError":
      return { status: "in-use" };
    default:
      return {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Error desconocido con la cámara.",
      };
  }
}

const CAMERA_COPY: Record<
  Exclude<CameraState["status"], "ready" | "requesting">,
  { title: string; body: string }
> = {
  denied: {
    title: "Necesitamos tu cámara para jugar",
    body: "Has bloqueado el acceso. Pulsa el icono de la barra de direcciones, permite cámara y micrófono, y vuelve a intentarlo.",
  },
  "not-found": {
    title: "No encontramos ninguna cámara",
    body: "Conecta una webcam y vuelve a intentarlo. Sin vídeo no hay duelo.",
  },
  "in-use": {
    title: "Tu cámara está ocupada",
    body: "Otra aplicación la está usando (Zoom, Meet, OBS…). Ciérrala y reintenta.",
  },
  insecure: {
    title: "Conexión no segura",
    body: "El navegador solo da acceso a la cámara en HTTPS o en localhost. Abre la app en localhost o despliégala en Vercel.",
  },
  error: {
    title: "No pudimos abrir la cámara",
    body: "Ha ocurrido un error inesperado al pedir acceso a tu cámara.",
  },
};

/**
 * Sala del duelo: cámara local, conexión P2P, 15 s de cronómetro, análisis de
 * pose y veredicto del juez.
 */
export function VideoRoom({
  matchId,
  userId,
  isInitiator,
  opponentUsername,
  onLeave,
}: VideoRoomProps) {
  const [camera, setCamera] = useState<CameraState>({ status: "requesting" });
  const [attempt, setAttempt] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const [remaining, setRemaining] = useState(DUEL_SECONDS);
  const [duelEnded, setDuelEnded] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const poseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    // Copia local: en la limpieza el ref ya puede apuntar a otro nodo.
    const localVideo = localVideoRef.current;

    const requestCamera = async (): Promise<MediaStream> => {
      // Fuera de un contexto seguro navigator.mediaDevices ni siquiera existe.
      if (!navigator.mediaDevices?.getUserMedia)
        throw new InsecureContextError();

      return navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: true,
      });
    };

    requestCamera()
      .then((mediaStream) => {
        if (cancelled) {
          // El componente se desmontó mientras el usuario decidía: apagamos.
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = mediaStream;
        streamRef.current = mediaStream;

        if (localVideo) {
          localVideo.srcObject = mediaStream;
        }

        // El stream va al estado para que useWebRTC pueda añadir sus pistas.
        setLocalStream(mediaStream);
        setCamera({ status: "ready" });
      })
      .catch((error: unknown) => {
        if (!cancelled) setCamera(mapCameraError(error));
      });

    return () => {
      cancelled = true;

      // Apagar TODAS las pistas: si no, la luz de la cámara se queda encendida.
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      if (localVideo) {
        localVideo.srcObject = null;
      }

      setLocalStream(null);
    };
  }, [attempt]);

  const retryCamera = useCallback(() => {
    setCamera({ status: "requesting" });
    setAttempt((value) => value + 1);
  }, []);

  const cameraReady = camera.status === "ready";

  // --- Conexión peer-to-peer ------------------------------------------------
  const { remoteStream, status: peerStatus } = useWebRTC({
    matchId,
    userId,
    isInitiator,
    localStream,
  });

  useEffect(() => {
    const element = remoteVideoRef.current;
    if (!element) return;

    element.srcObject = remoteStream;

    return () => {
      element.srcObject = null;
    };
  }, [remoteStream]);

  // --- Juez de IA (solo sobre nuestra propia cámara) ------------------------
  const {
    status: poseStatus,
    torso,
    getScore,
    resetSamples,
  } = usePoseDetector({
    videoRef: localVideoRef,
    canvasRef: poseCanvasRef,
    // Al acabar el duelo dejamos de analizar: la cámara ya está apagada.
    enabled: cameraReady && !duelEnded,
  });

  // --- Veredicto ------------------------------------------------------------
  const outcome = useMatchOutcome(matchId, userId, duelEnded);

  /**
   * Fin del duelo: apagar la cámara y enviar la puntuación.
   *
   * Solo mandamos nuestro número. El ganador lo decide submit_score() en el
   * servidor; desde aquí es imposible declararse vencedor.
   */
  const finishDuel = useCallback(async () => {
    const score = getScore();

    // Apagar TODAS las pistas congela el vídeo y apaga la luz de la cámara.
    streamRef.current?.getTracks().forEach((track) => track.stop());

    if (score === null) {
      setSubmitError(
        "No detectamos tu torso en ningún momento. El duelo se cierra sin puntuación.",
      );
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.rpc("submit_score", {
      p_match_id: matchId,
      p_score: Number(score.toFixed(3)),
    });

    if (error)
      setSubmitError(`No pudimos enviar tu puntuación: ${error.message}`);
  }, [getScore, matchId]);

  // --- Cronómetro de 15 s ---------------------------------------------------
  // Arranca solo cuando los dos están conectados de verdad.
  useEffect(() => {
    if (peerStatus !== "connected" || duelEnded) return;

    resetSamples();
    const startedAt = Date.now();

    const interval = setInterval(() => {
      const left = Math.max(
        0,
        DUEL_SECONDS - Math.floor((Date.now() - startedAt) / 1000),
      );
      setRemaining(left);

      if (left === 0) {
        clearInterval(interval);
        setDuelEnded(true);
        void finishDuel();
      }
    }, 200);

    return () => clearInterval(interval);
  }, [peerStatus, duelEnded, resetSamples, finishDuel]);

  // --- Pantalla de resultado -------------------------------------------------
  if (duelEnded) {
    const won = outcome?.resolved && outcome.winnerId === userId;
    const draw = outcome?.resolved && outcome.winnerId === null;

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12 text-center">
        {!outcome?.resolved ? (
          <>
            <Loader2
              aria-hidden
              className="size-10 animate-spin text-volt-400"
            />
            <h1 className="text-2xl font-black uppercase tracking-tight text-white">
              Calculando resultados…
            </h1>
            <p className="max-w-sm text-sm text-arena-300">
              {submitError ??
                "El juez está comparando los dos torsos. Esperando a tu rival."}
            </p>
          </>
        ) : (
          <>
            {won ? (
              <Crown aria-hidden className="size-16 text-volt-400" />
            ) : draw ? (
              <Minus aria-hidden className="size-16 text-arena-300" />
            ) : (
              <Skull aria-hidden className="size-16 text-flex-400" />
            )}

            <h1
              className={`text-5xl font-black uppercase tracking-tighter sm:text-7xl ${
                won
                  ? "text-volt-400"
                  : draw
                    ? "text-arena-300"
                    : "text-flex-400"
              }`}
            >
              {won ? "¡Ganaste!" : draw ? "Empate" : "Perdiste"}
            </h1>

            <div className="flex items-center gap-8 rounded-2xl border border-arena-700/70 bg-arena-900/80 px-8 py-5">
              <div>
                <p className="text-xs uppercase tracking-widest text-arena-500">
                  Tu V-taper
                </p>
                <p className="font-mono text-3xl font-bold tabular-nums text-white">
                  {outcome.myScore?.toFixed(2) ?? "—"}
                </p>
              </div>
              <span className="text-lg font-black text-arena-700">VS</span>
              <div>
                <p className="text-xs uppercase tracking-widest text-arena-500">
                  {opponentUsername ?? "Rival"}
                </p>
                <p className="font-mono text-3xl font-bold tabular-nums text-white">
                  {outcome.opponentScore?.toFixed(2) ?? "—"}
                </p>
              </div>
            </div>

            {submitError && (
              <p role="alert" className="max-w-sm text-xs text-flex-400">
                {submitError}
              </p>
            )}
          </>
        )}

        <button
          type="button"
          onClick={onLeave}
          className="mt-4 rounded-lg bg-volt-500 px-8 py-4 text-sm font-black uppercase tracking-widest text-arena-950 transition-colors hover:bg-volt-400"
        >
          Buscar otro rival
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-left">
          <p className="text-xs uppercase tracking-widest text-arena-500">
            Duelo · {matchId.slice(0, 8)}
          </p>
          <h1 className="text-lg font-black uppercase tracking-tight text-white">
            Tú vs{" "}
            <span className="text-volt-400">{opponentUsername ?? "Rival"}</span>
          </h1>
        </div>

        {peerStatus === "connected" && (
          <div
            aria-live="polite"
            className={`font-mono text-5xl font-black tabular-nums ${
              remaining <= 5 ? "text-flex-400" : "text-volt-400"
            }`}
          >
            {String(remaining).padStart(2, "0")}
          </div>
        )}

        <div className="flex items-center gap-3">
          <span
            aria-live="polite"
            className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wider ${
              peerStatus === "connected"
                ? "border-volt-500/50 text-volt-400"
                : peerStatus === "failed" || peerStatus === "disconnected"
                  ? "border-flex-500/50 text-flex-400"
                  : "border-arena-700 text-arena-300"
            }`}
          >
            {PEER_COPY[peerStatus]}
          </span>
          <span className="rounded-full border border-arena-700 px-3 py-1 text-xs uppercase tracking-wider text-arena-300">
            {isInitiator ? "Anfitrión" : "Invitado"}
          </span>
          <button
            type="button"
            onClick={onLeave}
            className="rounded-lg border border-arena-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-arena-300 transition-colors hover:border-flex-500/50 hover:text-flex-400"
          >
            Salir
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2">
        {/* --- Vídeo local --- */}
        <section className="relative flex min-h-[38vh] items-center justify-center overflow-hidden rounded-2xl border border-arena-700/70 bg-arena-900 md:min-h-0">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`size-full -scale-x-100 object-cover transition-opacity ${
              cameraReady ? "opacity-100" : "opacity-0"
            }`}
          />

          {camera.status === "requesting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <Loader2
                aria-hidden
                className="size-6 animate-spin text-volt-400"
              />
              <p className="text-sm text-arena-300">
                Permite el acceso a la cámara y al micrófono…
              </p>
            </div>
          )}

          {!cameraReady && camera.status !== "requesting" && (
            <div
              role="alert"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
            >
              <ShieldAlert aria-hidden className="size-8 text-flex-400" />
              <p className="text-sm font-bold text-white">
                {CAMERA_COPY[camera.status].title}
              </p>
              <p className="max-w-xs text-xs text-arena-300">
                {CAMERA_COPY[camera.status].body}
              </p>
              {camera.status === "error" && (
                <p className="max-w-xs font-mono text-[11px] text-arena-500">
                  {camera.message}
                </p>
              )}
              <button
                type="button"
                onClick={retryCamera}
                className="mt-1 flex items-center gap-2 rounded-lg bg-volt-500 px-4 py-2 text-xs font-black uppercase tracking-widest text-arena-950 transition-colors hover:bg-volt-400"
              >
                <RefreshCw aria-hidden className="size-3.5" />
                Reintentar
              </button>
            </div>
          )}

          {/* Esqueleto de MediaPipe. Va espejado igual que el vídeo para que
              los puntos caigan sobre el cuerpo y no invertidos. */}
          <canvas
            ref={poseCanvasRef}
            aria-hidden
            className={`pointer-events-none absolute inset-0 size-full -scale-x-100 object-cover transition-opacity ${
              cameraReady ? "opacity-100" : "opacity-0"
            }`}
          />

          <span className="absolute bottom-3 left-3 rounded-md bg-arena-950/80 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-volt-400">
            Tú
          </span>

          {cameraReady && (
            <div
              aria-live="polite"
              className="absolute bottom-3 right-3 flex items-center gap-2 rounded-md bg-arena-950/85 px-2.5 py-1.5 text-xs"
            >
              <ScanLine
                aria-hidden
                className={`size-3.5 ${
                  poseStatus === "detecting"
                    ? "text-volt-400"
                    : "text-arena-500"
                }`}
              />
              {poseStatus === "detecting" && torso ? (
                <span className="font-mono tabular-nums text-volt-400">
                  V-taper {torso.ratio.toFixed(2)}
                </span>
              ) : (
                <span className="text-arena-300">
                  {poseStatus === "loading"
                    ? "Cargando el juez…"
                    : poseStatus === "error"
                      ? "Juez no disponible"
                      : "Ponte de cuerpo entero"}
                </span>
              )}
            </div>
          )}
        </section>

        {/* --- Vídeo remoto (WebRTC P2P) --- */}
        <section className="relative flex min-h-[38vh] items-center justify-center overflow-hidden rounded-2xl border border-arena-700/70 bg-arena-900 md:min-h-0">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`absolute inset-0 size-full object-cover transition-opacity ${
              remoteStream ? "opacity-100" : "opacity-0"
            }`}
          />

          <div
            className={`relative flex flex-col items-center gap-3 px-6 text-center ${
              remoteStream ? "hidden" : ""
            }`}
          >
            {cameraReady ? (
              <Video aria-hidden className="size-8 text-arena-500" />
            ) : (
              <CameraOff aria-hidden className="size-8 text-arena-700" />
            )}
            <p className="text-sm text-arena-300">
              Esperando el vídeo de{" "}
              <span className="font-semibold text-white">
                {opponentUsername ?? "tu rival"}
              </span>
            </p>
            <p className="text-xs uppercase tracking-widest text-arena-500">
              {PEER_COPY[peerStatus]}
            </p>
          </div>

          <span className="absolute bottom-3 left-3 rounded-md bg-arena-950/80 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-arena-300">
            {opponentUsername ?? "Rival"}
          </span>
        </section>
      </div>
    </div>
  );
}
