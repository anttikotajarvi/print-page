import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";

import { PrintPageError } from "./errors.js";
import { createWindowDataScript } from "./inject.js";
import { preparePrintable, type RenderOptions } from "./render.js";
import {
  createVirtualOrigin,
  loadVirtualResource,
  VIRTUAL_ORIGIN,
} from "./virtual-origin.js";

export interface InspectOptions extends Pick<
  RenderOptions,
  "printableDirectory" | "input"
> {}

export interface InspectServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Serves a prepared printable from a local browser-visible origin. The resource
 * loader is deliberately the same one the Playwright virtual origin uses.
 */
export async function startInspectServer(
  options: InspectOptions,
): Promise<InspectServer> {
  const printable = await preparePrintable(options);
  const origin = createVirtualOrigin(
    printable.printableDirectory,
    printable.settings.entryPoint,
  );
  const windowDataScript = printable.settings.injectionMode === "window"
    ? createWindowDataScript(printable.data)
    : undefined;
  const entryPath = resolve(
    printable.printableDirectory,
    origin.entryPoint,
  );

  const server = createServer((request, response) => {
    void serveRequest({
      request,
      response,
      printableDirectory: origin.printableDirectory,
      entryPoint: origin.entryPoint,
      injectionMode: printable.settings.injectionMode,
      data: printable.data,
      useEntryAssetAlias: printable.useEntryAssetAlias,
      entryPath,
      ...(windowDataScript === undefined ? {} : { windowDataScript }),
    });
  });

  await listenLocally(server);

  const address = server.address();

  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new PrintPageError(
      "VIRTUAL_ORIGIN_ERROR",
      "Could not determine the local preview server address.",
    );
  }

  let closed = false;
  const entryUrl = new URL(origin.entryUrl);
  const url = `http://127.0.0.1:${address.port}${entryUrl.pathname}${entryUrl.search}`;

  return {
    url,
    async close(): Promise<void> {
      if (closed) {
        return;
      }

      closed = true;
      await closeServer(server);
    },
  };
}

interface ServeRequestOptions {
  request: IncomingMessage;
  response: ServerResponse;
  printableDirectory: string;
  entryPoint: string;
  injectionMode: "mustache" | "window";
  data: unknown;
  useEntryAssetAlias: boolean;
  entryPath: string;
  windowDataScript?: string;
}

async function serveRequest(options: ServeRequestOptions): Promise<void> {
  const { request, response } = options;
  const method = request.method ?? "GET";

  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  try {
    const incomingUrl = new URL(request.url ?? "/", VIRTUAL_ORIGIN);
    const resource = await loadVirtualResource({
      printableDirectory: options.printableDirectory,
      entryPoint: options.entryPoint,
      requestUrl: new URL(
        `${incomingUrl.pathname}${incomingUrl.search}`,
        VIRTUAL_ORIGIN,
      ).href,
      injectionMode: options.injectionMode,
      data: options.data,
      useEntryAssetAlias: options.useEntryAssetAlias,
    });
    const body = options.windowDataScript !== undefined
      && resolve(resource.sourcePath) === options.entryPath
      ? Buffer.from(injectWindowDataScript(
        resource.body.toString("utf8"),
        options.windowDataScript,
      ))
      : resource.body;

    response.writeHead(200, { "content-type": resource.contentType });
    response.end(method === "HEAD" ? undefined : body);
  } catch (error) {
    const status = error instanceof PrintPageError
      && error.code === "RESOURCE_NOT_FOUND"
      ? 404
      : 500;

    response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    response.end(describeError(error));
  }
}

function listenLocally(server: Server): Promise<void> {
  return new Promise((resolveListen, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: "127.0.0.1", port: 0 });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolveClose();
      } else {
        reject(error);
      }
    });
  });
}

function injectWindowDataScript(html: string, script: string): string {
  const tag = `<script>${script}</script>`;
  const doctype = /^\s*<!doctype\b[^>]*>/iu.exec(html);

  return doctype === null
    ? `${tag}${html}`
    : `${doctype[0]}${tag}${html.slice(doctype[0].length)}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
