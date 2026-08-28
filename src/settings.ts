import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { PrintPageError } from "./errors.js";
import { resolveWithinDirectory } from "./paths.js";
import {
  INJECTION_MODES,
  type PrintableSettings,
} from "./types.js";

export const SETTINGS_FILE_NAME = "settings.json";

export const DEFAULT_SETTINGS: Readonly<PrintableSettings> = Object.freeze({
  root: ".",
  entryPoint: "index.html",
  injectionMode: "mustache",
  useCache: true,
  waitForPrintReady: false,
  timeout: 30_000,
});

const SETTINGS_KEYS = new Set<keyof PrintableSettings>([
  "root",
  "entryPoint",
  "injectionMode",
  "useCache",
  "waitForPrintReady",
  "timeout",
]);

export async function loadSettings(
  printableDirectory: string,
  settingsFileName = SETTINGS_FILE_NAME,
): Promise<PrintableSettings> {
  const settingsPath = resolveWithinDirectory(
    printableDirectory,
    settingsFileName,
    "Settings file",
  );

  let source: string;

  try {
    source = await readFile(settingsPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ...DEFAULT_SETTINGS };
    }

    throw new PrintPageError(
      "INVALID_SETTINGS",
      `Could not read settings from ${settingsPath}.`,
      { cause: error },
    );
  }

  let value: unknown;

  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new PrintPageError(
      "INVALID_SETTINGS",
      `Settings file ${settingsPath} does not contain valid JSON.`,
      { cause: error },
    );
  }

  return validateSettings(value, settingsPath);
}

export function validateSettings(
  value: unknown,
  source = "settings",
): PrintableSettings {
  if (!isRecord(value)) {
    throw invalidSettings(source, "must contain a JSON object");
  }

  for (const key of Object.keys(value)) {
    if (!SETTINGS_KEYS.has(key as keyof PrintableSettings)) {
      throw invalidSettings(source, `contains unknown property ${JSON.stringify(key)}`);
    }
  }

  const settings: PrintableSettings = {
    ...DEFAULT_SETTINGS,
    ...value,
  } as PrintableSettings;

  if (
    typeof settings.root !== "string"
    || settings.root.trim().length === 0
    || settings.root.includes("\0")
    || isAbsolute(settings.root)
  ) {
    throw invalidSettings(
      source,
      "root must be a non-empty relative directory path",
    );
  }

  if (
    typeof settings.entryPoint !== "string" ||
    settings.entryPoint.trim().length === 0
  ) {
    throw invalidSettings(source, "entryPoint must be a non-empty string");
  }

  const validationRoot = resolve(".print-page-entry-root");

  try {
    const entryPath = resolveWithinDirectory(
      validationRoot,
      settings.entryPoint,
      "entryPoint",
    );

    if (entryPath === validationRoot) {
      throw new PrintPageError(
        "INVALID_PATH",
        "entryPoint must name a file inside the configured root.",
      );
    }
  } catch (error) {
    throw invalidSettings(
      source,
      "entryPoint must name a relative path inside the configured root",
      error,
    );
  }

  if (!INJECTION_MODES.includes(settings.injectionMode)) {
    throw invalidSettings(
      source,
      `injectionMode must be one of ${INJECTION_MODES.join(", ")}`,
    );
  }

  if (typeof settings.useCache !== "boolean") {
    throw invalidSettings(source, "useCache must be a boolean");
  }

  if (typeof settings.waitForPrintReady !== "boolean") {
    throw invalidSettings(source, "waitForPrintReady must be a boolean");
  }

  if (
    typeof settings.timeout !== "number" ||
    !Number.isSafeInteger(settings.timeout) ||
    settings.timeout <= 0
  ) {
    throw invalidSettings(source, "timeout must be a positive integer");
  }

  return settings;
}

function invalidSettings(
  source: string,
  detail: string,
  cause?: unknown,
): PrintPageError {
  return new PrintPageError(
    "INVALID_SETTINGS",
    `Invalid ${source}: ${detail}.`,
    cause === undefined ? undefined : { cause },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
