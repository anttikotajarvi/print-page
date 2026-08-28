import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createVirtualOrigin,
  createVirtualEntryUrl,
  loadVirtualResource,
  resolveVirtualResourcePath,
} from "../src/virtual-origin.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const minimal = `${fixtures}/minimal`;
const configured = `${fixtures}/configured`;
const sharedRoot = `${fixtures}/shared-root`;

test("createVirtualEntryUrl preserves a nested entry path", () => {
  expect(
    createVirtualEntryUrl("folder/index file.html"),
  ).toBe("http://print.local/folder/index%20file.html");
});

test("createVirtualOrigin retains the printable root and entry path", () => {
  expect(
    createVirtualOrigin(minimal, "nested/index.html"),
  ).toEqual({
    printableDirectory: resolve(minimal),
    entryPoint: "nested/index.html",
    entryUrl: "http://print.local/nested/index.html",
  });
});

test("createVirtualEntryUrl rejects absolute and escaping paths", () => {
  expect(
    () => createVirtualEntryUrl("//example.com/index.html"),
  ).toThrow(/must be relative/u);
  expect(
    () => createVirtualEntryUrl("../index.html"),
  ).toThrow(/must stay inside/u);
});

test("loadVirtualResource renders the Mustache entry point", async () => {
  const resource = await loadVirtualResource({
    printableDirectory: minimal,
    entryPoint: "index.html",
    requestUrl: "http://print.local/index.html",
    injectionMode: "mustache",
    data: { name: "Ada" },
  });

  expect(resource.contentType).toBe("text/html; charset=utf-8");
  expect(resource.body.toString("utf8")).toMatch(/Hello, Ada!/u);
});

test("virtual origin serves nested and Vite-absolute assets", async () => {
  const origin = createVirtualOrigin(configured, "dist/index.html");
  const parentResource = await loadVirtualResource({
    printableDirectory: origin.printableDirectory,
    entryPoint: origin.entryPoint,
    requestUrl: "http://print.local/shared.js",
    injectionMode: "window",
    data: {},
  });
  const nestedResource = await loadVirtualResource({
    printableDirectory: origin.printableDirectory,
    entryPoint: origin.entryPoint,
    requestUrl: "http://print.local/dist/assets/app.js",
    injectionMode: "window",
    data: {},
  });
  const viteResource = await loadVirtualResource({
    printableDirectory: origin.printableDirectory,
    entryPoint: origin.entryPoint,
    requestUrl: "http://print.local/assets/app.js",
    injectionMode: "window",
    data: {},
  });

  expect(parentResource.sourcePath).toBe(resolve(configured, "shared.js"));

  for (const resource of [nestedResource, viteResource]) {
    expect(resource.sourcePath).toBe(resolve(configured, "dist/assets/app.js"));
    expect(resource.contentType).toBe("text/javascript; charset=utf-8");
    expect(resource.body.toString("utf8")).toMatch(/CONFIGURED_PRINTABLE/u);
  }
});

test("virtual origin serves shared assets from a configured root", async () => {
  const origin = createVirtualOrigin(sharedRoot, "card/index.html");
  const stylesheet = await loadVirtualResource({
    printableDirectory: origin.printableDirectory,
    entryPoint: origin.entryPoint,
    requestUrl: "http://print.local/assets/main.css",
    injectionMode: "mustache",
    data: {},
    useEntryAssetAlias: false,
  });

  expect(origin.entryUrl).toBe("http://print.local/card/index.html");
  expect(stylesheet.sourcePath).toBe(resolve(sharedRoot, "assets/main.css"));
  expect(stylesheet.body.toString("utf8")).toContain("rebeccapurple");
});

test("resolveVirtualResourcePath rejects another origin", () => {
  expect(
    () =>
      resolveVirtualResourcePath(
        minimal,
        "https://example.com/index.html",
        "index.html",
      ),
  ).toThrow(/outside http:\/\/print\.local/u);
});

test("resolveVirtualResourcePath rejects encoded traversal", () => {
  expect(
    () =>
      resolveVirtualResourcePath(
        minimal,
        "http://print.local/..%2Fsecret.txt",
        "index.html",
      ),
  ).toThrow(/escapes the printable directory/u);
});
