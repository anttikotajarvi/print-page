# print-page — Preliminary Design Handoff

## Status

This is the current working design for **print-page**.

The goal is a small generic CLI for rendering and printing HTML-based documents locally or on a server.

The system should remain intentionally lightweight. It should support very simple static printables without forcing infrastructure onto them, while still allowing richer browser-native documents such as Svelte applications with canvas rendering.

The central contract is:

> **A printable ultimately resolves to an HTML document that Chromium can open.**

How that HTML was authored is outside the core concern of print-page.

---

# 1. Goals

print-page should support:

* static HTML
* HTML with simple value replacement
* HTML with preprocessing and derived values
* browser-native rendering such as canvas
* compiled browser applications such as Svelte/Vite
* PDF generation
* local printing
* local development
* server-side rendering
* caching for deterministic output
* multiple independent repositories containing printables

The project should be generic enough to publish publicly without becoming a large framework or template ecosystem.

---

# 2. Fundamental Printable Contract

A printable is fundamentally an HTML entry point plus any resources it needs.

The simplest possible printable is:

```txt
printable/
  index.html
```

For example:

```html
<!doctype html>
<html>
  <body>
    Static instructions.
  </body>
</html>
```

There is no separate "static template" concept.

A static document is simply a printable whose HTML contains no substitutions and which receives no meaningful input.

Likewise, richer printables may contain:

```txt
printable/
  index.html
  prepare.js
  style.css
  render.js
  images/
  ...
```

Or they may point to compiled application output:

```txt
printable/
  settings.json

  src/
    App.svelte

  dist/
    index.html
    assets/
      ...
```

The common boundary remains HTML.

---

# 3. HTML Is the System Boundary

print-page should not fundamentally understand:

```txt
Svelte
React
TypeScript
Vite
PHP
Pkl
canvas libraries
private frontend packages
application-specific build systems
```

It understands the browser-facing result:

```txt
HTML + browser resources
```

For example:

```txt
Svelte source
    ↓
Vite build
    ↓
dist/index.html + assets
    ↓
print-page
    ↓
Chromium
    ↓
PDF / printer
```

This allows template repositories to choose their own implementation technology without coupling themselves tightly to print-page.

It also allows print-page itself and collections of printables to live in separate repositories.

---

# 4. One Rendering System, Different Data Injection Mechanisms

The public model should not classify printables as:

```txt
static
dynamic
document
app
```

Those terms may still be useful internally when discussing different usage patterns, but they should not be required concepts for template authors.

Instead, print-page exposes the actual behaviors it needs to know.

The main distinction is:

```txt
How is input supplied to the HTML/browser?
```

That is expressed through:

```txt
injectionMode
```

Current values:

```txt
mustache
window
```

---

# 5. Default Settings

All settings should be optional.

Current defaults:

```json
{
  "entryPoint": "index.html",
  "injectionMode": "mustache",
  "useCache": true,
  "waitForPrintReady": false,
  "timeout": 30000
}
```

Therefore this is already a complete printable:

```txt
label/
  index.html
```

No settings file is required unless the printable needs behavior different from the defaults.

---

# 6. `entryPoint`

`entryPoint` specifies which HTML file Chromium should open.

Default:

```json
{
  "entryPoint": "index.html"
}
```

This keeps ordinary printables trivial.

A compiled frontend may instead use:

```json
{
  "entryPoint": "dist/index.html"
}
```

Example:

```txt
greeting-card/
  settings.json

  src/
    App.svelte

  dist/
    index.html
    assets/
      app.js
      app.css
```

print-page does not need to understand how `dist/index.html` was produced.

---

# 7. `injectionMode: "mustache"`

This is the default injection mode.

Pipeline:

```txt
input
  ↓
optional prepare.js
  ↓
prepared context
  ↓
Mustache(entryPoint)
  ↓
HTML
  ↓
Chromium
```

Example input:

```json
{
  "name": "Example Curtain",
  "reference": "ABC-123"
}
```

Template:

```html
<h1>{{name}}</h1>

{{#reference}}
<p>Reference: {{reference}}</p>
{{/reference}}
```

Static HTML uses exactly the same mechanism.

If there are no Mustache expressions, the substitution step simply has no meaningful effect.

Therefore static HTML and basic replacement HTML do not need separate handling.

---

# 8. Why Use Mustache Instead of Manual Replacement

Simple replacement like:

```js
html.replaceAll("{{name}}", value)
```

is initially trivial, but quickly grows requirements such as:

