import { afterEach, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { FileRenderCache, type RenderCache } from "../src/cache.js";
import {
  renderToFile,
  type PdfRenderer,
  type RenderRequest,
} from "../src/render.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const temporaryDirectories: string[] = [];
const pdf = new TextEncoder().encode("%PDF-1.7\nfake PDF\n");

class MemoryCache implements RenderCache {
  private readonly entries = new Map<string, Uint8Array>();

  async read(key: string): Promise<Uint8Array | undefined> {
    return this.entries.get(key);
  }

  async write(key: string, bytes: Uint8Array): Promise<void> {
    this.entries.set(key, bytes);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test("renderToFile prepares data and writes renderer output", async () => {
  const directory = await temporaryDirectory();
  const outputPath = join(directory, "nested", "card.pdf");
  let received: RenderRequest | undefined;
  const renderer: PdfRenderer = {
    render: async (request) => {
      received = request;
      return { bytes: pdf };
    },
  };

  const result = await renderToFile({
    printableDirectory: `${fixtures}/with-prepare`,
    input: { width: 210, height: 297 },
    outputPath,
    renderer,
    cache: new MemoryCache(),
  });

  expect(result).toEqual({ outputPath, cacheHit: false });
  expect(received?.data).toEqual({
    width: 210,
    height: 297,
    label: "210 × 297 mm",
  });
  expect(await readFile(outputPath)).toEqual(Buffer.from(pdf));
});

test("renderToFile reuses a deterministic cached PDF", async () => {
  const directory = await temporaryDirectory();
  const cache = new MemoryCache();
  let renderCount = 0;
  const renderer: PdfRenderer = {
    render: async () => {
      renderCount += 1;
      return { bytes: pdf };
    },
  };

  const first = await renderToFile({
    printableDirectory: `${fixtures}/minimal`,
    input: { name: "Ada" },
    outputPath: join(directory, "first.pdf"),
    renderer,
    cache,
  });
  const secondOutput = join(directory, "second.pdf");
  const second = await renderToFile({
    printableDirectory: `${fixtures}/minimal`,
    input: { name: "Ada" },
    outputPath: secondOutput,
    renderer,
    cache,
  });

  expect(first.cacheHit).toBe(false);
  expect(second).toEqual({ outputPath: secondOutput, cacheHit: true });
  expect(renderCount).toBe(1);
  expect(await readFile(secondOutput)).toEqual(Buffer.from(pdf));
});

test("renderToFile ignores an invalid cached value", async () => {
  const directory = await temporaryDirectory();
  let renderCount = 0;
  const cache: RenderCache = {
    read: async () => new Uint8Array(),
    write: async () => undefined,
    clear: async () => undefined,
  };

  const result = await renderToFile({
    printableDirectory: `${fixtures}/minimal`,
    input: { name: "Ada" },
    outputPath: join(directory, "fresh.pdf"),
    cache,
    renderer: {
      render: async () => {
        renderCount += 1;
        return { bytes: pdf };
      },
    },
  });

  expect(result.cacheHit).toBe(false);
  expect(renderCount).toBe(1);
});

test("FileRenderCache creates and atomically publishes its cache directory", async () => {
  const directory = await temporaryDirectory();
  const cache = new FileRenderCache(join(directory, "cache"));
  const key = "a".repeat(64);

  await cache.write(key, pdf);

  expect(await cache.read(key)).toEqual(pdf);
});

test("renderToFile refuses to replace output without force", async () => {
  const directory = await temporaryDirectory();
  const outputPath = join(directory, "existing.pdf");
  let renderCount = 0;
  const renderer: PdfRenderer = {
    render: async () => {
      renderCount += 1;
      return { bytes: pdf };
    },
  };
  await writeFile(outputPath, "old PDF");

  await expect(
    renderToFile({
      printableDirectory: `${fixtures}/minimal`,
      input: {},
      outputPath,
      renderer,
      cache: new MemoryCache(),
    }),
  ).rejects.toThrow(/already exists; use --force/u);
  expect(renderCount).toBe(0);

  await renderToFile({
    printableDirectory: `${fixtures}/minimal`,
    input: {},
    outputPath,
    force: true,
    renderer,
    cache: new MemoryCache(),
  });
  expect(renderCount).toBe(1);
  expect(await readFile(outputPath)).toEqual(Buffer.from(pdf));
});

test.skipIf(process.platform === "win32")(
  "renderToFile does not follow a dangling output symlink without force",
  async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "target.pdf");
    const outputPath = join(directory, "output.pdf");
    await symlink(targetPath, outputPath);
    const renderer: PdfRenderer = {
      render: async () => ({ bytes: pdf }),
    };

    await expect(
      renderToFile({
        printableDirectory: `${fixtures}/minimal`,
        input: {},
        outputPath,
        renderer,
        useCache: false,
      }),
    ).rejects.toThrow(/already exists; use --force/u);
    expect(await Bun.file(targetPath).exists()).toBe(false);
    expect((await lstat(outputPath)).isSymbolicLink()).toBe(true);

    await renderToFile({
      printableDirectory: `${fixtures}/minimal`,
      input: {},
      outputPath,
      force: true,
      renderer,
      useCache: false,
    });

    expect((await lstat(outputPath)).isSymbolicLink()).toBe(false);
    expect(await Bun.file(targetPath).exists()).toBe(false);
    expect(await readFile(outputPath)).toEqual(Buffer.from(pdf));
  },
);

test("renderToFile leaves no output when rendering fails", async () => {
  const directory = await temporaryDirectory();
  const outputPath = join(directory, "failed.pdf");

  await expect(
    renderToFile({
      printableDirectory: `${fixtures}/minimal`,
      input: {},
      outputPath,
      renderer: {
        render: async () => {
          throw new Error("browser failed");
        },
      },
      cache: new MemoryCache(),
    }),
  ).rejects.toThrow("browser failed");
  expect(await Bun.file(outputPath).exists()).toBe(false);
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "print-page-render-"));
  temporaryDirectories.push(directory);
  return directory;
}
