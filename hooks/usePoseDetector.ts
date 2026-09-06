"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  NormalizedLandmarkList,
  Pose as PoseInstance,
  PoseConfig,
  Results,
} from "@mediapipe/pose";

import {
  aggregateScore,
  isPlausibleRatio,
  LANDMARK,
  measureTorso,
  MIN_VISIBILITY,
  type TorsoReading,
} from "@/lib/judge/vtaper";

/** Refrescos por segundo del estado de React (el dibujo va a 60 fps). */
const STATE_UPDATE_MS = 250;

/** Los assets los sirve public/mediapipe/pose (ver scripts/copy-mediapipe.mjs). */
const MEDIAPIPE_BASE = "/mediapipe/pose";

export type { TorsoReading };
export { LANDMARK };

export type PoseStatus = "idle" | "loading" | "detecting" | "no-pose" | "error";

type UsePoseDetectorResult = {
  status: PoseStatus;
  /** Lectura instantánea, para la UI en vivo. */
  torso: TorsoReading | null;
  /** Puntuación agregada del duelo. Se lee al terminar el cronómetro. */
  getScore: () => number | null;
  /** Vacía el acumulador al empezar un duelo nuevo. */
  resetSamples: () => void;
};

type UsePoseDetectorArgs = {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Solo arrancamos cuando hay cámara lista. */
  enabled: boolean;
};

type PoseConstructor = new (config?: PoseConfig) => PoseInstance;

declare global {
  interface Window {
    Pose?: PoseConstructor;
  }
}

let scriptPromise: Promise<PoseConstructor> | null = null;

/**
 * Carga pose.js con una etiqueta <script>.
 *
 * No se puede importar como módulo: el paquete npm es un IIFE que asigna
 * `window.Pose` y no exporta nada (cero `module.exports`), así que un
 * `import { Pose }` devuelve undefined en cuanto el bundler lo procesa.
 */
