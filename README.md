# print-page

`print-page` is a small TypeScript CLI for turning HTML-based printables into PDFs with Chromium. A printable can be plain HTML, a Mustache template, or the compiled output of a browser application.

The complete preliminary design is in [`handoff.md`](./handoff.md).

## Project status

This repository currently contains the implementation skeleton. It establishes the package, CLI binary, strict TypeScript setup, CI, core settings and data-preparation behavior, injection primitives, virtual-origin file loading, and the boundaries for rendering, caching, and host printing.

The exact render/print CLI commands, cache storage policy, and printer backends are intentionally not fixed yet because those interfaces are still open in the design handoff.

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

A printable can add `settings.json`, an optional `prepare.js`, and any browser assets it needs. The prepare module follows Node's normal package rules: use `export default` in an ESM or untyped package scope, or `module.exports` in a CommonJS package scope. Compiled frontend applications remain responsible for their own build and can point `entryPoint` at their generated HTML.

Printables are trusted code, as described in the handoff. Virtual-origin request paths are kept lexically inside the printable, while symlinks created by a printable are intentionally followed rather than treated as a security sandbox.

## Development

Node.js 22.7 or newer is required. npm is the canonical lockfile workflow; Bun can consume the same project.

```bash
npm install
npm run check
```

Equivalent Bun commands are below. npm's `package-lock.json` remains canonical, so Bun's generated lockfile is ignored.

```bash
bun install
bun run check
```

Useful scripts:

- `npm run dev` runs the CLI directly from TypeScript.
- `npm test` runs the unit tests.
- `npm run typecheck` checks all source and test files.
- `npm run build` emits the package to `dist/`.
- `npm run check` runs the complete local validation sequence.

After building, the binary smoke test is:

```bash
node dist/bin.js --help
```

## Source layout

```text
src/
  bin.ts             executable package entry point
  cli.ts             argument handling
  settings.ts        defaults, loading, and validation
  prepare.ts         optional prepare.js execution
  inject.ts          Mustache and window-data injection
  virtual-origin.ts  virtual-origin resource mapping
  render.ts          browser-renderer boundary
  cache.ts           render-cache boundary
  print.ts           host-printer boundary
```
