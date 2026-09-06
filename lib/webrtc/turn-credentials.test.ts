import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import {
  createTurnCredentials,
  DEFAULT_TTL_SECONDS,
} from "./turn-credentials.ts";

const SECRET = "un-secreto-compartido-con-el-turn";
const IDENTITY = "3f0f5b4e-0000-4000-8000-000000000001";
/** 2026-01-01T00:00:00Z */
const NOW = 1_767_225_600_000;

describe("createTurnCredentials", () => {
  it("incrusta la caducidad en el username", () => {
    const creds = createTurnCredentials({
      secret: SECRET,
      identity: IDENTITY,
      ttlSeconds: 600,
      now: NOW,
    });

    assert.equal(creds.expiresAt, NOW / 1000 + 600);
    assert.equal(creds.username, `${NOW / 1000 + 600}:${IDENTITY}`);
  });

  it("firma con HMAC-SHA1 en base64, como espera coturn", () => {
    const creds = createTurnCredentials({
      secret: SECRET,
      identity: IDENTITY,
      now: NOW,
    });

    const expected = createHmac("sha1", SECRET)
      .update(creds.username)
      .digest("base64");

    assert.equal(creds.credential, expected);
  });

  it("usa 10 minutos por defecto", () => {
    const creds = createTurnCredentials({
      secret: SECRET,
      identity: IDENTITY,
      now: NOW,
    });

    assert.equal(creds.expiresAt - NOW / 1000, DEFAULT_TTL_SECONDS);
  });

  it("dos usuarios distintos obtienen credenciales distintas", () => {
    const a = createTurnCredentials({
      secret: SECRET,
      identity: "usuario-a",
      now: NOW,
    });
    const b = createTurnCredentials({
      secret: SECRET,
      identity: "usuario-b",
      now: NOW,
    });

    assert.notEqual(a.username, b.username);
    assert.notEqual(a.credential, b.credential);
  });

  it("la credencial cambia al cambiar el secreto", () => {
    const args = { identity: IDENTITY, now: NOW };

    const a = createTurnCredentials({ ...args, secret: "secreto-1" });
    const b = createTurnCredentials({ ...args, secret: "secreto-2" });

    assert.equal(a.username, b.username);
    assert.notEqual(a.credential, b.credential);
  });

  it("una credencial vieja queda caducada", () => {
    const hace1Hora = NOW - 3_600_000;

    const creds = createTurnCredentials({
      secret: SECRET,
      identity: IDENTITY,
      ttlSeconds: 600,
      now: hace1Hora,
    });

    assert.ok(
      creds.expiresAt < Math.floor(NOW / 1000),
      "la caducidad debería haber quedado en el pasado",
    );
  });

  it("rechaza configuraciones inválidas", () => {
    assert.throws(() =>
      createTurnCredentials({ secret: "", identity: IDENTITY }),
    );
    assert.throws(() =>
      createTurnCredentials({ secret: SECRET, identity: "" }),
    );
    assert.throws(() =>
      createTurnCredentials({
        secret: SECRET,
        identity: IDENTITY,
        ttlSeconds: 0,
      }),
    );
  });
});
