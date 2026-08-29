import { afterEach, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { startInspectServer, type InspectServer } from "../src/inspect.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const servers: InspectServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

test("inspect serves Mustache HTML after prepare.js has run", async () => {
  const server = await inspect("with-prepare", { width: 210, height: 297 });
  const response = await fetch(server.url);

  expect(new URL(server.url).hostname).toBe("127.0.0.1");
  expect(new URL(server.url).port).not.toBe("");
  expect(await response.text()).toContain("210 × 297 mm");
});

test("inspect supplies window data before the entry page and preserves assets", async () => {
  const server = await inspect("configured", { name: "Ada" });
  const response = await fetch(server.url);
  const html = await response.text();
  const previewOrigin = new URL(server.url).origin;

  expect(html).toStartWith(
    "<!doctype html><script>window[\"__PRINT_DATA__\"] = {\"name\":\"Ada\"};</script>",
  );
  expect(await fetch(`${previewOrigin}/shared.js`).then((asset) => asset.status))
    .toBe(200);
  expect(await fetch(`${previewOrigin}/assets/app.js`).then((asset) => asset.status))
    .toBe(200);
});

test("inspect preserves a configured shared resource root", async () => {
  const server = await inspect("shared-root/card", {});
  const previewOrigin = new URL(server.url).origin;

  expect(new URL(server.url).pathname).toBe("/card/index.html");
  expect(await fetch(`${previewOrigin}/assets/main.css`).then((asset) => asset.text()))
    .toContain("rebeccapurple");
});

async function inspect(
  fixture: string,
  input: unknown,
): Promise<InspectServer> {
  const server = await startInspectServer({
    printableDirectory: `${fixtures}/${fixture}`,
    input,
  });
  servers.push(server);
  return server;
}
