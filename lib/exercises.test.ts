import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  DRAFT_SIZE,
  EXERCISES,
  exerciseDuration,
  exercisesByTier,
  findExercise,
  tierDuration,
  tierLabel,
} from "./exercises.ts";

/**
 * El catálogo vive en dos sitios: aquí (nombres, duraciones) y en
 * exercise_catalog() de 00006_drafting_phase.sql (qué ids existen). Si se
 * desincronizan, el servidor repartiría cartas que el cliente no sabe pintar.
 * Este test lee el SQL de verdad y compara.
 */
function idsFromMigration(tier: "normal" | "hard"): string[] {
  const sql = readFileSync(
    new URL("../supabase/migrations/00006_drafting_phase.sql", import.meta.url),
    "utf8",
  );

  const marker = tier === "hard" ? "when 'hard' then array[" : "else array[";
  const start = sql.indexOf(marker);
  assert.ok(start !== -1, `no encontré el array de '${tier}' en la migración`);

  const open = sql.indexOf("[", start);
  const close = sql.indexOf("]", open);
  const body = sql.slice(open + 1, close);

  return body
    .split(",")
    .map((entry) => entry.trim().replace(/^'|'$/g, ""))
    .filter((entry) => entry.length > 0);
}

describe("catálogo de ejercicios", () => {
  it("no tiene ids repetidos", () => {
    const ids = EXERCISES.map((exercise) => exercise.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("hay cartas de sobra para repartir en ambos niveles", () => {
    for (const tier of ["normal", "hard"] as const) {
      assert.ok(
        exercisesByTier(tier).length >= DRAFT_SIZE,
        `'${tier}' necesita al menos ${DRAFT_SIZE} ejercicios`,
      );
    }
  });

  it("cada ejercicio tiene nombre, descripción y duración positiva", () => {
    for (const exercise of EXERCISES) {
      assert.ok(exercise.name.length > 0, `${exercise.id} sin nombre`);
      assert.ok(
        exercise.description.length > 0,
        `${exercise.id} sin descripción`,
      );
      assert.ok(exercise.durationSeconds > 0, `${exercise.id} sin duración`);
    }
  });

  it("normal dura 30 s y difícil 60 s", () => {
    for (const exercise of exercisesByTier("normal")) {
      assert.equal(exercise.durationSeconds, 30, `${exercise.id}`);
    }
    for (const exercise of exercisesByTier("hard")) {
      assert.equal(exercise.durationSeconds, 60, `${exercise.id}`);
    }
  });
});

describe("sincronía con 00006_drafting_phase.sql", () => {
  it("los ids de 'normal' coinciden con exercise_catalog()", () => {
    assert.deepEqual(
      exercisesByTier("normal")
        .map((exercise) => exercise.id)
        .sort(),
      idsFromMigration("normal").sort(),
    );
  });

  it("los ids de 'hard' coinciden con exercise_catalog()", () => {
    assert.deepEqual(
      exercisesByTier("hard")
        .map((exercise) => exercise.id)
        .sort(),
      idsFromMigration("hard").sort(),
    );
  });

  it("ningún id se repite entre niveles", () => {
    const normal = new Set(idsFromMigration("normal"));
    for (const id of idsFromMigration("hard")) {
      assert.ok(!normal.has(id), `'${id}' está en los dos niveles`);
    }
  });
});

describe("findExercise / exerciseDuration", () => {
  it("encuentra un ejercicio conocido", () => {
    assert.equal(findExercise("burpees")?.tier, "hard");
  });

  it("devuelve null con id desconocido, nulo o vacío", () => {
    assert.equal(findExercise("no_existe"), null);
    assert.equal(findExercise(null), null);
    assert.equal(findExercise(undefined), null);
  });

  it("un id que el cliente no conoce cae a la duración del nivel", () => {
    // La base de datos puede ir por delante del cliente tras un despliegue.
    assert.equal(exerciseDuration("ejercicio_del_futuro", "hard"), 60);
    assert.equal(exerciseDuration(null, "normal"), 30);
  });

  it("un ejercicio conocido manda sobre el nivel", () => {
    assert.equal(exerciseDuration("pushups", "hard"), 30);
  });
});

describe("etiquetas de nivel", () => {
  it("traduce el nivel", () => {
    assert.equal(tierLabel("normal"), "Normal");
    assert.equal(tierLabel("hard"), "Difícil");
  });

  it("la duración del nivel concuerda con la de sus ejercicios", () => {
    for (const tier of ["normal", "hard"] as const) {
      for (const exercise of exercisesByTier(tier)) {
        assert.equal(exercise.durationSeconds, tierDuration(tier));
      }
    }
  });
});
