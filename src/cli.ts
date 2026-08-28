import { readFileSync } from "node:fs";

interface PackageMetadata {
  version: string;
}

const packageMetadata = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as PackageMetadata;

export const VERSION = packageMetadata.version;

const HELP = `print-page ${VERSION}

Render HTML-based printables with Chromium.

Usage:
  print-page --help
  print-page --version

Options:
  -h, --help     Show this help
  -v, --version  Show the version

The render and print command interface is not finalized in this scaffold.
`;

export interface CliIo {
  stdout: CliWriter;
  stderr: CliWriter;
}

export interface CliWriter {
  write(value: string): unknown;
}

export function runCli(
  args: readonly string[],
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
): number {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    io.stdout.write(HELP);
    return 0;
  }

  if (args.includes("--version") || args.includes("-v")) {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }

  io.stderr.write(`Unknown argument: ${args[0]}\nRun print-page --help for usage.\n`);
  return 1;
}
