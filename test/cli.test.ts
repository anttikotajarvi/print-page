import { afterEach, expect, test } from "bun:test";
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runCli,
  VERSION,
  type CliServices,
} from "../src/cli.js";
import type { RenderOptions } from "../src/render.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const pdf = encoder.encode("%PDF-1.7\nfake PDF\n");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function run(
  args: readonly string[],
  services = defaultServices(),
  isTTY = false,
): Promise<{
  code: number;
  stdout: Uint8Array;
  stderr: string;
}> {
  const stdout: Uint8Array[] = [];
  const stderr: string[] = [];
  const code = await runCli(
    args,
    {
      stdout: {
        isTTY,
        write: (value) => stdout.push(toBytes(value)),
      },
      stderr: { write: (value) => stderr.push(String(value)) },
    },
    services,
  );

  return {
    code,
    stdout: joinBytes(stdout),
    stderr: stderr.join(""),
  };
}

test("runCli shows help when called without arguments", async () => {
  const result = await run([]);

  expect(result.code).toBe(0);
  expect(text(result.stdout)).toMatch(/Usage:/u);
  expect(result.stderr).toBe("");
});

test("runCli reports its version", async () => {
  const result = await run(["--version"]);

  expect(result.code).toBe(0);
  expect(text(result.stdout)).toBe(`${VERSION}\n`);
  expect(result.stderr).toBe("");
});

