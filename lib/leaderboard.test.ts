import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatScore, medalTier, normalizeEntries } from "./leaderboard.ts";

describe("formatScore", () => {
  it("rendimiento se redondea a entero", () => {
    assert.equal(formatScore(42, "performance"), "42");
    assert.equal(formatScore(42.7, "performance"), "43");
  });

  it("estética conserva dos decimales", () => {
    // Sin decimales, dos V-taper distintos se verían iguales.
    assert.equal(formatScore(1.437, "aesthetics"), "1.44");
    assert.equal(formatScore(1.4, "aesthetics"), "1.40");
  });

  it("sin puntuación muestra un guion, no 'NaN'", () => {
    assert.equal(formatScore(null, "aesthetics"), "—");
    assert.equal(formatScore(undefined, "performance"), "—");
    assert.equal(formatScore(Number.NaN, "performance"), "—");
    assert.equal(formatScore(Number.POSITIVE_INFINITY, "aesthetics"), "—");
  });

  it("un cero de rendimiento es un resultado válido, no un vacío", () => {
    assert.equal(formatScore(0, "performance"), "0");
  });
});

describe("medalTier", () => {
  it("reparte el podio", () => {
    assert.equal(medalTier(1), "gold");
    assert.equal(medalTier(2), "silver");
    assert.equal(medalTier(3), "bronze");
  });

  it("fuera del top 3 no hay medalla", () => {
    assert.equal(medalTier(4), null);
    assert.equal(medalTier(10), null);
    assert.equal(medalTier(0), null);
  });
});

describe("normalizeEntries", () => {
  it("acepta la respuesta normal de la RPC", () => {
    const entries = normalizeEntries([
      { rank: 1, username: "ElRompeGyms", score: 2.13 },
      { rank: 2, username: "Larper", score: 1.98 },
    ]);

    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0], {
      rank: 1,
      username: "ElRompeGyms",
      score: 2.13,
    });
  });

  it("convierte los numeric que llegan como cadena", () => {
    // PostgREST puede serializar numeric como string.
    const entries = normalizeEntries([
      { rank: "1", username: "Maquina", score: "148" },
    ]);

    assert.equal(entries[0].score, 148);
    assert.equal(entries[0].rank, 1);
  });

  it("descarta filas rotas en vez de pintar NaN", () => {
    const entries = normalizeEntries([
      { rank: 1, username: "Bueno", score: 1.5 },
      { rank: 2, username: "", score: 1.4 },
      { rank: 3, username: "SinScore", score: "abc" },
      { rank: 4, username: "SinRank", score: 1.2, rank_typo: 4 },
      null,
      "basura",
    ]);

    assert.equal(
      entries.length,
      2,
      "solo la primera y la de rank 4 son válidas",
    );
    assert.equal(entries[0].username, "Bueno");
  });

  it("una respuesta que no es lista devuelve vacío", () => {
    assert.deepEqual(normalizeEntries(null), []);
    assert.deepEqual(normalizeEntries(undefined), []);
    assert.deepEqual(normalizeEntries({ error: "boom" }), []);
  });

  it("recorta espacios del nombre", () => {
    const entries = normalizeEntries([
      { rank: 1, username: "  Espaciado  ", score: 1 },
    ]);

    assert.equal(entries[0].username, "Espaciado");
  });
});
