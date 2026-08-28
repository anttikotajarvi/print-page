import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runCli,
  VERSION,
  type CliServices,
} from "../src/cli.js";
import type { RenderToFileOptions } from "../src/render.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

async function run(
  args: readonly string[],
  services = defaultServices(),
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(
    args,
    {
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: (value) => stderr.push(value) },
    },
    services,
  );

  return {
    code,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

test("runCli shows help when called without arguments", async () => {
  const result = await run([]);

  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/Usage:/u);
  expect(result.stderr).toBe("");
});

test("runCli reports its version", async () => {
  const result = await run(["--version"]);

  expect(result.code).toBe(0);
  expect(result.stdout).toBe(`${VERSION}\n`);
  expect(result.stderr).toBe("");
});

test("runCli rejects an unknown command", async () => {
  const result = await run(["unknown"]);

  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toMatch(/Unknown command: unknown/u);
});

test("runCli shows render-specific help", async () => {
  const result = await run(["render", "--help"]);

  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/--output <path>/u);
  expect(result.stdout).toMatch(/--<key>=<value>/u);
  expect(result.stdout).toMatch(/--name="John Doe"/u);
  expect(result.stderr).toBe("");
});

test("runCli parses literal JSON and dispatches a render", async () => {
  let received: RenderToFileOptions | undefined;
  const services = defaultServices({
    render: async (options) => {
      received = options;
      return { outputPath: options.outputPath, cacheHit: false };
    },
  });
  const result = await run([
    "render",
    `${fixtures}/minimal`,
    "--output",
    "out.pdf",
    "--data",
    '{"name":"Ada"}',
  ], services);

  expect(result.code).toBe(0);
  expect(result.stdout).toBe(`Wrote ${resolve("out.pdf")}\n`);
  expect(result.stderr).toBe("");
  expect(received).toEqual({
    printableDirectory: resolve(`${fixtures}/minimal`),
    outputPath: resolve("out.pdf"),
    input: { name: "Ada" },
    force: false,
  });
});

test("runCli parses direct string input fields", async () => {
  let received: RenderToFileOptions | undefined;
  const result = await run([
    "render",
    `${fixtures}/minimal`,
    "--output=out.pdf",
    "--name=John Doe",
    "--referenceId=ABC-123",
    "--note=contains=equals",
    "--empty=",
  ], defaultServices({
    render: async (options) => {
      received = options;
      return { outputPath: options.outputPath, cacheHit: false };
    },
  }));

  expect(result.code).toBe(0);
  expect(received?.input).toEqual({
    name: "John Doe",
    referenceId: "ABC-123",
    note: "contains=equals",
    empty: "",
  });
});

test("runCli reads JSON input from stdin", async () => {
  let received: RenderToFileOptions | undefined;
  const result = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--input",
    "-",
  ], defaultServices({
    readStdin: async () => '{"name":"Ada"}',
    render: async (options) => {
      received = options;
      return { outputPath: options.outputPath, cacheHit: false };
    },
  }));

  expect(result.code).toBe(0);
  expect(received?.input).toEqual({ name: "Ada" });
});

test("runCli reads JSON input from a file", async () => {
  let received: RenderToFileOptions | undefined;
  let requestedPath: string | undefined;
  const result = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--input",
    "input.json",
  ], defaultServices({
    readInputFile: async (path) => {
      requestedPath = path;
      return '{"name":"Ada"}';
    },
    render: async (options) => {
      received = options;
      return { outputPath: options.outputPath, cacheHit: false };
    },
  }));

  expect(result.code).toBe(0);
  expect(requestedPath).toBe(resolve("input.json"));
  expect(received?.input).toEqual({ name: "Ada" });
});

test("runCli defaults data to an empty object and forwards force", async () => {
  let received: RenderToFileOptions | undefined;
  const result = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--force",
  ], defaultServices({
    render: async (options) => {
      received = options;
      return { outputPath: options.outputPath, cacheHit: false };
    },
  }));

  expect(result.code).toBe(0);
  expect(received?.input).toEqual({});
  expect(received?.force).toBe(true);
});

test("runCli rejects invalid or conflicting render input", async () => {
  const invalid = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--data",
    "not-json",
  ]);
  const conflicting = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--data",
    "{}",
    "--input",
    "input.json",
  ]);
  const directDataConflict = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--name=Ada",
    "--data",
    "{}",
  ]);
  const directInputConflict = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--name=Ada",
    "--input",
    "input.json",
  ]);

  expect(invalid.code).toBe(2);
  expect(invalid.stderr).toMatch(/--data must contain valid JSON/u);
  expect(conflicting.code).toBe(2);
  expect(conflicting.stderr).toMatch(/cannot be used together/u);
  expect(directDataConflict.code).toBe(2);
  expect(directDataConflict.stderr).toMatch(/cannot be used with --data/u);
  expect(directInputConflict.code).toBe(2);
  expect(directInputConflict.stderr).toMatch(/cannot be used with --data or --input/u);
});

test("runCli rejects missing option values and render options", async () => {
  const missingOutputValue = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "--force",
  ]);
  const missingInputValue = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--input",
    "--force",
  ]);
  const unknownOption = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--unknown",
  ]);
  const bareDirectInput = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--name",
  ]);
  const duplicateDirectInput = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--name=Ada",
    "--name=Grace",
  ]);
  const missingOutput = await run(["render", `${fixtures}/minimal`]);

  expect(missingOutputValue.code).toBe(2);
  expect(missingOutputValue.stderr).toMatch(/-o requires a value/u);
  expect(missingInputValue.code).toBe(2);
  expect(missingInputValue.stderr).toMatch(/--input requires a value/u);
  expect(unknownOption.code).toBe(2);
  expect(unknownOption.stderr).toMatch(/Unknown render option: --unknown/u);
  expect(bareDirectInput.code).toBe(2);
  expect(bareDirectInput.stderr).toMatch(/--key=value/u);
  expect(duplicateDirectInput.code).toBe(2);
  expect(duplicateDirectInput.stderr).toMatch(/--name may only be provided once/u);
  expect(missingOutput.code).toBe(2);
  expect(missingOutput.stderr).toMatch(/requires -o or --output/u);
});

test("runCli accepts negative JSON values and reports input read failures", async () => {
  let received: RenderToFileOptions | undefined;
  const negativeJson = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--data",
    "-1",
  ], defaultServices({
    render: async (options) => {
      received = options;
      return { outputPath: options.outputPath, cacheHit: false };
    },
  }));
  const unreadable = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "out.pdf",
    "--input",
    "missing.json",
  ], defaultServices({
    readInputFile: async () => {
      throw new Error("permission denied");
    },
  }));

  expect(negativeJson.code).toBe(0);
  expect(received?.input).toBe(-1);
  expect(unreadable.code).toBe(1);
  expect(unreadable.stderr).toMatch(/Could not read JSON input/u);
});

function defaultServices(
  overrides: Partial<CliServices> = {},
): CliServices {
  return {
    render: async (options) => ({ outputPath: options.outputPath, cacheHit: false }),
    readInputFile: async () => "{}",
    readStdin: async () => "{}",
    ...overrides,
  };
}