test("runCli renders when the printable directory is the first argument", async () => {
  let received: RenderOptions | undefined;
  const result = await run([`${fixtures}/minimal`], defaultServices({
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));

  expect(result.code).toBe(0);
  expect(result.stdout).toEqual(pdf);
  expect(result.stderr).toBe("");
  expect(received).toEqual({
    printableDirectory: resolve(`${fixtures}/minimal`),
    input: {},
  });
});

test("runCli shows help for the default command and accepts the legacy alias", async () => {
  const result = await run(["--help"]);
  const legacyResult = await run(["render", "--help"]);

  expect(result.code).toBe(0);
  expect(text(result.stdout)).toMatch(/print-page <printable-directory>/u);
  expect(text(result.stdout)).toMatch(/\[--output <pdf-path>\]/u);
  expect(text(result.stdout)).toMatch(/--<key>=<value>/u);
  expect(text(result.stdout)).toMatch(/--preset <name>/u);
  expect(text(result.stdout)).toMatch(/--name="John Doe"/u);
  expect(result.stderr).toBe("");
  expect(legacyResult).toEqual(result);
});

test("runCli writes raw PDF bytes to redirected stdout", async () => {
  let received: RenderOptions | undefined;
  const result = await run([
    `${fixtures}/minimal`,
    "-d",
    '{"name":"Ada"}',
  ], defaultServices({
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));

  expect(result.code).toBe(0);
  expect(result.stdout).toEqual(pdf);
  expect(result.stderr).toBe("");
  expect(received).toEqual({
    printableDirectory: resolve(`${fixtures}/minimal`),
    input: { name: "Ada" },
  });
});

test("runCli writes PDF bytes to --output and keeps stdout empty", async () => {
  const directory = await temporaryDirectory();
  const outputPath = join(directory, "nested", "card.pdf");
  let received: RenderOptions | undefined;
  const result = await run([
    `${fixtures}/minimal`,
    "-o",
    outputPath,
    "-d",
    '{"name":"Ada"}',
  ], defaultServices({
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));

  expect(result.code).toBe(0);
  expect(result.stdout).toEqual(new Uint8Array());
  expect(result.stderr).toBe(`Wrote ${outputPath}\n`);
  expect(await readFile(outputPath)).toEqual(Buffer.from(pdf));
  expect(received).toEqual({
    printableDirectory: resolve(`${fixtures}/minimal`),
    input: { name: "Ada" },
  });
});

test("runCli parses direct string input fields", async () => {
  let received: RenderOptions | undefined;
  const result = await run([
    `${fixtures}/minimal`,
    "--name=John Doe",
    "--referenceId=ABC-123",
    "--note=contains=equals",
    "--empty=",
  ], defaultServices({
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));

  expect(result.code).toBe(0);
  expect(result.stdout).toEqual(pdf);
  expect(received?.input).toEqual({
    name: "John Doe",
    referenceId: "ABC-123",
    note: "contains=equals",
    empty: "",
  });
});

test("runCli reads JSON input from stdin", async () => {
  let received: RenderOptions | undefined;
  const result = await run([
    `${fixtures}/minimal`,
    "-i",
    "-",
  ], defaultServices({
    readStdin: async () => '{"name":"Ada"}',
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));

  expect(result.code).toBe(0);
  expect(received?.input).toEqual({ name: "Ada" });
});

test("runCli reads JSON input from a file", async () => {
  let received: RenderOptions | undefined;
  let requestedPath: string | undefined;
  const result = await run([
    `${fixtures}/minimal`,
    "-i",
    "input.json",
  ], defaultServices({
    readInputFile: async (path) => {
      requestedPath = path;
      return '{"name":"Ada"}';
    },
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));

  expect(result.code).toBe(0);
  expect(requestedPath).toBe(resolve("input.json"));
  expect(received?.input).toEqual({ name: "Ada" });
});

test("runCli loads a template-local preset", async () => {
  const printableDirectory = `${fixtures}/minimal`;
  const presetPath = join(
    resolve(printableDirectory),
    "presets",
    "repair-kit.json",
  );
  const requestedPaths: string[] = [];
  let received: RenderOptions | undefined;
  const result = await run([
    "render",
    printableDirectory,
    "--preset",
    "repair-kit",
  ], defaultServices({
    readInputFile: async (path) => {
      requestedPaths.push(path);
      return '{"name":"Repair kit","quantity":4}';
    },
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(requestedPaths).toEqual([presetPath]);
  expect(received?.input).toEqual({ name: "Repair kit", quantity: 4 });
});

test("runCli applies JSON additions and overrides to a fixture preset", async () => {
  const printableDirectory = `${fixtures}/package-label`;
  let received: RenderOptions | undefined;
  const result = await run([
    "render",
    printableDirectory,
    "--preset",
    "repair-kit",
    "--data",
    '{"quantity":2,"reference":"RPK-42"}',
  ], defaultServices({
    readInputFile: async (path) => readFile(path, "utf8"),
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));

  expect(result.code).toBe(0);
  expect(received?.input).toEqual({
    name: "Repair kit",
    quantity: 2,
    destination: "Workshop",
    reference: "RPK-42",
  });
});

test("runCli lets direct fields override a template-local preset", async () => {
  const printableDirectory = `${fixtures}/minimal`;
  let received: RenderOptions | undefined;
  const result = await run([
    printableDirectory,
    "--preset",
    "repair-kit",
    "--name=Custom kit",
    "--quantity=2",
  ], defaultServices({
    readInputFile: async () =>
      '{"name":"Repair kit","quantity":4,"keep":"preset"}',
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));

  expect(result.code).toBe(0);
  expect(received?.input).toEqual({
    name: "Custom kit",
    quantity: "2",
    keep: "preset",
  });
});

test("runCli shallowly merges JSON data with a template-local preset", async () => {
  const printableDirectory = `${fixtures}/minimal`;
  let received: RenderOptions | undefined;
  const result = await run([
    printableDirectory,
    "--preset",
    "repair-kit",
    "--data",
    '{"name":"Custom kit","settings":{"colour":"blue"},"added":true}',
  ], defaultServices({
    readInputFile: async () =>
      '{"name":"Repair kit","keep":"preset","settings":{"colour":"red","size":"large"}}',
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));

  expect(result.code).toBe(0);
  expect(received?.input).toEqual({
    name: "Custom kit",
    keep: "preset",
    settings: { colour: "blue" },
    added: true,
  });
});

test("runCli lets JSON input files override a template-local preset", async () => {
  const printableDirectory = `${fixtures}/minimal`;
  const presetPath = join(
    resolve(printableDirectory),
    "presets",
    "repair-kit.json",
  );
  const inputPath = resolve("override.json");
  const requestedPaths: string[] = [];
  let received: RenderOptions | undefined;
  const result = await run([
    printableDirectory,
    "--preset",
    "repair-kit",
    "--input",
    "override.json",
  ], defaultServices({
    readInputFile: async (path) => {
      requestedPaths.push(path);

      if (path === presetPath) {
        return '{"name":"Repair kit","keep":"preset"}';
      }

      if (path === inputPath) {
        return '{"name":"Custom kit","added":true}';
      }

      throw new Error(`Unexpected input path: ${path}`);
    },
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));

  expect(result.code).toBe(0);
  expect(requestedPaths).toHaveLength(2);
  expect(requestedPaths).toContain(presetPath);
  expect(requestedPaths).toContain(inputPath);
  expect(received?.input).toEqual({
    name: "Custom kit",
    keep: "preset",
    added: true,
  });
});

test("runCli preserves arbitrary JSON roots for template-local presets", async () => {
  const printableDirectory = `${fixtures}/minimal`;
  const cases = [
    {
      args: ["--preset", "repair-kit"],
      preset: '["preset"]',
      expected: ["preset"],
    },
    {
      args: ["--preset", "repair-kit", "--data", '["override"]'],
      preset: '{"from":"preset"}',
      expected: ["override"],
    },
    {
      args: ["--preset", "repair-kit", "--data", '{"from":"input"}'],
      preset: '["preset"]',
      expected: { from: "input" },
    },
  ] as const;

  for (const { args, preset, expected } of cases) {
    let received: RenderOptions | undefined;
    const result = await run([
      printableDirectory,
      ...args,
    ], defaultServices({
      readInputFile: async () => preset,
      render: async (options) => {
        received = options;
        return pdf;
      },
    }));

    expect(result.code).toBe(0);
    expect(received?.input).toEqual(expected);
  }
});

test("runCli rejects unsafe template-local preset names", async () => {
  const printableDirectory = `${fixtures}/minimal`;
  const invalidArguments = [
    ["--preset", ""],
    ["--preset="],
    ["--preset", "."],
    ["--preset", ".."],
    ["--preset", "repair/kit"],
    ["--preset", "repair\\kit"],
    ["--preset", "repair\u0000kit"],
  ] as const;

  for (const args of invalidArguments) {
    let readCount = 0;
    let renderCount = 0;
    const result = await run([
      printableDirectory,
      ...args,
    ], defaultServices({
      readInputFile: async () => {
        readCount += 1;
        return "{}";
      },
      render: async () => {
        renderCount += 1;
        return pdf;
      },
    }));

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/preset/u);
    expect(readCount).toBe(0);
    expect(renderCount).toBe(0);
  }
});

test("runCli reports missing, duplicate, unreadable, and invalid presets", async () => {
  const printableDirectory = `${fixtures}/minimal`;
  let renderCount = 0;
  const missing = await run([
    printableDirectory,
    "--preset",
  ], defaultServices({
    render: async () => {
      renderCount += 1;
      return pdf;
    },
  }));
  const duplicate = await run([
    printableDirectory,
    "--preset",
    "repair-kit",
    "--preset",
    "mounting-parts",
  ], defaultServices({
    render: async () => {
      renderCount += 1;
      return pdf;
    },
  }));
  const unreadable = await run([
    printableDirectory,
    "--preset",
    "repair-kit",
  ], defaultServices({
    readInputFile: async () => {
      throw new Error("permission denied");
    },
    render: async () => {
      renderCount += 1;
      return pdf;
    },
  }));
  const invalidJson = await run([
    printableDirectory,
    "--preset",
    "repair-kit",
  ], defaultServices({
    readInputFile: async () => "not-json",
    render: async () => {
      renderCount += 1;
      return pdf;
    },
  }));

  expect(missing.code).toBe(2);
  expect(missing.stderr).toMatch(/--preset requires a value/u);
  expect(duplicate.code).toBe(2);
  expect(duplicate.stderr).toMatch(/--preset may only be provided once/u);
  expect(unreadable.code).toBe(1);
  expect(unreadable.stderr).toMatch(/Could not read preset/u);
  expect(invalidJson.code).toBe(2);
  expect(invalidJson.stderr).toMatch(/preset "repair-kit" must contain valid JSON/u);
  expect(renderCount).toBe(0);
});

test("runCli defaults data to an empty object and keeps force at the output edge", async () => {
  const directory = await temporaryDirectory();
  const outputPath = join(directory, "out.pdf");
  let received: RenderOptions | undefined;
  const result = await run([
    `${fixtures}/minimal`,
    "-o",
    outputPath,
    "-f",
  ], defaultServices({
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));

  expect(result.code).toBe(0);
  expect(received).toEqual({
    printableDirectory: resolve(`${fixtures}/minimal`),
    input: {},
  });
  expect(await readFile(outputPath)).toEqual(Buffer.from(pdf));
});

test("runCli rejects invalid or conflicting render input", async () => {
  const invalid = await run([
    "render",
    `${fixtures}/minimal`,
    "--data",
    "not-json",
  ]);
  const conflicting = await run([
    "render",
    `${fixtures}/minimal`,
    "--data",
    "{}",
    "--input",
    "input.json",
  ]);
  const directDataConflict = await run([
    "render",
    `${fixtures}/minimal`,
    "--name=Ada",
    "--data",
    "{}",
  ]);
  const directInputConflict = await run([
    "render",
    `${fixtures}/minimal`,
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

test("runCli rejects missing option values and invalid render options", async () => {
  const missingOutputValue = await run([
    "render",
    `${fixtures}/minimal`,
    "-o",
    "--force",
  ]);
  const missingInputValue = await run([
    "render",
    `${fixtures}/minimal`,
    "--input",
    "--force",
  ]);
  const unknownOption = await run([
    "render",
    `${fixtures}/minimal`,
    "--unknown",
  ]);
  const bareDirectInput = await run([
    "render",
    `${fixtures}/minimal`,
    "--name",
  ]);
  const duplicateDirectInput = await run([
    "render",
    `${fixtures}/minimal`,
    "--name=Ada",
    "--name=Grace",
  ]);
  const forceWithoutOutput = await run([
    "render",
    `${fixtures}/minimal`,
    "--force",
  ]);

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
  expect(forceWithoutOutput.code).toBe(2);
  expect(forceWithoutOutput.stderr).toMatch(/--force requires --output/u);
});

test("runCli accepts negative JSON values and reports input read failures", async () => {
  let received: RenderOptions | undefined;
  const negativeJson = await run([
    "render",
    `${fixtures}/minimal`,
    "--data",
    "-1",
  ], defaultServices({
    render: async (options) => {
      received = options;
      return pdf;
    },
  }));
  const unreadable = await run([
    "render",
    `${fixtures}/minimal`,
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
  expect(unreadable.stdout).toEqual(new Uint8Array());
  expect(unreadable.stderr).toMatch(/Could not read JSON input/u);
});

test("runCli refuses PDF output to an interactive terminal", async () => {
  let renderCount = 0;
  const result = await run([
    "render",
    `${fixtures}/minimal`,
  ], defaultServices({
    render: async () => {
      renderCount += 1;
      return pdf;
    },
  }), true);

  expect(result.code).toBe(2);
  expect(result.stdout).toEqual(new Uint8Array());
  expect(result.stderr).toBe(
    "print-page: PDF output requires --output <path> or redirected stdout.\n",
  );
  expect(renderCount).toBe(0);
});

test("runCli preserves output overwrite protection", async () => {
  const directory = await temporaryDirectory();
  const outputPath = join(directory, "existing.pdf");
  let renderCount = 0;
  await writeFile(outputPath, "old PDF");
  const services = defaultServices({
    render: async () => {
      renderCount += 1;
      return pdf;
    },
  });

  const refused = await run([
    "render",
    `${fixtures}/minimal`,
    "--output",
    outputPath,
  ], services);
  const replaced = await run([
    "render",
    `${fixtures}/minimal`,
    "--output",
    outputPath,
    "--force",
  ], services);

  expect(refused.code).toBe(1);
  expect(refused.stdout).toEqual(new Uint8Array());
  expect(refused.stderr).toMatch(/already exists; use --force/u);
  expect(renderCount).toBe(1);
  expect(replaced.code).toBe(0);
  expect(replaced.stdout).toEqual(new Uint8Array());
  expect(await readFile(outputPath)).toEqual(Buffer.from(pdf));
});

test.skipIf(process.platform === "win32")(
  "runCli does not follow a dangling output symlink without force",
  async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "target.pdf");
    const outputPath = join(directory, "output.pdf");
    await symlink(targetPath, outputPath);
    const services = defaultServices({ render: async () => pdf });

    const refused = await run([
      "render",
      `${fixtures}/minimal`,
      "--output",
      outputPath,
    ], services);
    expect(refused.code).toBe(1);
    expect(await Bun.file(targetPath).exists()).toBe(false);
    expect((await lstat(outputPath)).isSymbolicLink()).toBe(true);

    const replaced = await run([
      "render",
      `${fixtures}/minimal`,
      "--output",
      outputPath,
      "--force",
    ], services);

    expect(replaced.code).toBe(0);
    expect((await lstat(outputPath)).isSymbolicLink()).toBe(false);
    expect(await Bun.file(targetPath).exists()).toBe(false);
    expect(await readFile(outputPath)).toEqual(Buffer.from(pdf));
  },
);

test("runCli sends render failures to stderr without emitting PDF bytes", async () => {
  const directory = await temporaryDirectory();
  const outputPath = join(directory, "failed.pdf");
  const result = await run([
    "render",
    `${fixtures}/minimal`,
    "--output",
    outputPath,
  ], defaultServices({
    render: async () => {
      throw new Error("browser failed");
    },
  }));

  expect(result.code).toBe(1);
  expect(result.stdout).toEqual(new Uint8Array());
  expect(result.stderr).toMatch(/browser failed/u);
  expect(await Bun.file(outputPath).exists()).toBe(false);
});

function defaultServices(
  overrides: Partial<CliServices> = {},
): CliServices {
  return {
    render: async () => pdf,
    readInputFile: async () => "{}",
    readStdin: async () => "{}",
    ...overrides,
  };
}

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string"
    ? encoder.encode(value)
    : new Uint8Array(value);
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function text(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "print-page-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}
