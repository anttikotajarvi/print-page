import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { chromium, type LaunchOptions } from "playwright";

import {
  createCacheKey,
  FileRenderCache,
  type RenderCache,
} from "./cache.js";
import { PrintPageError } from "./errors.js";
import { createWindowDataScript } from "./inject.js";
import { prepareInput } from "./prepare.js";
import { loadSettings } from "./settings.js";
import type { PrintableSettings } from "./types.js";
import {
  createVirtualOrigin,
  loadVirtualResource,
  VIRTUAL_ORIGIN,
} from "./virtual-origin.js";
import { VERSION } from "./version.js";

export const WINDOW_PRINT_READY_GLOBAL = "__PRINT_READY__";

export interface RenderRequest {
  printableDirectory: string;
  settings: PrintableSettings;
  data: unknown;
}

export interface RenderedPdf {
  bytes: Uint8Array;
}

/**
 * Browser lifecycle implementations live behind this boundary so that HTML
 * rendering stays independent from output naming, caching, and host printing.
 */
export interface PdfRenderer {
  render(request: RenderRequest): Promise<RenderedPdf>;
}

export interface RenderToFileOptions {
  printableDirectory: string;
  input: unknown;
  outputPath: string;
  force?: boolean;
  renderer?: PdfRenderer;
  cache?: RenderCache;
  useCache?: boolean;
}

export interface RenderResult {
  outputPath: string;
  cacheHit: boolean;
}

export interface PlaywrightPdfRendererOptions {
  launchOptions?: LaunchOptions;
}

export class PlaywrightPdfRenderer implements PdfRenderer {
  constructor(private readonly options: PlaywrightPdfRendererOptions = {}) {}

