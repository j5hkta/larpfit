import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyConnection,
  connectionKey,
  type ConnectionGroup,
  GROUP_STYLE,
  TORSO_PAIRS,
} from "./skeleton.ts";

/**
 * Las 35 conexiones reales de MediaPipe Pose, volcadas de
 * public/mediapipe/pose/pose.js (window.POSE_CONNECTIONS).
 */
const POSE_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [24, 26],
  [25, 27],
  [26, 28],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
  [27, 31],
  [28, 32],
];

describe("connectionKey", () => {
  it("normaliza el orden de los extremos", () => {
    assert.equal(connectionKey(24, 23), "23-24");
    assert.equal(connectionKey(23, 24), "23-24");
  });
});

describe("classifyConnection", () => {
  it("cubre las 35 conexiones reales sin dejar ninguna fuera", () => {
    const counts: Record<ConnectionGroup, number> = {
      face: 0,
      limb: 0,
      torso: 0,
    };

    for (const [a, b] of POSE_CONNECTIONS) {
      counts[classifyConnection(a, b)] += 1;
    }

    assert.equal(counts.face + counts.limb + counts.torso, 35);
    assert.equal(counts.torso, TORSO_PAIRS.size);
    // 9 conexiones de cara en el modelo de MediaPipe.
    assert.equal(counts.face, 9);
    assert.equal(counts.limb, 35 - 9 - TORSO_PAIRS.size);
  });

  it("la cara es solo cara", () => {
    assert.equal(classifyConnection(0, 1), "face");
    assert.equal(classifyConnection(9, 10), "face");
  });

  it("el tronco incluye hombros, caderas y los costados", () => {
    assert.equal(classifyConnection(11, 12), "torso");
    assert.equal(classifyConnection(23, 24), "torso");
    assert.equal(classifyConnection(11, 23), "torso");
    assert.equal(classifyConnection(24, 12), "torso");
  });

  it("brazos y piernas caen en 'limb', no en tronco ni cara", () => {
    // Hombro→codo y cadera→rodilla arrancan en un índice del tronco: no deben
    // colarse como tronco solo por eso.
    assert.equal(classifyConnection(11, 13), "limb");
    assert.equal(classifyConnection(12, 14), "limb");
    assert.equal(classifyConnection(23, 25), "limb");
    assert.equal(classifyConnection(24, 26), "limb");
    assert.equal(classifyConnection(27, 31), "limb");
  });

  it("ningún grupo queda invisible ni con grosor cero", () => {
    for (const style of Object.values(GROUP_STYLE)) {
      assert.ok(style.alpha > 0 && style.alpha <= 1);
      assert.ok(style.width > 0);
    }
  });
});