function loadPose(): Promise<PoseConstructor> {
  if (window.Pose) return Promise.resolve(window.Pose);

  scriptPromise ??= new Promise<PoseConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${MEDIAPIPE_BASE}/pose.js`;
    script.crossOrigin = "anonymous";

    script.onload = () => {
      if (window.Pose) resolve(window.Pose);
      else reject(new Error("pose.js cargó pero no definió window.Pose."));
    };
    script.onerror = () =>
      reject(
        new Error("No se pudo cargar pose.js. ¿Corriste el copiado de assets?"),
      );

    document.head.append(script);
  });

  return scriptPromise;
}

function draw(
  canvas: HTMLCanvasElement,
  landmarks: NormalizedLandmarkList,
  torso: TorsoReading | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const point = (index: number) => ({
    x: landmarks[index].x * width,
    y: landmarks[index].y * height,
  });

  // Esqueleto completo, discreto.
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  for (const landmark of landmarks) {
    if ((landmark.visibility ?? 0) < MIN_VISIBILITY) continue;
    ctx.beginPath();
    ctx.arc(landmark.x * width, landmark.y * height, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!torso) return;

  const leftShoulder = point(LANDMARK.LEFT_SHOULDER);
  const rightShoulder = point(LANDMARK.RIGHT_SHOULDER);
  const leftHip = point(LANDMARK.LEFT_HIP);
  const rightHip = point(LANDMARK.RIGHT_HIP);

  // Cuadrilátero del torso: lo que mide el juez.
  ctx.beginPath();
  ctx.moveTo(leftShoulder.x, leftShoulder.y);
  ctx.lineTo(rightShoulder.x, rightShoulder.y);
  ctx.lineTo(rightHip.x, rightHip.y);
  ctx.lineTo(leftHip.x, leftHip.y);
  ctx.closePath();
  ctx.fillStyle = "rgba(184, 240, 0, 0.12)";
  ctx.fill();

  // Línea de hombros.
  ctx.strokeStyle = "#d4ff3f";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(leftShoulder.x, leftShoulder.y);
  ctx.lineTo(rightShoulder.x, rightShoulder.y);
  ctx.stroke();

  // Línea de cintura.
  ctx.strokeStyle = "#ff3d7f";
  ctx.beginPath();
  ctx.moveTo(leftHip.x, leftHip.y);
  ctx.lineTo(rightHip.x, rightHip.y);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  for (const anchor of [leftShoulder, rightShoulder, leftHip, rightHip]) {
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * MediaPipe Pose sobre el vídeo local, con el esqueleto pintado en un canvas.
 *
 * Todo ocurre en el navegador: ni un frame sale del dispositivo. La
 * instanciación vive dentro del useEffect porque MediaPipe necesita `window`
 * y reventaría en el render del servidor.
 */
export function usePoseDetector({
  videoRef,
  canvasRef,
  enabled,
}: UsePoseDetectorArgs): UsePoseDetectorResult {
  const [status, setStatus] = useState<PoseStatus>("idle");
  const [torso, setTorso] = useState<TorsoReading | null>(null);

  const lastStateUpdate = useRef(0);

  /** Todas las lecturas válidas del duelo en curso. */
  const samplesRef = useRef<number[]>([]);
  /** Última lectura válida, por si no da tiempo a juntar muestras. */
  const lastRatioRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let frameId = 0;
    let pose: PoseInstance | null = null;

    // Copia para la limpieza: en ese momento el ref ya puede apuntar a otro nodo.
    const canvasAtMount = canvasRef.current;

    /** El estado de React se refresca 4 veces/s; el canvas, a cada frame. */
    const publish = (nextStatus: PoseStatus, reading: TorsoReading | null) => {
      const now = Date.now();
      if (now - lastStateUpdate.current < STATE_UPDATE_MS) return;
      lastStateUpdate.current = now;

      setStatus(nextStatus);
      setTorso(reading);
    };

    const handleResults = (results: Results) => {
      if (disposed) return;

      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;

      // El canvas trabaja en las coordenadas nativas del vídeo.
      if (
        canvas.width !== video.videoWidth ||
        canvas.height !== video.videoHeight
      ) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const landmarks = results.poseLandmarks;

      if (!landmarks || landmarks.length === 0) {
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        publish("no-pose", null);
        return;
      }

      const reading = measureTorso(landmarks);

      if (reading && isPlausibleRatio(reading.ratio)) {
        samplesRef.current.push(reading.ratio);
        lastRatioRef.current = reading.ratio;
      }

      draw(canvas, landmarks, reading);
      publish(reading ? "detecting" : "no-pose", reading);
    };

    const start = async () => {
      try {
        const PoseCtor = await loadPose();
        if (disposed) return;

        pose = new PoseCtor({
          // MediaPipe pide sus .wasm/.tflite por HTTP con esta función.
          locateFile: (file: string) => `${MEDIAPIPE_BASE}/${file}`,
        });

        pose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        pose.onResults(handleResults);
        await pose.initialize();

        if (disposed) return;

        const tick = async () => {
          if (disposed || !pose) return;

          const video = videoRef.current;
          // send() revienta si el vídeo aún no tiene dimensiones.
          if (video && video.readyState >= 2 && video.videoWidth > 0) {
            try {
              await pose.send({ image: video });
            } catch {
              // Un frame perdido no justifica tumbar el detector.
            }
          }

          if (!disposed) frameId = requestAnimationFrame(() => void tick());
        };

        void tick();
      } catch {
        if (!disposed) setStatus("error");
      }
    };

    void start();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);

      // close() libera el runtime wasm. Puede rechazar si había un send en
      // vuelo; no es motivo para romper el desmontaje.
      if (pose) void pose.close().catch(() => {});
      pose = null;

      canvasAtMount
        ?.getContext("2d")
        ?.clearRect(0, 0, canvasAtMount.width, canvasAtMount.height);

      setStatus("idle");
      setTorso(null);
    };
  }, [enabled, videoRef, canvasRef]);

  /**
   * Puntuación final del jugador: mediana de las muestras del duelo.
   * Devuelve null si nunca se detectó un torso completo.
   */
  const getScore = useCallback(
    (): number | null =>
      aggregateScore(samplesRef.current, lastRatioRef.current),
    [],
  );

  /** Descarta lo acumulado. Se llama al arrancar cada duelo. */
  const resetSamples = useCallback(() => {
    samplesRef.current = [];
    lastRatioRef.current = null;
  }, []);

  // "loading" se deriva en vez de asignarse: React 19 no permite setState
  // síncrono en el cuerpo de un efecto.
  const effectiveStatus: PoseStatus =
    enabled && status === "idle" ? "loading" : status;

  return { status: effectiveStatus, torso, getScore, resetSamples };
}
