/**
 * Pruebas de la lógica del juez. Sin framework: `node --test lib/judge/vtaper.test.ts`
 * (Node 22+ ejecuta TypeScript directamente).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregateScore,
  isPlausibleRatio,
  LANDMARK,
  measureTorso,
  median,
  type PosePoint,
} from "./vtaper.ts";

/** Construye un juego de landmarks con los cuatro puntos del torso. */
function torso({
  shoulders,
  hips,
  visibility = 0.9,
}: {
  shoulders: [number, number];
  hips: [number, number];
  visibility?: number;
}): PosePoint[] {
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 0.9,
  }));

  points[LANDMARK.LEFT_SHOULDER] = { x: shoulders[0], y: 0.3, visibility };
  points[LANDMARK.RIGHT_SHOULDER] = { x: shoulders[1], y: 0.3, visibility };
  points[LANDMARK.LEFT_HIP] = { x: hips[0], y: 0.7, visibility };
  points[LANDMARK.RIGHT_HIP] = { x: hips[1], y: 0.7, visibility };

  return points;
}

describe("measureTorso", () => {
  it("calcula hombros / cintura", () => {
    // Hombros 0.4 de ancho, caderas 0.2 → V-taper 2.0
    const reading = measureTorso(
      torso({ shoulders: [0.7, 0.3], hips: [0.6, 0.4] }),
    );

    assert.ok(reading);
    assert.equal(Number(reading.shoulderWidth.toFixed(3)), 0.4);
    assert.equal(Number(reading.waistWidth.toFixed(3)), 0.2);
    assert.equal(Number(reading.ratio.toFixed(3)), 2);
  });

  it("no depende del orden izquierda/derecha", () => {
    const a = measureTorso(torso({ shoulders: [0.7, 0.3], hips: [0.6, 0.4] }));
    const b = measureTorso(torso({ shoulders: [0.3, 0.7], hips: [0.4, 0.6] }));

    assert.equal(a?.ratio, b?.ratio);
  });

  it("descarta la lectura si algún punto no es fiable", () => {
    const reading = measureTorso(
      torso({ shoulders: [0.7, 0.3], hips: [0.6, 0.4], visibility: 0.2 }),
    );

    assert.equal(reading, null);
  });

  it("descarta caderas pegadas en vez de dividir por ~cero", () => {
    const reading = measureTorso(
      torso({ shoulders: [0.7, 0.3], hips: [0.5, 0.5] }),
    );

    assert.equal(reading, null);
  });

  it("devuelve null sin landmarks", () => {
    assert.equal(measureTorso(undefined), null);
    assert.equal(measureTorso([]), null);
  });
});

describe("isPlausibleRatio", () => {
  it("acepta el rango humano", () => {
    assert.ok(isPlausibleRatio(1.0));
    assert.ok(isPlausibleRatio(1.45));
    assert.ok(isPlausibleRatio(2.5));
  });

  it("rechaza basura", () => {
    assert.equal(isPlausibleRatio(0.2), false);
    assert.equal(isPlausibleRatio(12), false);
    assert.equal(isPlausibleRatio(Number.POSITIVE_INFINITY), false);
    assert.equal(isPlausibleRatio(Number.NaN), false);
  });
});

describe("median", () => {
  it("con número impar de muestras", () => {
    assert.equal(median([3, 1, 2]), 2);
  });

  it("con número par promedia las centrales", () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  it("ignora el orden de entrada y no muta el array", () => {
    const input = [5, 1, 4, 2, 3];
    assert.equal(median(input), 3);
    assert.deepEqual(input, [5, 1, 4, 2, 3]);
  });

  it("sin muestras devuelve null", () => {
    assert.equal(median([]), null);
  });
});

describe("aggregateScore", () => {
  it("un frame afortunado no decide el duelo", () => {
    // Nueve lecturas de ~1.4 y un pico absurdo de 2.9.
    const samples = [1.4, 1.41, 1.39, 1.4, 1.42, 1.38, 1.4, 1.41, 1.39, 2.9];

    const score = aggregateScore(samples, 2.9);

    assert.ok(score !== null);
    assert.ok(score < 1.5, `la mediana debería ignorar el pico, dio ${score}`);
  });

  it("con muy pocas muestras cae en la última lectura válida", () => {
    assert.equal(aggregateScore([1.3, 1.4], 1.4), 1.4);
  });

  it("sin detección devuelve null", () => {
    assert.equal(aggregateScore([], null), null);
  });
});
