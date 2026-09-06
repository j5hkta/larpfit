import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateAngle, type Point2D } from "./angles.ts";

const at = (x: number, y: number): Point2D => ({ x, y });

/** Compara en grados con tolerancia, para no pelearse con el coma flotante. */
function assertDegrees(
  actual: number | null,
  expected: number,
  tolerance = 1e-6,
): void {
  assert.ok(actual !== null, "se esperaba un ángulo, llegó null");
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `se esperaba ${expected}°, llegó ${actual}°`,
  );
}

describe("calculateAngle — ángulos rectos", () => {
  it("mide 90° con los ejes", () => {
    // a arriba, vértice en el origen, c a la derecha.
    assertDegrees(calculateAngle(at(0, 1), at(0, 0), at(1, 0)), 90);
  });

  it("da 90° independientemente del orden de los extremos", () => {
    const directo = calculateAngle(at(0, 1), at(0, 0), at(1, 0));
    const invertido = calculateAngle(at(1, 0), at(0, 0), at(0, 1));

    assert.equal(directo, invertido);
  });

  it("da 90° con el vértice desplazado del origen", () => {
    assertDegrees(calculateAngle(at(5, 8), at(5, 5), at(9, 5)), 90);
  });
});

describe("calculateAngle — ángulos llanos", () => {
  it("mide 180° con los tres puntos alineados y el vértice en medio", () => {
    assertDegrees(calculateAngle(at(-1, 0), at(0, 0), at(1, 0)), 180);
  });

  it("mide 180° en una diagonal", () => {
    assertDegrees(calculateAngle(at(0, 0), at(2, 2), at(4, 4)), 180);
  });

  it("mide 0° cuando ambos segmentos van al mismo lado", () => {
    assertDegrees(calculateAngle(at(1, 0), at(0, 0), at(2, 0)), 0);
  });
});

describe("calculateAngle — ángulos agudos y obtusos", () => {
  it("mide 45°", () => {
    assertDegrees(calculateAngle(at(1, 1), at(0, 0), at(1, 0)), 45);
  });

  it("mide 135°", () => {
    assertDegrees(calculateAngle(at(-1, 1), at(0, 0), at(1, 0)), 135);
  });

  it("mide 60° en un triángulo equilátero", () => {
    assertDegrees(
      calculateAngle(at(1, 0), at(0, 0), at(0.5, Math.sqrt(3) / 2)),
      60,
      1e-9,
    );
  });

  it("nunca devuelve más de 180 ni menos de 0", () => {
    for (let deg = 0; deg < 360; deg += 7) {
      const rad = (deg * Math.PI) / 180;
      const angle = calculateAngle(
        at(1, 0),
        at(0, 0),
        at(Math.cos(rad), Math.sin(rad)),
      );

      assert.ok(angle !== null);
      assert.ok(angle >= 0 && angle <= 180, `${deg}° dio ${angle}`);
    }
  });
});

describe("calculateAngle — casos degenerados", () => {
  it("devuelve null si un extremo coincide con el vértice", () => {
    assert.equal(calculateAngle(at(0, 0), at(0, 0), at(1, 0)), null);
    assert.equal(calculateAngle(at(1, 0), at(0, 0), at(0, 0)), null);
  });

  it("devuelve null si los tres puntos son el mismo", () => {
    assert.equal(calculateAngle(at(2, 2), at(2, 2), at(2, 2)), null);
  });

  it("un brazo real estirado ronda los 180°, no cero", () => {
    // Hombro, codo y muñeca casi alineados, en coordenadas normalizadas.
    const angle = calculateAngle(at(0.4, 0.5), at(0.55, 0.5), at(0.7, 0.502));

    assert.ok(angle !== null);
    assert.ok(angle > 170, `brazo estirado dio ${angle}°`);
  });
});
