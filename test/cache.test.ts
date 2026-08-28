import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCacheKey } from "../src/cache.js";
import type { PrintableSettings } from "../src/types.js";

const temporaryDirectories: string[] = [];
const settings: PrintableSettings = {
  root: ".",
  entryPoint: "index.html",
  injectionMode: "mustache",
  useCache: true,
  waitForPrintReady: false,
  timeout: 30_000,
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test("createCacheKey tracks printable dependencies in node_modules", async () => {
  const directory = await temporaryDirectory();
  const dependency = join(directory, "node_modules", "bundle", "app.js");
  await mkdir(join(directory, "node_modules", "bundle"), { recursive: true });
  await writeFile(join(directory, "index.html"), "<main>Printable</main>");
  await writeFile(dependency, "export const version = 1;");

  const firstKey = await createCacheKey({
    printableDirectory: directory,
    input: { name: "Ada" },
    settings,
    rendererVersion: "test",
  });

  await writeFile(dependency, "export const version = 2;");

  const secondKey = await createCacheKey({
    printableDirectory: directory,
    input: { name: "Ada" },
    settings,
    rendererVersion: "test",
  });

  expect(secondKey).not.toBe(firstKey);
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "print-page-cache-"));
  temporaryDirectories.push(directory);
  return directory;
}
