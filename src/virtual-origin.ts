import { readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";

import { PrintPageError } from "./errors.js";
import { injectEntryHtml } from "./inject.js";
import { resolveWithinDirectory } from "./paths.js";
import type { InjectionMode } from "./types.js";

export const VIRTUAL_ORIGIN = "http://print.local";

export interface VirtualOrigin {
  printableDirectory: string;
  entryPoint: string;
  entryUrl: string;
}

export interface VirtualResourceOptions {
  printableDirectory: string;
  entryPoint: string;
  requestUrl: string;
  injectionMode: InjectionMode;
  data: unknown;
  useEntryAssetAlias?: boolean;
}

export interface VirtualResource {
  body: Buffer;
  contentType: string;
  sourcePath: string;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

export function createVirtualEntryUrl(entryPoint: string): string {
  const root = resolve(".");
  const entryPath = resolveWithinDirectory(root, entryPoint, "Entry point");
  const normalizedEntryPoint = relative(root, entryPath);
  const encodedPath = normalizedEntryPoint
    .split(sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return new URL(encodedPath, `${VIRTUAL_ORIGIN}/`).href;
}

/**
 * Preserve the configured entry point below the printable root. This keeps
 * normal browser-relative URLs working for nested application builds.
 */
export function createVirtualOrigin(
  printableDirectory: string,
  entryPoint: string,
): VirtualOrigin {
  const root = resolve(printableDirectory);
  const entryPath = resolveWithinDirectory(
    root,
    entryPoint,
    "Entry point",
  );
  const normalizedEntryPoint = relative(root, entryPath);

  return {
    printableDirectory: root,
    entryPoint: normalizedEntryPoint,
    entryUrl: createVirtualEntryUrl(normalizedEntryPoint),
  };
}

export function resolveVirtualResourcePath(
  printableDirectory: string,
  requestUrl: string,
  entryPoint: string,
  useEntryAssetAlias = true,
): string {
  let url: URL;

  try {
    url = new URL(requestUrl);
  } catch (error) {
    throw new PrintPageError(
      "VIRTUAL_ORIGIN_ERROR",
      `Invalid virtual-origin URL ${JSON.stringify(requestUrl)}.`,
      { cause: error },
    );
  }

  if (url.origin !== VIRTUAL_ORIGIN) {
    throw new PrintPageError(
      "VIRTUAL_ORIGIN_ERROR",
      `URL ${JSON.stringify(requestUrl)} is outside ${VIRTUAL_ORIGIN}.`,
    );
  }

  let pathname: string;

  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    throw new PrintPageError(
      "VIRTUAL_ORIGIN_ERROR",
      `URL ${JSON.stringify(requestUrl)} contains an invalid path encoding.`,
      { cause: error },
    );
  }

  const root = resolve(printableDirectory);
  const entryPath = resolveWithinDirectory(root, entryPoint, "Entry point");
  const resourcePath = pathname === "/" ? entryPoint : pathname.slice(1);

  // Vite's default base emits `/assets/...` even if the built index is in a
  // `dist/` directory. Preserve that narrow alias for a document-local root.
  // An explicitly configured root owns root-relative URLs instead, which lets
  // a collection expose shared `/assets/...` files.
  const resourceRoot = useEntryAssetAlias
    && (pathname === "/assets" || pathname.startsWith("/assets/"))
    ? dirname(entryPath)
    : root;

  try {
    return resolveWithinDirectory(
      resourceRoot,
      resourcePath,
      "Virtual resource path",
    );
  } catch (error) {
    throw new PrintPageError(
      "VIRTUAL_ORIGIN_ERROR",
      `Virtual resource ${JSON.stringify(pathname)} escapes the printable directory.`,
      { cause: error },
    );
  }
}

export async function loadVirtualResource(
  options: VirtualResourceOptions,
): Promise<VirtualResource> {
  const sourcePath = resolveVirtualResourcePath(
    options.printableDirectory,
    options.requestUrl,
    options.entryPoint,
    options.useEntryAssetAlias,
  );
  const entryPath = resolveWithinDirectory(
    options.printableDirectory,
    options.entryPoint,
    "Entry point",
  );

  let body: Buffer;

  try {
    body = await readFile(sourcePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new PrintPageError(
        "RESOURCE_NOT_FOUND",
        `Virtual resource ${sourcePath} does not exist.`,
        { cause: error },
      );
    }

    throw new PrintPageError(
      "VIRTUAL_ORIGIN_ERROR",
      `Could not read virtual resource ${sourcePath}.`,
      { cause: error },
    );
  }

  if (resolve(sourcePath) === resolve(entryPath) && options.injectionMode === "mustache") {
    const injection = injectEntryHtml(body.toString("utf8"), options.data, "mustache");
    body = Buffer.from(injection.html);
  }

  return {
    body,
    contentType: contentTypeForPath(sourcePath),
    sourcePath,
  };
}

export function contentTypeForPath(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
