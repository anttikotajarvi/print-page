import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SETTINGS,
  loadSettings,
  validateSettings,
} from "../src/settings.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

test("loadSettings returns defaults when settings.json is absent", async () => {
  const settings = await loadSettings(`${fixtures}/minimal`);

  expect(settings).toEqual(DEFAULT_SETTINGS);
  expect(settings).not.toBe(DEFAULT_SETTINGS);
});

test("loadSettings merges and validates configured settings", async () => {
  const settings = await loadSettings(`${fixtures}/configured`);

  expect(settings).toEqual({
    entryPoint: "dist/index.html",
    injectionMode: "window",
    useCache: false,
    waitForPrintReady: true,
    timeout: 45_000,
  });
});

test("validateSettings rejects unknown properties", () => {
  expect(
    () => validateSettings({ unexpected: true }),
  ).toThrow(/unknown property "unexpected"/u);
});

test("validateSettings rejects invalid values", () => {
  expect(
    () => validateSettings({ timeout: 0 }),
  ).toThrow(/timeout must be a positive integer/u);
  expect(
    () => validateSettings({ injectionMode: "query" }),
  ).toThrow(/injectionMode must be one of mustache, window/u);
});

test("validateSettings rejects entry points outside the printable", () => {
  expect(
    () => validateSettings({ entryPoint: "../index.html" }),
  ).toThrow(/entryPoint must name a relative path inside the printable directory/u);
  expect(
    () => validateSettings({ entryPoint: "/tmp/index.html" }),
  ).toThrow(/entryPoint must name a relative path inside the printable directory/u);
});