```txt
HTML escaping
missing values
nested properties
arrays
conditional sections
raw HTML
```

At that point print-page would effectively be implementing a template engine.

Using Mustache keeps this functionality small and established while still allowing simple templates to look almost identical to raw string replacement.

It should remain a convenience layer rather than becoming a complex template language.

---

# 9. Optional `prepare.js`

A printable may contain:

```txt
prepare.js
```

Its purpose is to transform supplied input into the context used by the printable.

Example:

```js
export default function prepare(input) {
  return {
    ...input,
    finishedSize: `${input.width} × ${input.height} mm`,
    hasReference: Boolean(input.reference)
  };
}
```

Conceptually:

```txt
input
  ↓
prepare.js
  ↓
prepared context
```

The prepared context then goes into whichever injection mode the printable uses.

`prepare.js` may be synchronous or asynchronous:

```js
export default async function prepare(input) {
  return context;
}
```

No attempt should be made to artificially restrict what it can do.

It may:

```txt
derive fields
format values
map arrays
read files
perform HTTP requests
call libraries
perform arbitrary JavaScript logic
```

The common intended use is deterministic preprocessing, but print-page should not try to police this.

---

# 10. `prepare.js` and Injection Modes

`prepare.js` is independent of how data is injected.

Conceptually:

```txt
                    ┌─ mustache → HTML substitution
input → prepare.js ─┤
                    └─ window   → browser runtime injection
```

This means derived values are computed only once.

For example:

```js
export default async function prepare(input) {
  return {
    ...input,
    finishedSize: `${input.width} × ${input.height} mm`,
    canvasWidth: input.width * 4,
    canvasHeight: input.height * 4
  };
}
```

A Mustache template may use:

```html
<p>{{finishedSize}}</p>
```

while a browser-native renderer may use:

```js
window.__PRINT_DATA__.canvasWidth
```

depending on the configured injection mode.

---

# 11. `injectionMode: "window"`

This mode is intended for browser-native applications or compiled frontend output where rewriting generated HTML is undesirable.

Pipeline:

```txt
input
  ↓
optional prepare.js
  ↓
prepared context
  ↓
Playwright injects browser data
  ↓
load entryPoint unchanged
  ↓
browser application executes
```

Conceptually, print-page exposes:

```js
window.__PRINT_DATA__ = preparedContext;
```

The important part is that the data exists before the application's own JavaScript executes.

A Svelte application can then consume:

```ts
const data = window.__PRINT_DATA__;
```

This avoids modifying generated SPA HTML.

That is preferable because output from tools such as Vite may contain generated:

```txt
script tags
asset hashes
preload links
CSS links
module references
```

and print-page should not assume anything about their exact structure.

---

# 12. Why `injectionMode` Instead of App/Document Types

The distinction is not:

```txt
This is an app.
This is a document.
```

It is:

```txt
How should print-page supply data?
```

For handwritten HTML:

```json
{
  "injectionMode": "mustache"
}
```

is convenient.

For a generated SPA:

```json
{
  "injectionMode": "window"
}
```

is safer.

A handwritten canvas application may also use `window`.

A generated HTML report may use `mustache`.

The setting therefore expresses actual renderer behavior without forcing unnecessary taxonomy onto the user.

Internally it may still be useful to talk about "document-like" and "app-like" printables, but those are implementation or discussion concepts, not part of the public schema.

---

# 13. Browser-Native Rendering

A printable may contain ordinary browser JavaScript.

Example:

```html
<canvas id="artwork"></canvas>

<script type="module" src="./render.js"></script>
```

Browser code can render directly into the canvas before Chromium creates the PDF.

Conceptually:

```txt
input
  ↓
prepare.js
  ↓
browser data
  ↓
HTML
  ↓
browser JS
  ↓
canvas
  ↓
Chromium PDF
```

No intermediate image-generation infrastructure is required.

This is particularly useful for greeting cards or product sheets that already have canvas-based rendering components.

---

# 14. Svelte / Vite Printables

A complex printable may simply be a normal SPA build.

Example:

```txt
greeting-card/
  package.json
  vite.config.ts
  settings.json

  src/
    main.ts
    App.svelte

  index.html

  dist/
    index.html
    assets/
      ...
```

The application may depend during build time on private packages:

```txt
private canvas renderer package
        ↓
Svelte components
        ↓
Vite
        ↓
browser bundle
```

The resulting deployed printable is simply:

```txt
dist/index.html
dist/assets/*
```

