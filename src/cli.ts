import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { PrintPageError } from "./errors.js";
import { render, type RenderOptions } from "./render.js";
import { VERSION } from "./version.js";

export { VERSION } from "./version.js";

const HELP = `print-page ${VERSION}

Render HTML-based printables with Chromium.

Usage:
  print-page <printable-directory> [--output <pdf-path>] [options]

Options:
  -o, --output <path>  Write the PDF to this path
  --<key>=<value>      Simple string input field; repeat as needed
  -d, --data <json>    Literal JSON input
  -i, --input <path>   JSON input file; use - to read stdin
  -f, --force          Replace an existing output file (requires --output)
  -h, --help           Show this help
  -v, --version        Show the version

Choose one input form: --key=value fields, --data, or --input. Direct fields
are strings; use JSON for typed or nested values. With no input option, the
printable receives {}.

Example:
  print-page ./label -o ./label.pdf --name="John Doe"
  print-page ./label --name="John Doe" > ./label.pdf

Without --output, stdout must be redirected or piped. Page size and margins
are controlled by printable CSS.
`;

const CLI_OPTIONS = new Set([
  "-o",
  "--output",
  "-d",
  "--data",
  "-i",
  "--input",
  "-f",
  "--force",
  "-h",
  "--help",
]);

export interface CliIo {
  stdout: CliWriter;
  stderr: CliWriter;
}

export interface CliWriter {
  isTTY?: boolean;
  write(value: string | Uint8Array): unknown;
}

export interface CliServices {
  render(options: RenderOptions): Promise<Uint8Array>;
  readInputFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

interface RenderArguments {
  printableDirectory: string;
  outputPath?: string;
  data?: string;
  inputPath?: string;
  directInput?: Record<string, string>;
  force: boolean;
}

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const defaultServices: CliServices = {
  render,
  readInputFile: async (path) => Bun.file(path).text(),
  readStdin: async () => new Response(Bun.stdin).text(),
};

export async function runCli(
  args: readonly string[],
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
  services: CliServices = defaultServices,
): Promise<number> {
  try {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
      io.stdout.write(HELP);
      return 0;
    }

    if (args[0] === "--version" || args[0] === "-v") {
      io.stdout.write(`${VERSION}\n`);
      return 0;
    }

    // Keep the former command form working while rendering directly by
    // default. This lets callers simplify to `print-page <directory>` without
    // breaking existing scripts that still use `print-page render <directory>`.
    const renderArgs = args[0] === "render" ? args.slice(1) : args;

    if (renderArgs.includes("--help") || renderArgs.includes("-h")) {
      io.stdout.write(HELP);
      return 0;
    }

    const renderArguments = parseRenderArguments(renderArgs);

    if (renderArguments.outputPath === undefined && io.stdout.isTTY) {
      throw new CliUsageError(
        "PDF output requires --output <path> or redirected stdout.",
      );
    }

    const input = await loadInput(renderArguments, services);
    const outputPath = renderArguments.outputPath === undefined
      ? undefined
      : resolve(renderArguments.outputPath);

    if (outputPath !== undefined) {
      await ensureOutputAvailable(outputPath, renderArguments.force);
    }

    const pdf = await services.render({
      printableDirectory: resolve(renderArguments.printableDirectory),
      input,
    });

    if (outputPath === undefined) {
      io.stdout.write(pdf);
    } else {
      await writeOutput(outputPath, pdf, renderArguments.force);
      io.stderr.write(`Wrote ${outputPath}\n`);
    }

    return 0;
  } catch (error) {
    io.stderr.write(`print-page: ${describeError(error)}\n`);
    return error instanceof CliUsageError ? 2 : 1;
  }
}

