import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BLOOP, bloopSchedule } from "./audio.ts";

describe("BLOOP", () => {
  it("ninguna ganancia es cero", () => {
    // exponentialRampToValueAtTime lanza si el destino es 0: la rampa
    // exponencial nunca alcanza el cero. Es el error clásico de Web Audio.
    assert.ok(BLOOP.floorGain > 0, "floorGain debe ser estrictamente positivo");
    assert.ok(BLOOP.peakGain > 0);
  });

  it("el pico no satura ni revienta los oídos", () => {
    assert.ok(
      BLOOP.peakGain <= 0.5,
      `ganancia demasiado alta: ${BLOOP.peakGain}`,
    );
    assert.ok(BLOOP.peakGain > BLOOP.floorGain);
  });

  it("el tono sube, como pide un 'bloop'", () => {
    assert.ok(BLOOP.endFrequency > BLOOP.startFrequency);
    assert.ok(
      BLOOP.startFrequency > 0,
      "una rampa exponencial de tono desde 0 falla",
    );
  });

  it("dura entre 100 y 200 ms", () => {
    assert.ok(BLOOP.durationSeconds >= 0.1);
    assert.ok(BLOOP.durationSeconds <= 0.2);
  });
});

describe("bloopSchedule", () => {
  it("los tiempos van en orden estrictamente creciente", () => {
    const time = bloopSchedule(10);

    assert.ok(time.start < time.attackEnd, "ataque antes que el inicio");
    assert.ok(
      time.attackEnd < time.pitchEnd,
      "el ataque debe acabar antes del tono",
    );
    assert.ok(
      time.pitchEnd < time.releaseEnd,
      "el tono debe acabar antes del final",
    );
  });

  it("es relativo al reloj del AudioContext, no absoluto", () => {
    const a = bloopSchedule(0);
    const b = bloopSchedule(1234.5);

    // Restas en coma flotante: se compara con tolerancia, no con igualdad.
    assert.ok(
      Math.abs(b.releaseEnd - b.start - (a.releaseEnd - a.start)) < 1e-9,
      "la duración debe ser la misma arranque donde arranque",
    );
    assert.equal(b.start, 1234.5);
  });

  it("aguanta el reloj de una sesión larga sin perder precisión", () => {
    // currentTime crece indefinidamente mientras el contexto viva.
    const time = bloopSchedule(36_000);

    assert.ok(time.releaseEnd > time.start);
    assert.ok(
      Math.abs(time.releaseEnd - time.start - BLOOP.durationSeconds) < 1e-9,
    );
  });
});
