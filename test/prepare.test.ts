import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { prepareInput } from "../src/prepare.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

test("prepareInput returns input unchanged when prepare.js is absent", async () => {
  const input = { name: "Ada" };

  assert.strictEqual(await prepareInput(`${fixtures}/minimal`, input), input);
});

test("prepareInput runs an asynchronous default export", async () => {
  const prepared = await prepareInput(`${fixtures}/with-prepare`, {
    width: 210,
    height: 297,
  });

  assert.deepEqual(prepared, {
    width: 210,
    height: 297,
    label: "210 × 297 mm",
  });
});

test("prepareInput follows CommonJS package rules", async () => {
  const prepared = await prepareInput(`${fixtures}/commonjs-prepare`, {
    name: "Ada",
  });

  assert.deepEqual(prepared, {
    name: "Ada",
    greeting: "Hello, Ada!",
  });
});
