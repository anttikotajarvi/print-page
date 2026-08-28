# print-page

`print-page` is a small TypeScript CLI for turning HTML-based printables into PDFs with Chromium. A printable can be plain HTML, a Mustache template, or the compiled output of a browser application.

The complete preliminary design is in [`handoff.md`](./handoff.md).

## Project status

Rendering is implemented. The CLI loads settings and optional preparation code, renders through Chromium using a virtual local origin, returns PDF bytes, and reuses deterministic output from the local cache when enabled. It can write those bytes to a file or directly to redirected stdout.

Host printer integration is intentionally not implemented yet; this CLI produces PDFs only.

The package is marked private until those interfaces and a public license are finalized.

## Printable contract

The smallest printable is a directory containing an `index.html` file:

```text
printable/
  index.html
```

Settings are optional. Their current defaults are:

```json
{
  "entryPoint": "index.html",
  "injectionMode": "mustache",
  "useCache": true,
  "waitForPrintReady": false,
  "timeout": 30000
}
```

A printable can add `settings.json`, an optional `prepare.js`, and any browser assets it needs. The prepare module follows Bun's module rules: use `export default` in an ESM or untyped package scope, or `module.exports` in a CommonJS package scope. Compiled frontend applications remain responsible for their own build and can point `entryPoint` at their generated HTML.

Printables are trusted code, as described in the handoff. Virtual-origin request paths are kept lexically inside the printable, while symlinks created by a printable are intentionally followed rather than treated as a security sandbox.

Nested entry points keep their browser path (for example, `dist/index.html` is
served as `/dist/index.html`), so relative and parent-relative assets continue
to work. Vite-style `/assets/...` URLs are also resolved beside a nested entry
point.

## Development

Bun 1.3.14 or newer is required.

```bash
bun install
bunx playwright install chromium
bun run check
```

Useful scripts:

- `bun run dev` runs the CLI directly from TypeScript.
- `bun test` runs the unit tests.
- `bun run typecheck` checks all source and test files.
- `bun run build` emits the package to `dist/`.
- `bun run check` runs the complete local validation sequence.

Set `PRINT_PAGE_E2E=1` after installing Chromium to include the optional browser integration test:

```bash
PRINT_PAGE_E2E=1 bun test test/render.e2e.test.ts
```

Set `PRINT_PAGE_CHROMIUM_EXECUTABLE` as well when testing against an already-installed Chrome or Chromium binary instead of Playwright's managed browser.

After building, the binary smoke test is:

```bash
bun dist/bin.js --help
```

## CLI

```text
print-page <printable-directory> [--output <pdf-path>] [options]
```

Options:

- `-o, --output <path>` writes the PDF to a file. The file is not replaced unless `--force` is provided.
- Without `--output`, the PDF is written as raw bytes to stdout. Stdout must be redirected or piped; print-page refuses to write binary PDF data to an interactive terminal.
- `--key=value` supplies a simple string input field; repeat it for each field.
- `-d, --data <json>` supplies literal JSON.
- `-i, --input <path>` reads JSON from a file; use `-` for stdin.
- `-f, --force` permits replacement of an existing output PDF and requires `--output`.
- `-h, --help` shows CLI help; `-v, --version` prints the version.

The former `print-page render <printable-directory>` form remains accepted for
existing scripts, but new commands can omit `render`.

When PDF bytes go to stdout, stdout contains only the PDF. Errors, status
messages, and other diagnostics are written to stderr.

```bash
# Write a file.
bun run dev -- ./examples/label --output ./label.pdf \
  --data '{"productName":"Example Curtain"}'

# Stream directly to a file or printer.
bun run dev -- ./examples/label --data '{"productName":"Example Curtain"}' \
  > ./label.pdf
bun run dev -- ./examples/label --data '{"productName":"Example Curtain"}' \
  | lp -d GODEX_MEDIUM -
```

### Passing input

Choose exactly one input form. Input is passed to `prepare.js`, when present.
In the default `mustache` mode, fields become the template context (for
example, `{{name}}`). With `"injectionMode": "window"`, the same data is
available as `window.__PRINT_DATA__`.

```bash
# Simple string fields. Quote values containing spaces or shell-special characters.
bun run dev -- ./examples/label -o ./label.pdf \
  --productName="Example Curtain" --referenceId=ABC-123

# Typed or structured data.
bun run dev -- ./examples/label -o ./label.pdf \
  --data '{"productName":"Example Curtain","copies":2}'

# JSON from stdin.
printf '%s\n' '{"productName":"Example Curtain"}' \
  | bun run dev -- ./examples/label -o ./label.pdf --input -
```

`--productName="Example Curtain"` produces
`{ "productName": "Example Curtain" }`. Direct-field values are always
strings and keys are preserved exactly; use `--data` or `--input` for numbers,
booleans, `null`, arrays, or nested objects. Direct fields, `--data`, and
`--input` cannot be combined. Built-in option names, such as `--output`, are
reserved, and duplicate direct-field names are rejected.

The renderer uses a Playwright-managed Chromium. Install it once with `bunx playwright install chromium`. Printable CSS controls page size and margins; A4 is the fallback when CSS does not define a page size.

Caching follows each printable's `useCache` setting (enabled by default). Cache entries are stored under `$XDG_CACHE_HOME/print-page`, or `~/.cache/print-page` when XDG is not set. The cache key combines the input, effective settings, renderer version, and printable files; it deliberately does not try to track external dependencies.

## Source layout

```text
src/
  bin.ts             executable package entry point
  cli.ts             argument handling
  settings.ts        defaults, loading, and validation
  prepare.ts         optional prepare.js execution
  inject.ts          Mustache and window-data injection
  virtual-origin.ts  virtual-origin resource mapping
  render.ts          Playwright renderer and PDF byte flow
  cache.ts           deterministic filesystem cache
  print.ts           future host-printer boundary
```
