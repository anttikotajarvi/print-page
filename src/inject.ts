import Mustache from "mustache";

import { PrintPageError } from "./errors.js";
import type { InjectionMode } from "./types.js";

export const WINDOW_DATA_GLOBAL = "__PRINT_DATA__";

export interface MustacheInjectionResult {
  mode: "mustache";
  html: string;
}

export interface WindowInjectionResult {
  mode: "window";
  html: string;
  initScript: string;
}

export type InjectionResult = MustacheInjectionResult | WindowInjectionResult;

export function injectEntryHtml(
  html: string,
  data: unknown,
  mode: "mustache",
): MustacheInjectionResult;
export function injectEntryHtml(
  html: string,
  data: unknown,
  mode: "window",
): WindowInjectionResult;
export function injectEntryHtml(
  html: string,
  data: unknown,
  mode: InjectionMode,
): InjectionResult;

export function injectEntryHtml(
  html: string,
  data: unknown,
  mode: InjectionMode,
): InjectionResult {
  if (mode === "mustache") {
    return {
      mode,
      html: Mustache.render(html, data ?? {}),
    };
  }

  return {
    mode,
    html,
    initScript: createWindowDataScript(data),
  };
}

export function createWindowDataScript(data: unknown): string {
  let serialized: string | undefined;

  try {
    serialized = JSON.stringify(data);
  } catch (error) {
    throw new PrintPageError(
      "INVALID_DATA",
      "Window injection data must be JSON-serializable.",
      { cause: error },
    );
  }

  if (serialized === undefined) {
    throw new PrintPageError(
      "INVALID_DATA",
      "Window injection data must have a JSON representation.",
    );
  }

  const safeJson = serialized.replace(
    /[<>&\u2028\u2029]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

  return `window[${JSON.stringify(WINDOW_DATA_GLOBAL)}] = ${safeJson};`;
}
