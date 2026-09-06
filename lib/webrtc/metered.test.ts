import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  credentialEndpoint,
  iceServersEndpoint,
  meteredBaseUrl,
  parseMeteredCredential,
  parseMeteredIceServers,
} from "./metered.ts";

const BASE = meteredBaseUrl("https://larpfit.metered.live");

describe("meteredBaseUrl", () => {
  it("acepta una URL https y tolera la barra final", () => {
    assert.equal(
      meteredBaseUrl("https://larpfit.metered.live/").origin,
      "https://larpfit.metered.live",
    );
  });

  it("rechaza http, vacío y basura", () => {
    assert.throws(() => meteredBaseUrl("http://larpfit.metered.live"));
    assert.throws(() => meteredBaseUrl(""));
    assert.throws(() => meteredBaseUrl(undefined));
    assert.throws(() => meteredBaseUrl("larpfit.metered.live"));
  });
});

describe("endpoints", () => {
  it("POST de creación lleva la secretKey", () => {
    const url = credentialEndpoint(BASE, "s3cr3t");

    assert.equal(url.pathname, "/api/v1/turn/credential");
    assert.equal(url.searchParams.get("secretKey"), "s3cr3t");
  });

  it("GET de servidores ICE lleva el apiKey de la credencial, no el secreto", () => {
    const url = iceServersEndpoint(BASE, "clave-de-la-credencial");

    assert.equal(url.pathname, "/api/v1/turn/credentials");
    assert.equal(url.searchParams.get("apiKey"), "clave-de-la-credencial");
    assert.equal(url.searchParams.get("secretKey"), null);
  });

  it("no arrastra la ruta si la base trae uno", () => {
    const base = meteredBaseUrl("https://larpfit.metered.live/algo/raro");

    assert.equal(
      credentialEndpoint(base, "x").pathname,
      "/api/v1/turn/credential",
    );
  });
});

describe("parseMeteredCredential", () => {
  const OK = {
    username: "5e7dbfbe19c6c158515907a6",
    password: "wQX5Ze0EExayWJk9",
    expiryInSeconds: 14400,
    label: "user-1",
    apiKey: "56c193debb416385ade8d9a77e277ea33c0f",
  };

  it("renombra password a lo que espera WebRTC", () => {
    const creds = parseMeteredCredential(OK);

    assert.equal(creds.username, OK.username);
    assert.equal(creds.password, OK.password);
    assert.equal(creds.apiKey, OK.apiKey);
    assert.equal(creds.expiryInSeconds, 14400);
  });

  it("tolera que falte el apiKey o la caducidad", () => {
    const creds = parseMeteredCredential({
      username: "u",
      password: "p",
    });

    assert.equal(creds.apiKey, null);
    assert.equal(creds.expiryInSeconds, null);
  });

  it("revienta si falta username o password", () => {
    assert.throws(() => parseMeteredCredential({ ...OK, password: "" }));
    assert.throws(() => parseMeteredCredential({ ...OK, username: undefined }));
    assert.throws(() => parseMeteredCredential({ ...OK, password: 12345 }));
  });

  it("revienta con respuestas que no son objetos", () => {
    assert.throws(() => parseMeteredCredential(null));
    assert.throws(() => parseMeteredCredential("error del servidor"));
    assert.throws(() => parseMeteredCredential([]));
  });
});

describe("parseMeteredIceServers", () => {
  const RESPONSE = [
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "u",
      credential: "p",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "u",
      credential: "p",
    },
  ];

  it("acepta el array documentado", () => {
    const servers = parseMeteredIceServers(RESPONSE);

    assert.equal(servers.length, 3);
    assert.deepEqual(servers[0], { urls: "stun:stun.relay.metered.ca:80" });
    assert.deepEqual(servers[1], RESPONSE[1]);
  });

  it("descarta entradas rotas sin tumbar el resto", () => {
    const servers = parseMeteredIceServers([
      ...RESPONSE,
      { username: "sin-urls" },
      null,
      "basura",
    ]);

    assert.equal(servers.length, 3);
  });

  it("revienta si no es un array o si queda vacío", () => {
    assert.throws(() => parseMeteredIceServers({ data: [] }));
    assert.throws(() => parseMeteredIceServers([]));
    assert.throws(() => parseMeteredIceServers([{ username: "u" }]));
  });
});
