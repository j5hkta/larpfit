"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  LandmarkConnectionArray,
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
  type TorsoReading,
} from "@/lib/judge/vtaper";
import {
  classifyConnection,
  type ConnectionGroup,
  FACE_MAX_INDEX,
  GROUP_STYLE,
} from "@/lib/pose/skeleton";

/** Refrescos por segundo del estado de React (el dibujo va a 60 fps). */
const STATE_UPDATE_MS = 250;

/** Los assets los sirve public/mediapipe/pose (ver scripts/copy-mediapipe.mjs). */
const MEDIAPIPE_BASE = "/mediapipe/pose";

/**
 * Umbral de confianza SOLO para pintar. Es más permisivo que el del juez
 * (MIN_VISIBILITY) para que el esqueleto se vea completo aunque una muñeca
 * entre y salga. La puntuación sigue usando el umbral estricto: esto no toca
 * la medición.
 */
const DRAW_MIN_VISIBILITY = 0.5;

/** Paleta del escáner. */
const SCAN = "34, 211, 238"; // cian neón
const VOLT = "#d4ff3f"; // línea de hombros
const FLEX = "#ff3d7f"; // línea de caderas

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
  /**
   * Recibe los landmarks crudos de cada fotograma. Lo usa el juez de
   * rendimiento para alimentar su máquina de estados sin montar una segunda
   * instancia de MediaPipe.
   */
  onLandmarks?: (landmarks: NormalizedLandmarkList | undefined) => void;
};

type PoseConstructor = new (config?: PoseConfig) => PoseInstance;

declare global {
  interface Window {
    Pose?: PoseConstructor;
    /** pose.js publica aquí los 35 pares de conexiones del esqueleto. */
    POSE_CONNECTIONS?: LandmarkConnectionArray;
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

/**
 * Las conexiones oficiales de MediaPipe (35 pares). Las publica el propio
 * pose.js en el global, así que no hace falta duplicar la lista aquí.
 */
let cachedConnections: LandmarkConnectionArray | null = null;

function poseConnections(): LandmarkConnectionArray {
  cachedConnections ??= window.POSE_CONNECTIONS ?? [];
  return cachedConnections;
}

type Point = { x: number; y: number };

/**
 * Traza los segmentos dos veces: una estela ancha y translúcida debajo y una
 * línea fina y brillante encima. Da el halo de neón sin usar `shadowBlur`,
 * que a 30 fps sobre 1280x720 hunde el frame rate.
 */
function strokeGlow(
  ctx: CanvasRenderingContext2D,
  segments: readonly [Point, Point][],
  rgb: string,
  alpha: number,
  width: number,
): void {
  if (segments.length === 0) return;

  const path = new Path2D();
  for (const [from, to] of segments) {
    path.moveTo(from.x, from.y);
    path.lineTo(to.x, to.y);
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.22})`;
  ctx.lineWidth = width * 3.5;
  ctx.stroke(path);

  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.lineWidth = width;
  ctx.stroke(path);
}

function highlightLine(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  color: string,
  width: number,
): void {
  ctx.lineCap = "round";

  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = color;
  ctx.lineWidth = width * 3;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

/**
 * Esqueleto completo estilo escáner: las 33 articulaciones y sus 35 conexiones
 * en cian, con los hombros (11-12) y las caderas (23-24) resaltados para que se
 * vea qué está midiendo el juez.
 *
 * Solo pinta. No calcula ni agrega nada.
 */
function draw(
  canvas: HTMLCanvasElement,
  landmarks: NormalizedLandmarkList,
  torso: TorsoReading | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  // Los grosores se escalan con la resolución: a 480p y a 1080p debe verse igual.
  const scale = Math.max(0.6, Math.max(width, height) / 1280);

  const visible = (index: number): boolean =>
    (landmarks[index]?.visibility ?? 0) >= DRAW_MIN_VISIBILITY;

  const point = (index: number): Point => ({
    x: landmarks[index].x * width,
    y: landmarks[index].y * height,
  });

  // --- Relleno del torso: la zona que se evalúa ---------------------------
  if (torso) {
    const quad = [
      LANDMARK.LEFT_SHOULDER,
      LANDMARK.RIGHT_SHOULDER,
      LANDMARK.RIGHT_HIP,
      LANDMARK.LEFT_HIP,
    ].map(point);

    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    for (const corner of quad.slice(1)) ctx.lineTo(corner.x, corner.y);
    ctx.closePath();
    ctx.fillStyle = `rgba(${SCAN}, 0.08)`;
    ctx.fill();
  }

  // --- Conexiones, agrupadas por zona -------------------------------------
  const grouped: Record<ConnectionGroup, [Point, Point][]> = {
    face: [],
    limb: [],
    torso: [],
  };

  for (const [a, b] of poseConnections()) {
    if (!visible(a) || !visible(b)) continue;
    grouped[classifyConnection(a, b)].push([point(a), point(b)]);
  }

  for (const group of ["torso", "face", "limb"] as const) {
    const style = GROUP_STYLE[group];
    strokeGlow(ctx, grouped[group], SCAN, style.alpha, style.width * scale);
  }

  // --- Articulaciones ------------------------------------------------------
  for (let index = 0; index < landmarks.length; index += 1) {
    if (!visible(index)) continue;

    const joint = point(index);
    const radius = (index <= FACE_MAX_INDEX ? 1.8 : 3) * scale;

    ctx.beginPath();
    ctx.arc(joint.x, joint.y, radius * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${SCAN}, 0.18)`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(joint.x, joint.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${SCAN}, 0.95)`;
    ctx.fill();
  }

  // --- Lo que mide el juez, por encima de todo ----------------------------
  if (!torso) return;

  const leftShoulder = point(LANDMARK.LEFT_SHOULDER);
  const rightShoulder = point(LANDMARK.RIGHT_SHOULDER);
  const leftHip = point(LANDMARK.LEFT_HIP);
  const rightHip = point(LANDMARK.RIGHT_HIP);

  highlightLine(ctx, leftShoulder, rightShoulder, VOLT, 5 * scale);
  highlightLine(ctx, leftHip, rightHip, FLEX, 4 * scale);

  ctx.globalAlpha = 1;
  for (const [anchor, color] of [
    [leftShoulder, VOLT],
    [rightShoulder, VOLT],
    [leftHip, FLEX],
    [rightHip, FLEX],
  ] as const) {
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, 5 * scale, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, 5 * scale, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
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
  onLandmarks,
}: UsePoseDetectorArgs): UsePoseDetectorResult {
  const [status, setStatus] = useState<PoseStatus>("idle");
  const [torso, setTorso] = useState<TorsoReading | null>(null);

  const lastStateUpdate = useRef(0);

  /** Todas las lecturas válidas del duelo en curso. */
  const samplesRef = useRef<number[]>([]);
  /** Última lectura válida, por si no da tiempo a juntar muestras. */
  const lastRatioRef = useRef<number | null>(null);

  /**
   * El callback vive en un ref para que cambiar su identidad no reinicie
   * MediaPipe: recargar el modelo wasm a mitad de duelo sería catastrófico.
   */
  const onLandmarksRef = useRef(onLandmarks);
  useEffect(() => {
    onLandmarksRef.current = onLandmarks;
  }, [onLandmarks]);

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

      // Los consumidores externos reciben el fotograma tal cual, incluso vacío:
      // que no se detecte pose también es información para la FSM.
      onLandmarksRef.current?.(landmarks);

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
