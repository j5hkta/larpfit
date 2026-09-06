import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GAME_MODES,
  gameModeInfo,
  gameModeName,
  isGameMode,
} from "./game-modes.ts";

/** Los mismos valores que acepta el CHECK de 00004_game_modes.sql. */
const SQL_ALLOWED = ["aesthetics", "performance"];

describe("GAME_MODES", () => {
  it("coincide exactamente con lo que acepta el CHECK del SQL", () => {
    assert.deepEqual(
      GAME_MODES.map((mode) => mode.id).sort(),
      [...SQL_ALLOWED].sort(),
    );
  });

  it("no tiene ids repetidos", () => {
    const ids = GAME_MODES.map((mode) => mode.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("cada disciplina declara duración positiva y su métrica", () => {
    for (const mode of GAME_MODES) {
      assert.ok(mode.durationSeconds > 0, `${mode.id} sin duración`);
      assert.ok(mode.name.length > 0);
      assert.ok(mode.metric.length > 0);
    }
  });

  it("las duraciones son las acordadas", () => {
    assert.equal(gameModeInfo("aesthetics").durationSeconds, 15);
    assert.equal(gameModeInfo("performance").durationSeconds, 30);
  });
});

describe("isGameMode", () => {
  it("acepta los modos válidos", () => {
    for (const id of SQL_ALLOWED) assert.ok(isGameMode(id));
  });

  it("rechaza cualquier otra cosa", () => {
    assert.equal(isGameMode("aesthetic"), false);
    assert.equal(isGameMode("AESTHETICS"), false);
    assert.equal(isGameMode(""), false);
    assert.equal(isGameMode("'; drop table matches; --"), false);
  });
});

describe("gameModeInfo", () => {
  it("devuelve el nombre legible", () => {
    assert.equal(gameModeName("aesthetics"), "Batalla de Estética");
    assert.equal(gameModeName("performance"), "Batalla de Rendimiento");
  });
});
