import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyPosture,
  createJumpingJackDetector,
  JACK_LANDMARKS,
  JACK_WARNING,
  stepJumpingJack,
} from "./jumping-jack.ts";
import { INITIAL_DETECTOR_STATE, type DetectorState } from "./types.ts";
import type { PosePoint } from "../vtaper.ts";

/**
 * Construye una postura de jumping jack.
 *
 * Recordatorio del eje Y: en coordenadas de imagen crece hacia ABAJO, así que
 * una muñeca "arriba" tiene una `y` MENOR que la del hombro.
 */
function posture({
  wristsUp,
  ankleSpread,
  visibility = 0.9,
}: {
  wristsUp: boolean;
  /** Separación de tobillos en unidades normalizadas. Hombros miden 0.2. */
  ankleSpread: number;
  visibility?: number;
}): PosePoint[] {
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 0,
  }));

  const shoulderY = 0.4;
  const wristY = wristsUp ? 0.15 : 0.65;

  points[JACK_LANDMARKS.leftShoulder] = { x: 0.4, y: shoulderY, visibility };
  points[JACK_LANDMARKS.rightShoulder] = { x: 0.6, y: shoulderY, visibility };
  points[JACK_LANDMARKS.leftWrist] = { x: 0.35, y: wristY, visibility };
  points[JACK_LANDMARKS.rightWrist] = { x: 0.65, y: wristY, visibility };
  points[JACK_LANDMARKS.leftAnkle] = {
    x: 0.5 - ankleSpread / 2,
    y: 0.95,
    visibility,
  };
  points[JACK_LANDMARKS.rightAnkle] = {
    x: 0.5 + ankleSpread / 2,
    y: 0.95,
    visibility,
  };

  return points;
}

/** Hombros = 0.2 de ancho. Abierto exige >0.22; cerrado, <0.18. */
const OPEN = posture({ wristsUp: true, ankleSpread: 0.4 });
const CLOSED = posture({ wristsUp: false, ankleSpread: 0.05 });

function run(frames: readonly (PosePoint[] | undefined)[]): DetectorState {
  let state: DetectorState = INITIAL_DETECTOR_STATE;

  for (const landmarks of frames) {
    const step = stepJumpingJack(state, landmarks);
    state = { phase: step.phase, reps: step.reps };
  }

  return state;
}

describe("classifyPosture", () => {
  it("brazos arriba y piernas abiertas es 'abierto'", () => {
    assert.equal(classifyPosture(OPEN), "open");
  });

  it("brazos abajo y pies juntos es 'cerrado'", () => {
    assert.equal(classifyPosture(CLOSED), "closed");
  });

  it("brazos arriba pero pies juntos no es ninguna de las dos", () => {
    const half = posture({ wristsUp: true, ankleSpread: 0.05 });
    assert.equal(classifyPosture(half), "between");
  });

  it("piernas abiertas pero brazos abajo tampoco cierra el ciclo", () => {
    const half = posture({ wristsUp: false, ankleSpread: 0.4 });
    assert.equal(classifyPosture(half), "between");
  });

  it("la banda de histéresis deja un hueco entre abierto y cerrado", () => {
    // Tobillos justo al ancho de hombros: ni abierto ni cerrado.
    const middle = posture({ wristsUp: true, ankleSpread: 0.2 });
    assert.equal(classifyPosture(middle), "between");
  });

  it("sin cuerpo entero visible devuelve null", () => {
    assert.equal(
      classifyPosture(
        posture({ wristsUp: true, ankleSpread: 0.4, visibility: 0.3 }),
      ),
      null,
    );
    assert.equal(classifyPosture(undefined), null);
    assert.equal(classifyPosture([]), null);
  });
});

describe("stepJumpingJack — fases abierto/cerrado", () => {
  it("arranca cerrado y sin repeticiones", () => {
    const step = stepJumpingJack(INITIAL_DETECTOR_STATE, CLOSED);

    assert.equal(step.phase, "rest");
    assert.equal(step.reps, 0);
  });

  it("abrirse pasa a la fase activa sin contar todavía", () => {
    const step = stepJumpingJack(INITIAL_DETECTOR_STATE, OPEN);

    assert.equal(step.phase, "active");
    assert.equal(step.reps, 0);
    assert.equal(step.counted, false);
  });

  it("un ciclo abrir-cerrar cuenta una repetición", () => {
    const state = run([CLOSED, OPEN, CLOSED]);

    assert.equal(state.reps, 1);
    assert.equal(state.phase, "rest");
  });

  it("cuenta tres jumping jacks seguidos", () => {
    const state = run([CLOSED, OPEN, CLOSED, OPEN, CLOSED, OPEN, CLOSED]);

    assert.equal(state.reps, 3);
  });

  it("quedarse abierto no cuenta hasta cerrar", () => {
    const state = run([CLOSED, OPEN, OPEN, OPEN]);

    assert.equal(state.reps, 0);
    assert.equal(state.phase, "active");
  });

  it("quedarse quieto y cerrado no genera repeticiones", () => {
    assert.equal(run([CLOSED, CLOSED, CLOSED]).reps, 0);
  });

  it("un movimiento a medias no cuenta", () => {
    const half = posture({ wristsUp: true, ankleSpread: 0.05 });
    assert.equal(run([CLOSED, half, CLOSED]).reps, 0);
  });

  it("los fotogramas sin encuadre no rompen el ciclo", () => {
    const state = run([CLOSED, OPEN, undefined, undefined, CLOSED]);

    assert.equal(state.reps, 1);
  });

  it("avisa del encuadre cuando no ve el cuerpo entero", () => {
    const step = stepJumpingJack(INITIAL_DETECTOR_STATE, undefined);

    assert.equal(step.warning, JACK_WARNING);
  });
});

describe("createJumpingJackDetector", () => {
  it("acumula, etiqueta sus fases y se reinicia", () => {
    const fsm = createJumpingJackDetector();

    fsm.processFrame(CLOSED);
    fsm.processFrame(OPEN);
    fsm.processFrame(CLOSED);

    assert.equal(fsm.snapshot().reps, 1);
    assert.equal(fsm.family, "jumping-jack");
    assert.equal(fsm.labels.active, "Abierto");
    assert.equal(fsm.labels.rest, "Cerrado");

    fsm.reset();
    assert.equal(fsm.snapshot().reps, 0);
  });
});
