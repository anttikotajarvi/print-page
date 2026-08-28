import { mkdir, mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { PrintableSettings } from "./types.js";

const CACHE_VERSION = "2";
const CACHE_FILE_EXTENSION = ".pdf";
const IGNORED_DIRECTORIES = new Set([".git"]);

export interface RenderCache {
  read(key: string): Promise<Uint8Array | undefined>;
  write(key: string, pdf: Uint8Array): Promise<void>;
  clear(): Promise<void>;
}

export interface CacheKeyFactory<Input = unknown> {
  create(input: Input): Promise<string>;
}

export interface CacheKeyOptions {
  printableDirectory: string;
  input: unknown;
  settings: PrintableSettings;
  rendererVersion: string;
}

export class FileRenderCache implements RenderCache {
  constructor(readonly directory = defaultCacheDirectory()) {}

  async read(key: string): Promise<Uint8Array | undefined> {
    const file = Bun.file(this.pathFor(key));

    if (!(await file.exists())) {
      return undefined;
    }

    return new Uint8Array(await file.arrayBuffer());
  }

  async write(key: string, pdf: Uint8Array): Promise<void> {
    const destination = this.pathFor(key);
    const directory = dirname(destination);
    await mkdir(directory, { recursive: true });
    const temporaryDirectory = await mkdtemp(join(directory, ".print-page-"));
    const temporaryPath = join(temporaryDirectory, "entry.pdf");

    try {
      await Bun.write(temporaryPath, pdf);
      await rename(temporaryPath, destination);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async clear(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }

  private pathFor(key: string): string {
    if (!/^[a-f0-9]{64}$/u.test(key)) {
      throw new Error("Cache keys must be SHA-256 hexadecimal digests.");
    }

    return join(this.directory, `${key}${CACHE_FILE_EXTENSION}`);
  }
}

export function defaultCacheDirectory(): string {
  const cacheHome = Bun.env.XDG_CACHE_HOME
    ?? (Bun.env.HOME ? join(Bun.env.HOME, ".cache") : join(homedir(), ".cache"));

  return join(cacheHome || tmpdir(), "print-page");
}

/**
 * Hashes the original input, effective settings, renderer version, and every
 * printable file. This intentionally does not attempt dependency analysis.
 */
export async function createCacheKey(
  options: CacheKeyOptions,
): Promise<string> {
  const root = resolve(options.printableDirectory);
  const hasher = new Bun.CryptoHasher("sha256");

  hasher.update(`print-page-cache-v${CACHE_VERSION}\0`);
  hasher.update(stableJson({
    input: options.input,
    rendererVersion: options.rendererVersion,
    settings: options.settings,
  }));

  for (const filePath of await printableFiles(root)) {
    const relativePath = relative(root, filePath).split(sep).join("/");
    const contents = await readFile(filePath);

    hasher.update(`\0${relativePath}\0${contents.byteLength}\0`);
    hasher.update(contents);
  }

  return hasher.digest("hex");
}

async function printableFiles(
  directory: string,
): Promise<string[]> {
  const files: string[] = [];

  async function scan(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await scan(join(currentDirectory, entry.name));
        }

        continue;
      }

      const path = join(currentDirectory, entry.name);

      files.push(path);
    }
  }

  await scan(directory);
  return files;
}

function stableJson(value: unknown, stack = new Set<object>()): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("Cache input must not contain a non-finite number.");
      }

      return JSON.stringify(value);
    case "object": {
      if (stack.has(value)) {
        throw new TypeError("Cache input must not contain a circular reference.");
      }

      stack.add(value);

      try {
        if (Array.isArray(value)) {
          return `[${value.map((item) => stableJson(item, stack)).join(",")}]`;
        }

        const object = value as Record<string, unknown>;
        const keys = Object.keys(object).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(object[key], stack)}`).join(",")}}`;
      } finally {
        stack.delete(value);
      }
    }
    default:
      throw new TypeError("Cache input must be JSON-serializable.");
  }
}
