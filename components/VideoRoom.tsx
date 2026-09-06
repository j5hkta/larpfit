"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraOff,
  Crown,
  Loader2,
  Minus,
  RefreshCw,
  ScanLine,
  ScanSearch,
  ShieldAlert,
  Skull,
  Video,
  WifiOff,
} from "lucide-react";

import { useMatchOutcome } from "@/hooks/useMatchOutcome";
import { usePoseDetector } from "@/hooks/usePoseDetector";
import { useModularDetector } from "@/hooks/useModularDetector";
import { useRepFeedback } from "@/hooks/useRepFeedback";
import { useWebRTC } from "@/hooks/useWebRTC";
import { exerciseDuration, findExercise } from "@/lib/exercises";
import { gameModeInfo } from "@/lib/game-modes";
import { formatScore } from "@/lib/leaderboard";
import type { GameMode, PerformanceTier } from "@/types/match";
import { createClient } from "@/utils/supabase/client";

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
  gameMode: GameMode;
  performanceTier: PerformanceTier | null;
  /** Ejercicio salido del drafting. Null en Estética. */
  exerciseId: string | null;
  onLeave: () => void;
};

const PEER_COPY: Record<string, string> = {
  idle: "Preparando la conexión…",
  waiting: "Esperando a que entre tu rival…",
  connecting: "Conectando peer-to-peer…",
  connected: "Conectado",
  disconnected: "Reconectando…",
  failed: "Conexión de red fallida o rival desconectado.",
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
  gameMode,
  performanceTier,
  exerciseId,
  onLeave,
}: VideoRoomProps) {
  const mode = gameModeInfo(gameMode);
  const isPerformance = gameMode === "performance";
  const exercise = findExercise(exerciseId);

  // En Rendimiento manda la duración del ejercicio sorteado (30 s o 60 s);
  // en Estética, la de la disciplina.
  const duelSeconds =
    isPerformance && performanceTier
      ? exerciseDuration(exerciseId, performanceTier)
      : mode.durationSeconds;

  const [camera, setCamera] = useState<CameraState>({ status: "requesting" });
  const [attempt, setAttempt] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const [remaining, setRemaining] = useState(duelSeconds);
  const [duelEnded, setDuelEnded] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const poseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // --- Conexión peer-to-peer ------------------------------------------------
  const {
    remoteStream,
    status: peerStatus,
    networkError,
    iceReady,
    iceError,
  } = useWebRTC({
    matchId,
    userId,
    isInitiator,
    localStream,
  });

  // Se cayó la red: apagamos la cámara igual que al terminar un duelo. Dejar
  // la webcam encendida sobre una pantalla de error es un bug crítico.
  useEffect(() => {
    if (!networkError) return;
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, [networkError]);

  useEffect(() => {
    // No pedimos la cámara hasta tener servidores ICE: encender la webcam para
    // luego descubrir que la negociación es imposible es mal comportamiento.
    if (!iceReady) return;

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
  }, [attempt, iceReady]);

  const retryCamera = useCallback(() => {
    setCamera({ status: "requesting" });
    setAttempt((value) => value + 1);
  }, []);

  const cameraReady = camera.status === "ready";

  useEffect(() => {
    const element = remoteVideoRef.current;
    if (!element) return;

    element.srcObject = remoteStream;

    return () => {
      element.srcObject = null;
    };
  }, [remoteStream]);

  // --- Juez de IA (solo sobre nuestra propia cámara) ------------------------
  // El juez de rendimiento consume los mismos fotogramas que el de estética:
  // una sola instancia de MediaPipe alimenta a los dos.
  // Se desestructura a propósito: el hook devuelve un objeto nuevo en cada
  // render, y meterlo entero en las dependencias del cronómetro lo reiniciaría
  // en cada repetición contada. Estas funciones sí son estables.
  const {
    reps: pushupReps,
    phase: repPhase,
    labels: phaseLabels,
    warning: framingWarning,
    processFrame: processPushupFrame,
    getReps: getPushupReps,
    reset: resetPushups,
  } = useModularDetector({
    exerciseId,
    enabled: isPerformance && cameraReady && !duelEnded,
  });

  // Campanita + destello en cada repetición válida.
  const { isFlashing } = useRepFeedback(pushupReps);

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
    onLandmarks: processPushupFrame,
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
    // Rendimiento envía repeticiones enteras (0 incluido); estética envía la
    // mediana del V-taper, que puede ser null si nunca se detectó el torso.
    const score = isPerformance ? getPushupReps() : getScore();

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
  }, [getScore, getPushupReps, isPerformance, matchId]);

  // --- Cronómetro de 15 s ---------------------------------------------------
  // Arranca solo cuando los dos están conectados de verdad.
  useEffect(() => {
    if (peerStatus !== "connected" || duelEnded || networkError) return;

    resetSamples();
    resetPushups();
    const startedAt = Date.now();

    const interval = setInterval(() => {
      const left = Math.max(
        0,
        duelSeconds - Math.floor((Date.now() - startedAt) / 1000),
      );
      setRemaining(left);

      if (left === 0) {
        clearInterval(interval);
        setDuelEnded(true);
        void finishDuel();
      }
    }, 200);

    return () => clearInterval(interval);
  }, [
    peerStatus,
    duelEnded,
    networkError,
    duelSeconds,
    resetSamples,
    resetPushups,
    finishDuel,
  ]);

  // --- Configuración ICE -----------------------------------------------------
  if (iceError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12 text-center">
        <WifiOff aria-hidden className="size-14 text-flex-400" />
        <h1 className="text-2xl font-black uppercase tracking-tight text-white">
          No pudimos preparar la sala
        </h1>
        <p role="alert" className="max-w-sm text-sm text-arena-300">
          {iceError}
        </p>
        <button
          type="button"
          onClick={onLeave}
          className="mt-2 rounded-lg bg-volt-500 px-8 py-4 text-sm font-black uppercase tracking-widest text-arena-950 transition-colors hover:bg-volt-400"
        >
          Volver a la cola
        </button>
      </div>
    );
  }

  if (!iceReady) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <Loader2 aria-hidden className="size-8 animate-spin text-volt-400" />
        <p className="text-sm text-arena-300">Preparando la sala…</p>
      </div>
    );
  }

  // --- Pantalla de red caída -------------------------------------------------
  // Va antes que la de resultado: si el duelo ya terminó y la puntuación se
  // envió, el veredicto manda aunque luego se caiga la conexión.
  if (networkError && !duelEnded) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12 text-center">
        <WifiOff aria-hidden className="size-14 text-flex-400" />

        <h1 className="text-3xl font-black uppercase tracking-tight text-white">
          Duelo interrumpido
        </h1>

        <p role="alert" className="max-w-sm text-sm text-arena-300">
          {networkError}
        </p>

        <p className="max-w-sm text-xs text-arena-500">
          Si te pasa a menudo, puede que tu red necesite un servidor TURN.
        </p>

        <button
          type="button"
          onClick={onLeave}
          className="mt-2 rounded-lg bg-volt-500 px-8 py-4 text-sm font-black uppercase tracking-widest text-arena-950 transition-colors hover:bg-volt-400"
        >
          Buscar otro rival
        </button>
      </div>
    );
  }

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
                (isPerformance
                  ? "El juez está comparando las repeticiones. Esperando a tu rival."
                  : "El juez está comparando los dos torsos. Esperando a tu rival.")}
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
                  {isPerformance ? "Tus repeticiones" : "Tu V-taper"}
                </p>
                <p className="font-mono text-3xl font-bold tabular-nums text-white">
                  {formatScore(outcome.myScore, gameMode)}
                </p>
              </div>
              <span className="text-lg font-black text-arena-700">VS</span>
              <div>
                <p className="text-xs uppercase tracking-widest text-arena-500">
                  {opponentUsername ?? "Rival"}
                </p>
                <p className="font-mono text-3xl font-bold tabular-nums text-white">
                  {formatScore(outcome.opponentScore, gameMode)}
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
            {exercise?.name ?? mode.name} · {matchId.slice(0, 8)}
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

          {/* Encuadre incompleto: el detector no ve lo que necesita. */}
          {isPerformance && framingWarning && !duelEnded && (
            <div
              role="alert"
              className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-1 bg-gradient-to-b from-flex-500/35 to-transparent px-4 pb-8 pt-4 text-center"
            >
              <span className="flex animate-pulse items-center gap-2 text-sm font-black uppercase tracking-widest text-flex-400">
                <ScanSearch aria-hidden className="size-4" />
                Encuadre incompleto
              </span>
              <span className="text-xs font-semibold text-white/90">
                {framingWarning}
              </span>
            </div>
          )}

          {/* Destello de repetición válida, sincronizado con el sonido. */}
          {isPerformance && (
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-0 bg-volt-400/25 transition-opacity duration-150 ${
                isFlashing ? "opacity-100" : "opacity-0"
              }`}
            />
          )}

          <span className="absolute bottom-3 left-3 rounded-md bg-arena-950/80 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-volt-400">
            Tú
          </span>

          {cameraReady && !isPerformance && (
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

          {/* Rendimiento: contador gigante sobre el propio vídeo. */}
          {cameraReady && isPerformance && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center pb-4">
              <span
                aria-live="polite"
                aria-label={`${pushupReps} repeticiones`}
                className={`font-mono text-7xl font-black leading-none tabular-nums transition-transform duration-150 sm:text-8xl ${
                  repPhase === "active"
                    ? "scale-110 text-flex-400"
                    : "text-volt-400"
                }`}
                style={{ textShadow: "0 0 24px rgba(0,0,0,0.85)" }}
              >
                {pushupReps}
              </span>
              <span className="mt-1 text-center text-xs font-bold uppercase tracking-widest text-white/80">
                {poseStatus === "loading"
                  ? "Cargando el juez…"
                  : poseStatus === "error"
                    ? "Juez no disponible"
                    : poseStatus === "no-pose"
                      ? "No te vemos: ponte de perfil y de cuerpo entero"
                      : repPhase === "active"
                        ? `${phaseLabels.active} · vuelve a ${phaseLabels.rest.toLowerCase()}`
                        : (exercise?.name ?? "Repeticiones")}
              </span>
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