  async render(request: RenderRequest): Promise<RenderedPdf> {
    let browser;

    try {
      browser = await chromium.launch({
        headless: true,
        ...this.options.launchOptions,
      });
    } catch (error) {
      throw new PrintPageError(
        "RENDER_FAILED",
        `Could not launch Chromium. Install it with \"bunx playwright install chromium\". ${describeError(error)}`,
        { cause: error },
      );
    }

    try {
      const context = await browser.newContext({ serviceWorkers: "block" });

      try {
        const origin = createVirtualOrigin(
          request.printableDirectory,
          request.settings.entryPoint,
        );

        if (request.settings.injectionMode === "window") {
          await context.addInitScript({
            content: createOriginScopedWindowDataScript(request.data),
          });
        }

        await context.route(`${VIRTUAL_ORIGIN}/**`, async (route) => {
          const requestMethod = route.request().method();

          if (requestMethod !== "GET" && requestMethod !== "HEAD") {
            await route.fulfill({
              status: 405,
              contentType: "text/plain; charset=utf-8",
              body: "Method not allowed",
            });
            return;
          }

          try {
            const resource = await loadVirtualResource({
              printableDirectory: origin.printableDirectory,
              entryPoint: origin.entryPoint,
              requestUrl: route.request().url(),
              injectionMode: request.settings.injectionMode,
              data: request.data,
            });

            await route.fulfill({
              status: 200,
              contentType: resource.contentType,
              body: requestMethod === "HEAD" ? "" : resource.body,
            });
          } catch (error) {
            const status = error instanceof PrintPageError
              && error.code === "RESOURCE_NOT_FOUND"
              ? 404
              : 500;

            await route.fulfill({
              status,
              contentType: "text/plain; charset=utf-8",
              body: describeError(error),
            });
          }
        });

        const page = await context.newPage();
        const deadline = Date.now() + request.settings.timeout;
        const response = await page.goto(origin.entryUrl, {
          waitUntil: "load",
          timeout: remainingTime(deadline),
        });

        if (response === null || !response.ok()) {
          throw new PrintPageError(
            "RENDER_FAILED",
            `Could not load printable entry point (${response?.status() ?? "no response"}).`,
          );
        }

        if (request.settings.waitForPrintReady) {
          await page.waitForFunction(
            (globalName) => (globalThis as Record<string, unknown>)[globalName] === true,
            WINDOW_PRINT_READY_GLOBAL,
            { timeout: remainingTime(deadline) },
          );
        }

        await page.emulateMedia({ media: "print" });

        return {
          bytes: new Uint8Array(await page.pdf({
            format: "A4",
            preferCSSPageSize: true,
            printBackground: true,
          })),
        };
      } finally {
        await context.close().catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof PrintPageError) {
        throw error;
      }

      throw new PrintPageError(
        "RENDER_FAILED",
        `Chromium rendering failed. ${describeError(error)}`,
        { cause: error },
      );
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
}

export async function renderToFile(
  options: RenderToFileOptions,
): Promise<RenderResult> {
  const printableDirectory = await requireDirectory(options.printableDirectory);
  const outputPath = resolve(options.outputPath);

  await ensureOutputAvailable(outputPath, options.force ?? false);

  const settings = await loadSettings(printableDirectory);
  const shouldUseCache = options.useCache ?? settings.useCache;
  const cache = shouldUseCache
    ? options.cache ?? new FileRenderCache()
    : undefined;
  let cacheKey: string | undefined;
  let cachedPdf: Uint8Array | undefined;

  if (cache !== undefined) {
    try {
      cacheKey = await createCacheKey({
        printableDirectory,
        input: options.input,
        outputPath,
        rendererVersion: VERSION,
        settings,
      });
      cachedPdf = await cache.read(cacheKey);
    } catch {
      // A cache failure must not prevent a fresh render.
      cacheKey = undefined;
    }
  }

  if (isPdf(cachedPdf)) {
    await writeOutput(outputPath, cachedPdf, options.force ?? false);
    return { outputPath, cacheHit: true };
  }

  const data = await prepareInput(printableDirectory, options.input);
  const renderer = options.renderer ?? new PlaywrightPdfRenderer();
  const rendered = await renderer.render({
    printableDirectory,
    settings,
    data,
  });

  if (!isPdf(rendered.bytes)) {
    throw new PrintPageError(
      "RENDER_FAILED",
      "Renderer did not return a PDF.",
    );
  }

  await writeOutput(outputPath, rendered.bytes, options.force ?? false);

  if (cache !== undefined && cacheKey !== undefined) {
    await cache.write(cacheKey, rendered.bytes).catch(() => undefined);
  }

  return { outputPath, cacheHit: false };
}

async function requireDirectory(path: string): Promise<string> {
  const directory = resolve(path);

  try {
    const details = await stat(directory);

    if (!details.isDirectory()) {
      throw new PrintPageError(
        "INVALID_PATH",
        `Printable directory ${directory} is not a directory.`,
      );
    }
  } catch (error) {
    if (error instanceof PrintPageError) {
      throw error;
    }

    throw new PrintPageError(
      "INVALID_PATH",
      `Printable directory ${directory} does not exist or cannot be read.`,
      { cause: error },
    );
  }

  return directory;
}

async function ensureOutputAvailable(
  outputPath: string,
  force: boolean,
): Promise<void> {
  try {
    const details = await lstat(outputPath);

    if (details.isDirectory()) {
      throw new PrintPageError(
        "INVALID_PATH",
        `Output path ${outputPath} is a directory.`,
      );
    }
  } catch (error) {
    if (error instanceof PrintPageError) {
      throw error;
    }

    if (isMissingPath(error)) {
      return;
    }

    throw new PrintPageError(
      "INVALID_PATH",
      `Could not inspect output path ${outputPath}.`,
      { cause: error },
    );
  }

  if (!force) {
    throw new PrintPageError(
      "OUTPUT_EXISTS",
      `Output file ${outputPath} already exists; use --force to replace it.`,
    );
  }
}

async function writeOutput(
  path: string,
  pdf: Uint8Array,
  force: boolean,
): Promise<void> {
  let temporaryDirectory: string | undefined;

  try {
    const outputDirectory = dirname(path);
    await mkdir(outputDirectory, { recursive: true });
    temporaryDirectory = await mkdtemp(join(outputDirectory, ".print-page-"));
    const temporaryPath = join(temporaryDirectory, "output.pdf");

    await Bun.write(temporaryPath, pdf);

    if (force) {
      await rename(temporaryPath, path);
      return;
    }

    try {
      await link(temporaryPath, path);
    } catch (error) {
      if (isExistingPath(error)) {
        throw new PrintPageError(
          "OUTPUT_EXISTS",
          `Output file ${path} already exists; use --force to replace it.`,
          { cause: error },
        );
      }

      throw error;
    }
  } catch (error) {
    if (error instanceof PrintPageError) {
      throw error;
    }

    throw new PrintPageError(
      "RENDER_FAILED",
      `Could not write PDF to ${path}.`,
      { cause: error },
    );
  } finally {
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();

  if (remaining <= 0) {
    throw new PrintPageError("RENDER_FAILED", "Printable render timed out.");
  }

  return remaining;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingPath(error: unknown): error is { code: string } {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function isExistingPath(error: unknown): error is { code: string } {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "EEXIST";
}

function isPdf(bytes: unknown): bytes is Uint8Array {
  return bytes instanceof Uint8Array
    && bytes.byteLength >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}

function createOriginScopedWindowDataScript(data: unknown): string {
  const assignment = createWindowDataScript(data);

  return `if (globalThis.location.origin === ${JSON.stringify(VIRTUAL_ORIGIN)}) { ${assignment} }`;
}
