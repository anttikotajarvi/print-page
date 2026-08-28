import { isAbsolute, relative, resolve, sep } from "node:path";

import { PrintPageError } from "./errors.js";

export function resolveWithinDirectory(
  directory: string,
  relativePath: string,
  label = "Path",
): string {
  if (relativePath.length === 0 || relativePath.includes("\0")) {
    throw new PrintPageError(
      "INVALID_PATH",
      `${label} must be a non-empty relative path.`,
    );
  }

  if (isAbsolute(relativePath)) {
    throw new PrintPageError(
      "INVALID_PATH",
      `${label} must be relative to the printable directory.`,
    );
  }

  const root = resolve(directory);
  const candidate = resolve(root, relativePath);
  const fromRoot = relative(root, candidate);

  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new PrintPageError(
      "INVALID_PATH",
      `${label} must stay inside the printable directory.`,
    );
  }

  return candidate;
}
