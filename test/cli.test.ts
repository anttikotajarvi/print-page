import assert from "node:assert/strict";
import test from "node:test";

import { runCli, VERSION } from "../src/cli.js";

function run(args: readonly string[]): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runCli(args, {
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: (value) => stderr.push(value) },
  });

  return {
    code,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

test("runCli shows help when called without arguments", () => {
  const result = run([]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage:/u);
  assert.equal(result.stderr, "");
});

test("runCli reports its version", () => {
  const result = run(["--version"]);

  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${VERSION}\n`);
  assert.equal(result.stderr, "");
});

test("runCli rejects an unknown argument", () => {
  const result = run(["render"]);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown argument: render/u);
});
