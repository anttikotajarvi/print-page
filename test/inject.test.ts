import { expect, test } from "bun:test";

import {
  createWindowDataScript,
  injectEntryHtml,
} from "../src/inject.js";

test("mustache mode renders and escapes input", () => {
  const result = injectEntryHtml(
    "<h1>{{title}}</h1>",
    { title: "Tools & supplies" },
    "mustache",
  );

  expect(result).toEqual({
    mode: "mustache",
    html: "<h1>Tools &amp; supplies</h1>",
  });
});

test("window mode leaves HTML unchanged and creates an init script", () => {
  const html = "<!doctype html><div id=app></div>";
  const result = injectEntryHtml(html, { name: "Ada" }, "window");

  expect(result.html).toBe(html);
  expect(result.mode).toBe("window");
  expect(result.initScript).toMatch(/__PRINT_DATA__/u);
  expect(result.initScript).toMatch(/"name":"Ada"/u);
});

test("window data serialization escapes script-significant characters", () => {
  const script = createWindowDataScript({ value: "</script>&" });

  expect(script).not.toMatch(/<\/script>/u);
  expect(script).toMatch(/\\u003c\/script\\u003e\\u0026/u);
});

test("window data serialization rejects circular input", () => {
  const data: { self?: unknown } = {};
  data.self = data;

  expect(
    () => createWindowDataScript(data),
  ).toThrow(/must be JSON-serializable/u);
});
