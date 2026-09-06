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

  it("separa las URLs stun: en su propia entrada sin credenciales", () => {
    // Formato real de Metered: mezcla un stun: con los relays.
    const setup = buildIceServers({
      urls: "stun:stun.relay.metered.ca:80,turn:global.relay.metered.ca:80,turns:global.relay.metered.ca:443",
      username: "u",
      credential: "p",
    });

    assert.equal(setup.turnEnabled, true);
    assert.equal(setup.iceServers.length, 3);

    // El stun: va suelto: adjuntarle credenciales no sirve de nada.
    assert.deepEqual(setup.iceServers[1], {
      urls: ["stun:stun.relay.metered.ca:80"],
    });

    assert.deepEqual(setup.iceServers[2], {
      urls: [
        "turn:global.relay.metered.ca:80",
        "turns:global.relay.metered.ca:443",
      ],
      username: "u",
      credential: "p",
    });
  });

  it("solo con URLs stun: no considera el TURN activo", () => {
    const setup = buildIceServers({
      urls: "stun:stun.relay.metered.ca:80",
      username: "u",
      credential: "p",
    });

    assert.equal(setup.turnEnabled, false);
    assert.equal(setup.iceServers.length, 2);
  });

  it("no muta la constante STUN compartida", () => {
    buildIceServers(FULL);
    buildIceServers(FULL);

    assert.equal(STUN_SERVERS.length, 1);
  });
});