function parseRenderArguments(args: readonly string[]): RenderArguments {
  let printableDirectory: string | undefined;
  let outputPath: string | undefined;
  let data: string | undefined;
  let inputPath: string | undefined;
  const directInput = new Map<string, string>();
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === undefined) {
      continue;
    }

    const [option, inlineValue] = splitInlineOption(argument);

    switch (option) {
      case "-o":
      case "--output":
        outputPath = setOnce(
          outputPath,
          inlineValue ?? nextValue(args, ++index, option, "path"),
          option,
        );
        break;
      case "-d":
      case "--data":
        data = setOnce(
          data,
          inlineValue ?? nextValue(args, ++index, option, "json"),
          option,
        );
        break;
      case "-i":
      case "--input":
        inputPath = setOnce(
          inputPath,
          inlineValue ?? nextValue(args, ++index, option, "input"),
          option,
        );
        break;
      case "-f":
      case "--force":
        if (inlineValue !== undefined) {
          throw new CliUsageError(`${option} does not accept a value.`);
        }

        if (force) {
          throw new CliUsageError(`${option} may only be provided once.`);
        }

        force = true;
        break;
      case "-h":
      case "--help":
        if (inlineValue !== undefined) {
          throw new CliUsageError(`${option} does not accept a value.`);
        }

        throw new CliUsageError("--help must be used on its own.");
      default:
        if (option.startsWith("--") && inlineValue !== undefined) {
          const key = option.slice(2);

          if (key.length === 0) {
            throw new CliUsageError("Direct input fields need a name.");
          }

          if (directInput.has(key)) {
            throw new CliUsageError(`--${key} may only be provided once.`);
          }

          directInput.set(key, inlineValue);
          break;
        }

        if (argument.startsWith("--")) {
          throw new CliUsageError(
            `Unknown render option: ${argument}. Pass simple input as --key=value.`,
          );
        }

        if (argument.startsWith("-")) {
          throw new CliUsageError(`Unknown render option: ${argument}`);
        }

        if (printableDirectory !== undefined) {
          throw new CliUsageError("print-page accepts exactly one printable directory.");
        }

        printableDirectory = argument;
    }
  }

  if (printableDirectory === undefined) {
    throw new CliUsageError("print-page requires a printable directory.");
  }

  if (force && outputPath === undefined) {
    throw new CliUsageError("--force requires --output.");
  }

  if (data !== undefined && inputPath !== undefined) {
    throw new CliUsageError("--data and --input cannot be used together.");
  }

  if (directInput.size > 0 && (data !== undefined || inputPath !== undefined)) {
    throw new CliUsageError(
      "--key=value input fields cannot be used with --data or --input.",
    );
  }

  return {
    printableDirectory,
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(data === undefined ? {} : { data }),
    ...(inputPath === undefined ? {} : { inputPath }),
    ...(directInput.size === 0
      ? {}
      : { directInput: Object.fromEntries(directInput) }),
    force,
  };
}

async function loadInput(
  args: RenderArguments,
  services: CliServices,
): Promise<unknown> {
  if (args.data !== undefined) {
    return parseJson(args.data, "--data");
  }

  if (args.directInput !== undefined) {
    return args.directInput;
  }

  if (args.inputPath === undefined) {
    return {};
  }

  let source: string;

  try {
    source = args.inputPath === "-"
      ? await services.readStdin()
      : await services.readInputFile(resolve(args.inputPath));
  } catch (error) {
    const location = args.inputPath === "-" ? "stdin" : args.inputPath;
    throw new Error(`Could not read JSON input from ${location}.`, { cause: error });
  }

  return parseJson(source, args.inputPath === "-" ? "stdin" : "--input");
}

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new CliUsageError(
      `${label} must contain valid JSON: ${describeError(error)}`,
    );
  }
}

function nextValue(
  args: readonly string[],
  index: number,
  flag: string,
  kind: "path" | "json" | "input",
): string {
  const value = args[index];

  if (
    value === undefined
    || CLI_OPTIONS.has(value)
    || (kind === "json" && value.startsWith("--"))
    || (kind !== "json" && value.startsWith("-") && value !== "-")
    || (kind === "path" && value === "-")
  ) {
    throw new CliUsageError(`${flag} requires a value.`);
  }

  return value;
}

function splitInlineOption(argument: string): [string, string | undefined] {
  if (!argument.startsWith("--")) {
    return [argument, undefined];
  }

  const separator = argument.indexOf("=");

  return separator === -1
    ? [argument, undefined]
    : [argument.slice(0, separator), argument.slice(separator + 1)];
}

function setOnce(
  current: string | undefined,
  next: string,
  flag: string,
): string {
  if (current !== undefined) {
    throw new CliUsageError(`${flag} may only be provided once.`);
  }

  return next;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
