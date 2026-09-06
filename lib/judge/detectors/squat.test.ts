import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  anklesVisible,
  createSquatDetector,
  frameKneeAngle,
  LEG_LANDMARKS,
  legKneeAngle,
  SQUAT_WARNING,
  stepSquat,
} from "./squat.ts";
import { INITIAL_DETECTOR_STATE, type DetectorState } from "./types.ts";
import type { PosePoint } from "../vtaper.ts";

/** Coloca una pierna con el ángulo de rodilla pedido. */
function legAt(
  degrees: number,
  {
    side = "left",
    visibility = 0.9,
    ankleVisibility = visibility,
  }: {
    side?: "left" | "right";
    visibility?: number;
    ankleVisibility?: number;
  } = {},
): PosePoint[] {
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 0,
  }));

  const { hip, knee, ankle } = LEG_LANDMARKS[side];
  const rad = (degrees * Math.PI) / 180;

  // Rodilla como vértice y cadera justo encima (vector (0,-1)). El tobillo se
  // coloca girando ese vector `degrees` grados, de modo que el ángulo
  // cadera-rodilla-tobillo sea exactamente `degrees`. Ojo: la y crece hacia
  // abajo, de ahí el signo negativo del coseno.
  points[knee] = { x: 0.5, y: 0.6, visibility };
  points[hip] = { x: 0.5, y: 0.4, visibility };
  points[ankle] = {
    x: 0.5 + 0.2 * Math.sin(rad),
    y: 0.6 - 0.2 * Math.cos(rad),
    visibility: ankleVisibility,
  };

  return points;
}

function run(angles: readonly (number | null)[]): DetectorState {
  let state: DetectorState = INITIAL_DETECTOR_STATE;

  for (const angle of angles) {
    const landmarks = angle === null ? undefined : legAt(angle);
    const step = stepSquat(state, landmarks);
    state = { phase: step.phase, reps: step.reps };
  }

  return state;
}

describe("legKneeAngle", () => {
  it("mide el ángulo cadera-rodilla-tobillo", () => {
    const angle = legKneeAngle(legAt(90), "left");

    assert.ok(angle !== null);
    assert.ok(Math.abs(angle - 90) < 1e-6, `dio ${angle}`);
  });

  it("descarta el fotograma si un punto no llega a 0.6", () => {
    assert.equal(legKneeAngle(legAt(90, { visibility: 0.5 }), "left"), null);
  });

  it("la pierna fuera de cuadro devuelve null", () => {
    assert.equal(legKneeAngle(legAt(90, { side: "left" }), "right"), null);
  });
});

describe("frameKneeAngle", () => {
  it("promedia las dos piernas visibles", () => {
    const points = legAt(80, { side: "left" });
    const right = legAt(140, { side: "right" });
    for (const index of Object.values(LEG_LANDMARKS.right)) {
      points[index] = right[index];
    }

    const angle = frameKneeAngle(points);

    assert.ok(angle !== null);
    assert.ok(Math.abs(angle - 110) < 1e-6, `dio ${angle}`);
  });

  it("con una sola pierna visible usa esa (zancadas de perfil)", () => {
    const angle = frameKneeAngle(legAt(95, { side: "left" }));

    assert.ok(angle !== null);
    assert.ok(Math.abs(angle - 95) < 1e-6);
  });
});

describe("stepSquat — fases arriba/abajo", () => {
  it("de pie arranca en reposo", () => {
    const step = stepSquat(INITIAL_DETECTOR_STATE, legAt(175));

    assert.equal(step.phase, "rest");
    assert.equal(step.reps, 0);
  });

  it("bajar por debajo de 100° pasa a 'abajo'", () => {
    const step = stepSquat(INITIAL_DETECTOR_STATE, legAt(95));

    assert.equal(step.phase, "active");
    assert.equal(step.counted, false);
  });

  it("una sentadilla completa cuenta una repetición", () => {
    const state = run([175, 90, 170]);

    assert.equal(state.reps, 1);
    assert.equal(state.phase, "rest");
  });

  it("cuenta cuatro sentadillas seguidas", () => {
    const state = run([175, 85, 170, 80, 175, 70, 165, 60, 180]);

    assert.equal(state.reps, 4);
  });

  it("una media sentadilla (120°) no cuenta", () => {
    assert.equal(run([175, 120, 175]).reps, 0);
  });

  it("estirar sin haber bajado no cuenta", () => {
    assert.equal(run([170, 175, 180]).reps, 0);
  });

  it("quedarse abajo mantiene la fase sin contar", () => {
    const state = run([175, 80, 70, 65]);

    assert.equal(state.phase, "active");
    assert.equal(state.reps, 0);
  });

  it("la banda muerta 100-160 evita conteos por temblor", () => {
    const state = run([175, 90, 110, 140, 155, 120, 105]);

    assert.equal(state.reps, 0);
    assert.equal(state.phase, "active");
  });

  it("los umbrales son exclusivos: justo dentro de la banda no dispara", () => {
    // Se prueba a un lado y otro del umbral en vez de justo encima: el valor
    // exacto depende del coma flotante y no es lo que interesa comprobar.
    assert.equal(
      stepSquat({ phase: "rest", reps: 0 }, legAt(101)).phase,
      "rest",
      "101° no debería contar como bajada",
    );
    assert.equal(
      stepSquat({ phase: "rest", reps: 0 }, legAt(99)).phase,
      "active",
    );

    assert.equal(
      stepSquat({ phase: "active", reps: 0 }, legAt(159)).reps,
      0,
      "159° no completa la repetición",
    );
    assert.equal(stepSquat({ phase: "active", reps: 0 }, legAt(161)).reps, 1);
  });
});

describe("stepSquat — avisos de encuadre", () => {
  it("sin tobillos visibles pide apuntar a las piernas", () => {
    const landmarks = legAt(120, { ankleVisibility: 0.2 });
    const step = stepSquat(INITIAL_DETECTOR_STATE, landmarks);

    assert.equal(step.warning, SQUAT_WARNING);
  });

  it("anklesVisible detecta el corte de encuadre", () => {
    assert.equal(anklesVisible(legAt(120)), true);
    assert.equal(anklesVisible(legAt(120, { ankleVisibility: 0.1 })), false);
    assert.equal(anklesVisible(undefined), false);
  });

  it("con las piernas bien encuadradas no hay aviso", () => {
    assert.equal(stepSquat(INITIAL_DETECTOR_STATE, legAt(150)).warning, null);
  });

  it("un fotograma con aviso no altera el contador", () => {
    const state = run([175, 85]);
    const step = stepSquat(state, undefined);

    assert.equal(step.reps, state.reps);
    assert.equal(step.phase, state.phase);
  });
});

describe("createSquatDetector", () => {
  it("acumula y reinicia", () => {
    const fsm = createSquatDetector();

    fsm.processFrame(legAt(175));
    fsm.processFrame(legAt(85));
    fsm.processFrame(legAt(170));

    assert.equal(fsm.snapshot().reps, 1);
    assert.equal(fsm.family, "squat");

    fsm.reset();
    assert.equal(fsm.snapshot().reps, 0);
  });
});
