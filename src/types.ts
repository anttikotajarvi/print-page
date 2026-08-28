export const INJECTION_MODES = ["mustache", "window"] as const;

export type InjectionMode = (typeof INJECTION_MODES)[number];

export interface PrintableSettings {
  /**
   * Directory exposed as the root of the printable's virtual origin, relative
   * to the directory that contains settings.json.
   */
  root: string;
  entryPoint: string;
  injectionMode: InjectionMode;
  useCache: boolean;
  waitForPrintReady: boolean;
  timeout: number;
}

export interface PreparedPrintable {
  directory: string;
  settings: PrintableSettings;
  data: unknown;
}