print-page does not need access to the private package if the application has already been built.

Typical settings:

```json
{
  "entryPoint": "dist/index.html",
  "injectionMode": "window",
  "useCache": false,
  "waitForPrintReady": true
}
```

The pipeline becomes:

```txt
input
  ↓
optional prepare.js
  ↓
prepared context
  ↓
window injection
  ↓
dist/index.html
  ↓
Svelte application
  ↓
canvas rendering
  ↓
print-ready signal
  ↓
Chromium PDF
```

This is intentionally just a normal frontend application from Svelte/Vite's perspective.

---

# 15. Svelte Build Responsibility

print-page should not initially own the Svelte build process.

The template repository can simply do:

```bash
npm run build
```

or:

```bash
bun run build
```

and then point print-page at:

```txt
dist/index.html
```

This keeps print-page independent from:

```txt
Svelte compiler versions
Vite versions
private package authentication
frontend dependency resolution
framework-specific configuration
```

A convenience build hook may be added later if real usage justifies it, but it should not be fundamental to the architecture.

---

# 16. Useful Emergent Behavior of Browser-Native Templates

Keeping the frontend application separate has useful emergent behavior.

A browser-native printable can often be run directly through its normal development environment:

```bash
bun run dev
```

or:

```bash
npm run dev
```

and inspected with ordinary browser developer tools.

For example, the Svelte application may use development fallback data when `window.__PRINT_DATA__` does not exist.

This allows:

```txt
normal frontend development
live reload
browser inspection
canvas debugging
component development
```

without requiring print-page to participate in every development cycle.

print-page then becomes the production rendering environment rather than the application framework.

This property should be preserved.

---

# 17. Playwright Virtual Origin

Printables should not require a real localhost HTTP server.

Instead, Playwright can expose the printable to Chromium through a virtual origin.

For example, Chromium believes it is loading:

```txt
http://print.local/index.html
```

Playwright intercepts requests under that origin and fulfills them from files in the printable.

Conceptually:

```txt
Chromium requests:

  http://print.local/index.html
  http://print.local/assets/app.js
  http://print.local/style.css

Playwright resolves:

  index.html
  assets/app.js
  style.css
```

Nothing actually listens on a TCP port.

There is:

```txt
no local HTTP daemon
no temporary server process
no port allocation
```

Chromium simply sees normal HTTP-style resources.

---

# 18. Why the Virtual Origin Is Useful

This avoids many problems associated with:

```txt
file://
```

while also avoiding actual server infrastructure.

It gives normal browser behavior for:

```txt
ES modules
relative URLs
CSS
fonts
images
Vite-generated asset references
browser origin behavior
```

Actual external HTTP requests may proceed normally unless print-page explicitly intercepts them.

The virtual-origin approach should be the common browser-loading mechanism for all printables.

---

# 19. Universal Browser Rendering Path

The same Playwright mechanism can handle both Mustache templates and generated applications.

For Mustache mode:

```txt
GET /index.html
    ↓
read entryPoint
    ↓
prepare(input), if present
    ↓
Mustache render
    ↓
fulfill request with rendered HTML
```

Other resources are fulfilled directly from the printable filesystem.

For window injection:

```txt
inject prepared context
    ↓
GET /dist/index.html
    → fulfill unchanged

GET /dist/assets/app.js
    → fulfill from disk
```

This keeps the browser rendering implementation unified even though data injection differs.

---

# 20. `useCache`

Default:

```json
{
  "useCache": true
}
```

When enabled, print-page may reuse a previously rendered output.

The caching model should intentionally remain simple.

Approximate cache key:

```txt
hash(
  input
  +
  printable files
  +
  relevant renderer settings
)
```

No attempt should initially be made to construct a precise dependency graph.

If the input changes, the cache changes.

If any printable file changes, the cache changes.

If meaningful renderer configuration changes, the cache changes.

---

# 21. Cache Invalidation

Favor simple invalidation over clever dependency tracking.

Possible commands:

```bash
print-page cache clear
```

and potentially:

```bash
print-page cache clear greeting-card
```

The system should make deleting cache state trivial.

This avoids needing to reason about precise file dependency trees.

---

# 22. `useCache: false`

A printable may disable caching:

```json
{
  "useCache": false
}
```

It will then always render fresh.

This is likely useful for browser applications that rely on:

```txt
HTTP requests
remote APIs
runtime state
authenticated resources
mutable external data
```

However, caching is independent of injection mode.

The following is valid:

