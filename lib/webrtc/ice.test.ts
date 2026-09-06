import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildIceServers, parseTurnUrls, STUN_SERVERS } from "./ice.ts";

const FULL = {
  urls: "turn:turn.example.com:3478,turns:turn.example.com:5349",
  username: "larpfit",
  credential: "s3cr3t",
};

describe("parseTurnUrls", () => {
  it("parte por comas y recorta espacios", () => {
    assert.deepEqual(parseTurnUrls(" turn:a:3478 , turns:b:5349 "), [
      "turn:a:3478",
      "turns:b:5349",
    ]);
  });

  it("descarta entradas vacías y comas sobrantes", () => {
    assert.deepEqual(parseTurnUrls("turn:a:3478,,  ,"), ["turn:a:3478"]);
  });

  it("sin valor devuelve lista vacía", () => {
    assert.deepEqual(parseTurnUrls(undefined), []);
    assert.deepEqual(parseTurnUrls(""), []);
  });
});

describe("buildIceServers", () => {
  it("sin TURN configurado deja solo STUN", () => {
    const setup = buildIceServers({});

    assert.equal(setup.turnEnabled, false);
    assert.equal(setup.iceServers.length, 1);
    assert.deepEqual(setup.iceServers, [...STUN_SERVERS]);
  });

  it("STUN va siempre primero", () => {
    const setup = buildIceServers(FULL);

    assert.equal(setup.turnEnabled, true);
    assert.deepEqual(setup.iceServers[0], STUN_SERVERS[0]);
  });

  it("añade el TURN con sus credenciales", () => {
    const setup = buildIceServers(FULL);

    assert.deepEqual(setup.iceServers[1], {
      urls: ["turn:turn.example.com:3478", "turns:turn.example.com:5349"],
      username: "larpfit",
      credential: "s3cr3t",
    });
  });

  it("ignora el TURN si falta la credencial", () => {
    const setup = buildIceServers({ ...FULL, credential: undefined });

    assert.equal(setup.turnEnabled, false);
    assert.equal(setup.iceServers.length, 1);
  });

  it("ignora el TURN si falta el usuario", () => {
    const setup = buildIceServers({ ...FULL, username: "  " });

    assert.equal(setup.turnEnabled, false);
    assert.equal(setup.iceServers.length, 1);
  });

  it("ignora el TURN si las URLs están vacías", () => {
    const setup = buildIceServers({ ...FULL, urls: "  ,  " });

    assert.equal(setup.turnEnabled, false);
    assert.equal(setup.iceServers.length, 1);
  });

  it("no muta la constante STUN compartida", () => {
    buildIceServers(FULL);
    buildIceServers(FULL);

    assert.equal(STUN_SERVERS.length, 1);
  });
});
