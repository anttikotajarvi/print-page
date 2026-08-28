import assert from "node:assert/strict";
import test from "node:test";

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

  assert.deepEqual(result, {
    mode: "mustache",
    html: "<h1>Tools &amp; supplies</h1>",
  });
});

test("window mode leaves HTML unchanged and creates an init script", () => {
  const html = "<!doctype html><div id=app></div>";
  const result = injectEntryHtml(html, { name: "Ada" }, "window");

  assert.equal(result.html, html);
  assert.equal(result.mode, "window");
  assert.match(result.initScript, /__PRINT_DATA__/u);
  assert.match(result.initScript, /"name":"Ada"/u);
});

test("window data serialization escapes script-significant characters", () => {
  const script = createWindowDataScript({ value: "</script>&" });

  assert.doesNotMatch(script, /<\/script>/u);
  assert.match(script, /\\u003c\/script\\u003e\\u0026/u);
});

test("window data serialization rejects circular input", () => {
  const data: { self?: unknown } = {};
  data.self = data;

  assert.throws(
    () => createWindowDataScript(data),
    /must be JSON-serializable/u,
  );
});
