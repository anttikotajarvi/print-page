import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEFAULT_SETTINGS,
  loadSettings,
  validateSettings,
} from "../src/settings.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

test("loadSettings returns defaults when settings.json is absent", async () => {
  const settings = await loadSettings(`${fixtures}/minimal`);

  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.notStrictEqual(settings, DEFAULT_SETTINGS);
});

test("loadSettings merges and validates configured settings", async () => {
  const settings = await loadSettings(`${fixtures}/configured`);

  assert.deepEqual(settings, {
    entryPoint: "dist/index.html",
    injectionMode: "window",
    useCache: false,
    waitForPrintReady: true,
    timeout: 45_000,
  });
});

test("validateSettings rejects unknown properties", () => {
  assert.throws(
    () => validateSettings({ unexpected: true }),
    /unknown property "unexpected"/u,
  );
});

test("validateSettings rejects invalid values", () => {
  assert.throws(
    () => validateSettings({ timeout: 0 }),
    /timeout must be a positive integer/u,
  );
  assert.throws(
    () => validateSettings({ injectionMode: "query" }),
    /injectionMode must be one of mustache, window/u,
  );
});

test("validateSettings rejects entry points outside the printable", () => {
  assert.throws(
    () => validateSettings({ entryPoint: "../index.html" }),
    /entryPoint must name a relative path inside the printable directory/u,
  );
  assert.throws(
    () => validateSettings({ entryPoint: "/tmp/index.html" }),
    /entryPoint must name a relative path inside the printable directory/u,
  );
});