```json
{
  "injectionMode": "window",
  "useCache": true
}
```

if the author knows the output is deterministic.

Likewise:

```json
{
  "injectionMode": "mustache",
  "useCache": false
}
```

is valid.

---

# 23. External State and Caching

print-page should not attempt to automatically discover whether a printable is truly deterministic.

For example, this is allowed:

```js
export default async function prepare(input) {
  const data = await fetch(input.url).then(r => r.json());

  return {
    ...input,
    data
  };
}
```

while:

```json
{
  "useCache": true
}
```

is configured.

That may produce stale output.

This is acceptable.

The template author is responsible for choosing caching semantics appropriate to their printable.

Trying to automatically understand all external dependencies would add substantial complexity and work against the lightweight nature of the project.

---

# 24. Do Not Ban Hacks

The system is intended to run trusted templates.

print-page should not attempt to create a restrictive sandbox for:

```txt
prepare.js
browser JavaScript
HTTP access
filesystem access
libraries
creative template behavior
```

If a template author wants to:

```txt
fetch data
read local files
call internal APIs
perform complex preparation
run arbitrary browser code
```

the system should generally allow it.

The tool should provide conventions rather than try to prohibit unusual implementations.

If those hacks interact badly with caching or reproducibility, that responsibility belongs to the printable author.

---

# 25. `waitForPrintReady`

Default:

```json
{
  "waitForPrintReady": false
}
```

Ordinary pages may be printable once normal browser loading and resources have completed.

Browser-native rendering may need an explicit signal.

A printable can enable:

```json
{
  "waitForPrintReady": true
}
```

The browser application then exposes a readiness state, conceptually:

```js
window.__PRINT_READY__ = false;

// application mount
// HTTP requests
// canvas rendering
// asynchronous work

window.__PRINT_READY__ = true;
```

print-page waits for the signal before producing the PDF.

The exact browser API can be finalized during implementation.

---

# 26. `timeout`

Default:

```json
{
  "timeout": 30000
}
```

The value is in milliseconds.

It may normally be omitted.

For example:

```json
{
  "waitForPrintReady": true
}
```

implicitly uses:

```txt
timeout = 30000 ms
```

A printable may override it:

```json
{
  "waitForPrintReady": true,
  "timeout": 60000
}
```

Initially there should be one printable-level timeout rather than multiple specialized timeout settings.

It should bound operations that could otherwise hang indefinitely, particularly explicit readiness waiting.

The exact scope can be refined during implementation.

---

# 27. Settings Examples

## Plain static HTML

```txt
instructions/
  index.html
```

No settings required.

Effective configuration:

```json
{
  "entryPoint": "index.html",
  "injectionMode": "mustache",
  "useCache": true,
  "waitForPrintReady": false,
  "timeout": 30000
}
```

Because there are no Mustache expressions, the substitution stage effectively changes nothing.

---

## Basic replacement template

```txt
label/
  index.html
```

```html
<strong>{{productName}}</strong>
<p>{{referenceId}}</p>
```

No settings required.

---

## Replacement with derived logic

```txt
product-card/
  index.html
  prepare.js
```

`prepare.js` produces the template context.

The default Mustache injection renders the result.

No settings required.

---

## Browser-native canvas printable

```txt
card/
  index.html
  render.js
  settings.json
```

Possible configuration:

```json
{
  "injectionMode": "window",
  "waitForPrintReady": true
}
```

Caching remains enabled unless explicitly disabled.

---

## Svelte/Vite printable

```txt
greeting-card/
  settings.json

  src/
    App.svelte

  dist/
    index.html
    assets/
      ...
```

```json
{
  "entryPoint": "dist/index.html",
  "injectionMode": "window",
  "useCache": false,
  "waitForPrintReady": true
}
```

`timeout` remains the default `30000`.

---

# 28. Template Repository Independence

A major goal is that printable collections can live independently.

Example:

```txt
print-page/
  generic CLI

1000beads-printables/
  greeting-card/
  mounting-guide/
  labels/

internal-printables/
  inventory-label/
  picking-sheet/

other-project/
  reports/
  certificates/
```

The repositories may use completely different technology.

One might contain only:

```txt
index.html
```

Another may contain:

```txt
Svelte
Vite
TypeScript
private packages
canvas libraries
build tooling
```

The common deployment boundary remains HTML and browser assets.

This avoids excessive cross-dependencies.

---

# 29. What print-page Should Own

The generic tool should primarily own:

