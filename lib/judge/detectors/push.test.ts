import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARM_LANDMARKS,
  armElbowAngle,
  createPushDetector,
  frameElbowAngle,
  stepPush,
} from "./push.ts";
import { INITIAL_DETECTOR_STATE, type DetectorState } from "./types.ts";
import type { PosePoint } from "../vtaper.ts";

/** Construye 33 landmarks y coloca un brazo con el ángulo de codo pedido. */
function armAt(
  degrees: number,
  {
    side = "left",
    visibility = 0.9,
  }: { side?: "left" | "right"; visibility?: number } = {},
): PosePoint[] {
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 0,
  }));

  const { shoulder, elbow, wrist } = ARM_LANDMARKS[side];
  const rad = (degrees * Math.PI) / 180;

  points[elbow] = { x: 0.5, y: 0.5, visibility };
  points[shoulder] = { x: 0.7, y: 0.5, visibility };
  points[wrist] = {
    x: 0.5 + 0.2 * Math.cos(rad),
    y: 0.5 + 0.2 * Math.sin(rad),
    visibility,
  };

  return points;
}

/** Reproduce una secuencia de ángulos y devuelve el estado final. */
function run(angles: readonly (number | null)[]): DetectorState {
  let state: DetectorState = INITIAL_DETECTOR_STATE;

  for (const angle of angles) {
    const landmarks = angle === null ? undefined : armAt(angle);
    const step = stepPush(state, landmarks);
    state = { phase: step.phase, reps: step.reps };
  }

  return state;
}

describe("armElbowAngle", () => {
  it("mide el ángulo del codo cuando los tres puntos son fiables", () => {
    const angle = armElbowAngle(armAt(90), "left");

    assert.ok(angle !== null);
    assert.ok(Math.abs(angle - 90) < 1e-6);
  });

  it("descarta el fotograma si algún punto baja de 0.6 de visibilidad", () => {
    assert.equal(armElbowAngle(armAt(90, { visibility: 0.59 }), "left"), null);
  });

  it("acepta justo el umbral de 0.6", () => {
    assert.notEqual(
      armElbowAngle(armAt(90, { visibility: 0.6 }), "left"),
      null,
    );
  });

  it("el brazo que no está en cuadro devuelve null", () => {
    assert.equal(armElbowAngle(armAt(90, { side: "left" }), "right"), null);
  });

  it("sin landmarks devuelve null", () => {
    assert.equal(armElbowAngle(undefined, "left"), null);
    assert.equal(armElbowAngle([], "left"), null);
  });
});

describe("frameElbowAngle", () => {
  it("promedia los dos brazos cuando ambos se ven", () => {
    const points = armAt(60, { side: "left" });
    const right = armAt(120, { side: "right" });
    for (const index of Object.values(ARM_LANDMARKS.right)) {
      points[index] = right[index];
    }

    const angle = frameElbowAngle(points);

    assert.ok(angle !== null);
    assert.ok(Math.abs(angle - 90) < 1e-6, `promedio dio ${angle}`);
  });

  it("usa el único brazo fiable si el otro no se ve", () => {
    const angle = frameElbowAngle(armAt(75, { side: "left" }));

    assert.ok(angle !== null);
    assert.ok(Math.abs(angle - 75) < 1e-6);
  });

  it("sin ningún brazo fiable devuelve null", () => {
    assert.equal(frameElbowAngle(armAt(90, { visibility: 0.2 })), null);
  });
});

describe("stepPush", () => {
  it("arranca en reposo y sin repeticiones", () => {
    assert.deepEqual(INITIAL_DETECTOR_STATE, { phase: "rest", reps: 0 });
  });

  it("bajar de 90° pasa a 'active' sin contar todavía", () => {
    const step = stepPush(INITIAL_DETECTOR_STATE, armAt(85));

    assert.equal(step.phase, "active");
    assert.equal(step.reps, 0);
    assert.equal(step.counted, false);
  });

  it("una flexión completa cuenta exactamente una repetición", () => {
    const state = run([170, 85, 170]);

    assert.equal(state.reps, 1);
    assert.equal(state.phase, "rest");
  });

  it("cuenta tres flexiones seguidas", () => {
    const state = run([175, 80, 175, 70, 165, 60, 170]);

    assert.equal(state.reps, 3);
  });

  it("estirar el brazo sin haber bajado NO cuenta", () => {
    const state = run([170, 175, 180, 165]);

    assert.equal(state.reps, 0);
    assert.equal(state.phase, "rest");
  });

  it("bajar y quedarse abajo no cuenta hasta subir", () => {
    const state = run([170, 80, 60, 45, 70]);

    assert.equal(state.reps, 0);
    assert.equal(state.phase, "active");
  });

  it("una bajada a medias (110°) no activa la fase", () => {
    assert.equal(run([170, 110, 175]).reps, 0);
  });

  it("la banda muerta 90-160 evita repeticiones por temblor", () => {
    const state = run([170, 85, 95, 120, 155, 120, 95, 155]);

    assert.equal(state.reps, 0);
    assert.equal(state.phase, "active");
  });

  it("los fotogramas descartados no alteran el estado", () => {
    const state = run([170, 85, null, null, 170]);

    assert.equal(state.reps, 1);
    assert.equal(state.phase, "rest");
  });

  it("un hueco de visibilidad no rompe una repetición en curso", () => {
    assert.equal(run([175, null, 80, null, null, 168]).reps, 1);
  });

  it("los umbrales son exclusivos: justo dentro de la banda no dispara", () => {
    // A un lado y otro del umbral: el valor exacto depende del coma flotante.
    assert.equal(stepPush({ phase: "rest", reps: 0 }, armAt(91)).phase, "rest");
    assert.equal(
      stepPush({ phase: "rest", reps: 0 }, armAt(89)).phase,
      "active",
    );

    assert.equal(stepPush({ phase: "active", reps: 0 }, armAt(159)).reps, 0);
    assert.equal(stepPush({ phase: "active", reps: 0 }, armAt(161)).reps, 1);
  });

  it("avisa del encuadre cuando no ve los brazos", () => {
    const step = stepPush(INITIAL_DETECTOR_STATE, undefined);

    assert.ok(step.warning, "debería avisar del encuadre");
  });

  it("sin aviso cuando el brazo se ve bien", () => {
    assert.equal(stepPush(INITIAL_DETECTOR_STATE, armAt(120)).warning, null);
  });
});

describe("createPushDetector", () => {
  it("acumula estado entre fotogramas y se reinicia", () => {
    const fsm = createPushDetector();

    fsm.processFrame(armAt(175));
    fsm.processFrame(armAt(80));
    fsm.processFrame(armAt(170));

    assert.equal(fsm.snapshot().reps, 1);

    fsm.reset();
    assert.deepEqual(fsm.snapshot(), INITIAL_DETECTOR_STATE);
  });

  it("expone etiquetas legibles de sus fases", () => {
    const fsm = createPushDetector();

    assert.equal(fsm.family, "push");
    assert.ok(fsm.labels.rest.length > 0);
    assert.ok(fsm.labels.active.length > 0);
  });
});
