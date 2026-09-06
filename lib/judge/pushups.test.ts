import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ARM_LANDMARKS,
  armElbowAngle,
  frameElbowAngle,
  INITIAL_PUSHUP_STATE,
  type PushupState,
  stepPushupFsm,
} from "./pushups.ts";
import type { PosePoint } from "./vtaper.ts";

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

  // Codo en el origen, hombro a la derecha, muñeca girada `degrees`.
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
function run(angles: readonly (number | null)[]): PushupState {
  let state: PushupState = INITIAL_PUSHUP_STATE;
  for (const angle of angles) state = stepPushupFsm(state, angle);
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

describe("stepPushupFsm", () => {
  it("arranca arriba y sin repeticiones", () => {
    assert.deepEqual(INITIAL_PUSHUP_STATE, { phase: "up", reps: 0 });
  });

  it("bajar de 90° pasa a 'down' sin contar todavía", () => {
    const step = stepPushupFsm(INITIAL_PUSHUP_STATE, 85);

    assert.equal(step.phase, "down");
    assert.equal(step.reps, 0);
    assert.equal(step.counted, false);
  });

  it("una plancha completa cuenta exactamente una repetición", () => {
    const state = run([170, 85, 170]);

    assert.equal(state.reps, 1);
    assert.equal(state.phase, "up");
  });

  it("cuenta tres planchas seguidas", () => {
    const state = run([175, 80, 175, 70, 165, 60, 170]);

    assert.equal(state.reps, 3);
  });

  it("estirar el brazo sin haber bajado NO cuenta", () => {
    const state = run([170, 175, 180, 165]);

    assert.equal(state.reps, 0);
    assert.equal(state.phase, "up");
  });

  it("bajar y quedarse abajo no cuenta hasta subir", () => {
    const state = run([170, 80, 60, 45, 70]);

    assert.equal(state.reps, 0);
    assert.equal(state.phase, "down");
  });

  it("una bajada a medias (110°) no activa la fase 'down'", () => {
    const state = run([170, 110, 175]);

    assert.equal(state.reps, 0);
  });

  it("la banda muerta 90-160 evita repeticiones por temblor", () => {
    // Oscilar dentro de la zona muerta no debe generar nada.
    const state = run([170, 85, 95, 120, 155, 120, 95, 155]);

    assert.equal(state.reps, 0);
    assert.equal(state.phase, "down");
  });

  it("los fotogramas descartados (null) no alteran el estado", () => {
    const state = run([170, 85, null, null, 170]);

    assert.equal(state.reps, 1);
    assert.equal(state.phase, "up");
  });

  it("un hueco de visibilidad no rompe una repetición en curso", () => {
    const state = run([175, null, 80, null, null, 168]);

    assert.equal(state.reps, 1);
  });

  it("los umbrales son estrictos: 90 y 160 exactos no disparan", () => {
    assert.equal(stepPushupFsm({ phase: "up", reps: 0 }, 90).phase, "up");
    assert.equal(
      stepPushupFsm({ phase: "down", reps: 0 }, 160).reps,
      0,
      "160° exacto no debería contar",
    );
  });
});
