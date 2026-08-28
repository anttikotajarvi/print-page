import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createVirtualEntryUrl,
  loadVirtualResource,
  resolveVirtualResourcePath,
} from "../src/virtual-origin.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const minimal = `${fixtures}/minimal`;

test("createVirtualEntryUrl encodes an entry-point path", () => {
  assert.equal(
    createVirtualEntryUrl("folder with spaces/index.html"),
    "http://print.local/folder%20with%20spaces/index.html",
  );
});

test("createVirtualEntryUrl rejects absolute and escaping paths", () => {
  assert.throws(
    () => createVirtualEntryUrl("//example.com/index.html"),
    /must be relative/u,
  );
  assert.throws(
    () => createVirtualEntryUrl("../index.html"),
    /must stay inside/u,
  );
});

test("loadVirtualResource renders the Mustache entry point", async () => {
  const resource = await loadVirtualResource({
    printableDirectory: minimal,
    entryPoint: "index.html",
    requestUrl: "http://print.local/index.html",
    injectionMode: "mustache",
    data: { name: "Ada" },
  });

  assert.equal(resource.contentType, "text/html; charset=utf-8");
  assert.match(resource.body.toString("utf8"), /Hello, Ada!/u);
});

test("resolveVirtualResourcePath rejects another origin", () => {
  assert.throws(
    () =>
      resolveVirtualResourcePath(
        minimal,
        "https://example.com/index.html",
        "index.html",
      ),
    /outside http:\/\/print\.local/u,
  );
});

test("resolveVirtualResourcePath rejects encoded traversal", () => {
  assert.throws(
    () =>
      resolveVirtualResourcePath(
        minimal,
        "http://print.local/..%2Fsecret.txt",
        "index.html",
      ),
    /escapes the printable directory/u,
  );
});
