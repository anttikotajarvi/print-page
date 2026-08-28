import { resolve } from "node:path";

import {
  renderToFile,
  type RenderResult,
  type RenderToFileOptions,
} from "./render.js";
import { VERSION } from "./version.js";

export { VERSION } from "./version.js";

const HELP = `print-page ${VERSION}

Render HTML-based printables with Chromium.

Usage:
  print-page render <printable-directory> --output <pdf-path> [options]

Commands:
  render  Render a printable to PDF

Options:
  -h, --help     Show help
  -v, --version  Show the version

Run "print-page render --help" for render options.
`;

const RENDER_HELP = `Usage:
  print-page render <printable-directory> --output <pdf-path> [options]

Options:
  -o, --output <path>  Required PDF output path
  --<key>=<value>      Simple string input field; repeat as needed
  -d, --data <json>    Literal JSON input
  -i, --input <path>   JSON input file; use - to read stdin
  -f, --force          Replace an existing output file
  -h, --help           Show this help

Choose one input form: --key=value fields, --data, or --input. Direct fields
are strings; use JSON for typed or nested values. With no input option, the
printable receives {}.

Example:
  print-page render ./label -o ./label.pdf --name="John Doe"

Page size and margins are controlled by printable CSS.
`;

const RENDER_OPTIONS = new Set([
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
  write(value: string): unknown;
}

export interface CliServices {
  render(options: RenderToFileOptions): Promise<RenderResult>;
  readInputFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
}

interface RenderArguments {
  printableDirectory: string;
  outputPath: string;
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
  render: renderToFile,
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

    if (args[0] !== "render") {
      throw new CliUsageError(`Unknown command: ${args[0]}`);
    }

    if (args.slice(1).includes("--help") || args.slice(1).includes("-h")) {
      io.stdout.write(RENDER_HELP);
      return 0;
    }

    const renderArguments = parseRenderArguments(args.slice(1));
    const input = await loadInput(renderArguments, services);
    const result = await services.render({
      printableDirectory: resolve(renderArguments.printableDirectory),
      outputPath: resolve(renderArguments.outputPath),
      input,
      force: renderArguments.force,
    });

    io.stdout.write(`Wrote ${result.outputPath}\n`);
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
          throw new CliUsageError("render accepts exactly one printable directory.");
        }

        printableDirectory = argument;
    }
  }

  if (printableDirectory === undefined) {
    throw new CliUsageError("render requires a printable directory.");
  }

  if (outputPath === undefined) {
    throw new CliUsageError("render requires -o or --output.");
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
    outputPath,
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
    || RENDER_OPTIONS.has(value)
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