```txt
input handling
prepare.js execution
Mustache rendering
browser data injection
virtual browser origin
Chromium execution
PDF generation
caching
printing
basic settings
```

It should avoid taking ownership of:

```txt
frontend frameworks
Svelte/Vite versions
application build systems
private package registries
business-domain schemas
large template DSLs
deployment frameworks
complex dependency graphs
```

Those concerns belong to the repositories that need them.

---

# 30. Implementation

print-page should be implemented as a **TypeScript CLI**.

The implementation should remain compatible with standard Node.js tooling while being **Bun-friendly** for development, package management, and possible standalone binary distribution.

Expected initial core dependencies are small:

```txt
Playwright
Mustache
Node/Bun filesystem APIs
Node/Bun crypto APIs
```

`prepare.js` can be dynamically imported and executed directly by the JavaScript runtime.

Conceptually:

```js
const module = await import(preparePath);
const prepared = await module.default(input);
```

This keeps arbitrary JavaScript preprocessing extremely simple.

---

# 31. Suggested Internal Structure

A possible initial codebase:

```txt
src/
  cli.ts
  settings.ts
  prepare.ts
  inject.ts
  render.ts
  virtual-origin.ts
  cache.ts
  print.ts
```

Possible responsibilities:

```txt
cli.ts
  argument parsing and commands

settings.ts
  settings loading and defaults

prepare.ts
  optional prepare.js loading and execution

inject.ts
  Mustache and window injection behavior

virtual-origin.ts
  Playwright request interception and filesystem mapping

render.ts
  Chromium lifecycle and PDF generation

cache.ts
  hashing, lookup, storage, clearing

print.ts
  host printing integration
```

This is only an implementation suggestion and should not become a rigid internal framework prematurely.

---

# 32. Runtime and Packaging

The project should be written as an ordinary npm-compatible TypeScript CLI.

Initial public distribution may therefore be:

```bash
npm install -g print-page
```

with a standard package binary declaration.

For example:

```json
{
  "name": "print-page",
  "bin": {
    "print-page": "./dist/cli.js"
  }
}
```

Bun can still be used comfortably for development:

```bash
bun install
bun run ...
```

The code should remain Node-compatible rather than depending unnecessarily on Bun-specific APIs.

Bun may later be used to produce standalone executables once the Playwright-based renderer has been verified in that deployment form.

The initial architecture should not depend on standalone compilation being available.

---

# 33. Local and Server Usage

The same CLI should be usable:

```txt
on a developer workstation
on a production server
inside automation
from shell scripts
from other applications
```

The printable format itself should not depend on where the renderer runs.

A template repository can therefore be developed locally and its built artifacts deployed to a server without changing the print-page contract.

---

# 34. Rendering and Printing Should Remain Conceptually Separate

Generating a correct PDF and sending that PDF to a printer are distinct operations.

The CLI may eventually expose convenience commands such as:

```bash
print-page render ...
print-page print ...
```

or a combined flow.

But internally it is useful to keep:

```txt
HTML/browser rendering
        ↓
PDF
        ↓
printer backend
```

separate.

This makes debugging substantially easier and allows the same printable to be:

```txt
previewed
saved
archived
emailed
printed
```

without reimplementing rendering.

---

# 35. Solid Current Choices

The following choices are considered fairly solid:

```txt
- Project name: print-page.

- HTML is the universal printable boundary.

- A printable ultimately resolves to an HTML entry point and browser assets.

- Static HTML and replacement HTML use the same mechanism.

- Mustache is the default substitution mechanism.

- prepare.js is optional.

- prepare.js may be synchronous or asynchronous.

- prepare.js is trusted arbitrary JavaScript.

- Data injection is controlled through injectionMode.

- injectionMode defaults to "mustache".

- "mustache" substitutes data into the entry HTML.

- "window" injects prepared data into the browser runtime.

- Compiled SPA HTML does not need to be rewritten.

- Browser-native canvas rendering occurs directly in Chromium.

- Svelte/Vite applications build outside print-page.

- print-page does not fundamentally depend on Svelte or Vite.

- entryPoint defaults to "index.html".

- Playwright exposes files through a virtual HTTP origin.

- No real localhost server is required.

- useCache defaults to true.

- Caching uses a simple input + printable-file + renderer-settings hash.

- Cache invalidation should be easy rather than sophisticated.

- waitForPrintReady defaults to false.

- Browser-native applications may opt into an explicit readiness signal.

- timeout is optional and defaults to 30000 ms.

- No public app/document classification is required.

- The system should provide conventions but not try to ban hacks.

- Template repositories should remain independent from print-page.

- The CLI should be implemented in TypeScript.

- The implementation should be Node-compatible and Bun-friendly.

- Initial distribution can be an npm-compatible CLI.

- Standalone Bun binaries may be explored later.
```

