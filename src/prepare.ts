import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { PrintPageError } from "./errors.js";
import { resolveWithinDirectory } from "./paths.js";

export const PREPARE_FILE_NAME = "prepare.js";

export type PrepareFunction = (
  input: unknown,
) => unknown | Promise<unknown>;

interface PrepareModule {
  default?: unknown;
}

export async function prepareInput(
  printableDirectory: string,
  input: unknown,
  prepareFileName = PREPARE_FILE_NAME,
): Promise<unknown> {
  const preparePath = resolveWithinDirectory(
    printableDirectory,
    prepareFileName,
    "Prepare file",
  );

  try {
    const file = await stat(preparePath);

    if (!file.isFile()) {
      throw new PrintPageError(
        "PREPARE_FAILED",
        `Prepare module ${preparePath} is not a file.`,
      );
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return input;
    }

    if (error instanceof PrintPageError) {
      throw error;
    }

    throw new PrintPageError(
      "PREPARE_FAILED",
      `Could not inspect prepare module ${preparePath}.`,
      { cause: error },
    );
  }

  let module: PrepareModule;

  try {
    module = (await import(pathToFileURL(preparePath).href)) as PrepareModule;
  } catch (error) {
    throw new PrintPageError(
      "PREPARE_FAILED",
      `Could not load prepare module ${preparePath}.`,
      { cause: error },
    );
  }

  if (typeof module.default !== "function") {
    throw new PrintPageError(
      "PREPARE_FAILED",
      `Prepare module ${preparePath} must default-export a function.`,
    );
  }

  try {
    return await (module.default as PrepareFunction)(input);
  } catch (error) {
    throw new PrintPageError(
      "PREPARE_FAILED",
      `Prepare module ${preparePath} failed.`,
      { cause: error },
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
