import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { prepareInput } from "../src/prepare.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

test("prepareInput returns input unchanged when prepare.js is absent", async () => {
  const input = { name: "Ada" };

  expect(await prepareInput(`${fixtures}/minimal`, input)).toBe(input);
});

test("prepareInput runs an asynchronous default export", async () => {
  const prepared = await prepareInput(`${fixtures}/with-prepare`, {
    width: 210,
    height: 297,
  });

  expect(prepared).toEqual({
    width: 210,
    height: 297,
    label: "210 × 297 mm",
  });
});

test("prepareInput follows CommonJS package rules", async () => {
  const prepared = await prepareInput(`${fixtures}/commonjs-prepare`, {
    name: "Ada",
  });

  expect(prepared).toEqual({
    name: "Ada",
    greeting: "Hello, Ada!",
  });
});