---

# 36. Design Intent

## Keep simple printables simple

A printable that only needs:

```html
<p>{{reference}}</p>
```

should not require:

```txt
Svelte
a build step
package-specific infrastructure
custom JavaScript
application scaffolding
```

The default case should remain almost indistinguishable from writing ordinary HTML.

---

## Complex capability should be opt-in

A printable should only add:

```txt
prepare.js
window injection
print-ready signaling
Svelte/Vite
HTTP requests
canvas rendering
```

when it actually needs them.

Nothing about the simple path should become more complicated because richer printables are supported.

---

## Do not expose unnecessary taxonomy

Internally it may be useful to reason about:

```txt
document-like printables
app-like printables
```

but the user does not need to classify their work.

They should specify behaviors such as:

```json
{
  "entryPoint": "dist/index.html",
  "injectionMode": "window",
  "useCache": false,
  "waitForPrintReady": true
}
```

This avoids creating abstract categories that later become artificial constraints.

---

## Do not ban hacks

The system is intended for trusted template authors.

If somebody wants to:

```txt
fetch data in prepare.js
read a local file
call an internal service
run complex browser JS
use unusual browser APIs
```

print-page should not spend architectural complexity preventing it.

The author controls the consequences through settings such as:

```txt
useCache
waitForPrintReady
timeout
```

---

## Preserve bare browser development

Rich printables should remain normal browser applications.

A Svelte/canvas printable should be developable with its ordinary frontend tools without print-page imposing a custom runtime.

This gives useful emergent behavior:

```txt
normal dev server
live reload
browser developer tools
component inspection
canvas debugging
direct browser preview
```

print-page should benefit from existing browser tooling rather than replace it.

---

## The generic tool should not become a framework

print-page should solve:

```txt
How do I turn this browser document and this data into a reliable printable result?
```

It should not try to solve:

```txt
How should every printable application in every repository be authored?
```

---

# 37. Remaining Decisions Before Implementation

The major unresolved details are now mostly interface-level:

```txt
1. Exact CLI command structure.

2. How printable paths or template repositories are discovered.

3. Input mechanisms:
   - JSON file
   - stdin
   - direct CLI values

4. Exact settings filename.

5. Exact shape/name of the browser runtime data global.

6. Exact print-ready signaling API.

7. Exact cache storage location.

8. Exact cache key composition.

9. Whether Chromium/renderer versions are included in the cache key.

10. Exact timeout scope.

11. PDF output naming and temporary-file behavior.

12. Printer integration and host-platform differences.

13. Error reporting for:
    - prepare.js
    - Mustache
    - browser JS
    - missing files/assets
    - failed HTTP requests
    - readiness timeout
    - Chromium errors

14. Whether template build commands ever become a print-page convenience feature.

15. Whether settings are JSON, another simple format, or inferred partly from CLI flags.
```

These do not currently require changing the main architecture.

---

# 38. Current Architecture

For Mustache injection:

```txt
                 input
                   │
                   ▼
          optional prepare.js
                   │
                   ▼
            prepared context
                   │
                   ▼
             Mustache render
                   │
                   ▼
               HTML entry
                   │
                   ▼
        Playwright virtual origin
                   │
                   ▼
                Chromium
                   │
                   ▼
          optional browser JS
                   │
                   ▼
        optional print-ready wait
                   │
                   ▼
                  PDF
                   │
                   ▼
              output / print
```

For window injection:

```txt
                 input
                   │
                   ▼
          optional prepare.js
                   │
                   ▼
            prepared context
                   │
                   ▼
       Playwright runtime injection
                   │
                   ▼
        unchanged HTML entry point
                   │
                   ▼
        Playwright virtual origin
                   │
                   ▼
                Chromium
                   │
                   ▼
          browser application
          / canvas rendering
                   │
                   ▼
        optional print-ready wait
                   │
                   ▼
                  PDF
                   │
                   ▼
              output / print
```

For compiled browser applications:

```txt
application source
       │
       ▼
Svelte / Vite / other build tooling
       │
       ▼
HTML + browser assets
       │
       ▼
print-page
```

The central architectural boundary remains:

> **print-page renders browser documents. It does not prescribe how those browser documents are authored.**
