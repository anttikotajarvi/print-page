export type PrintPageErrorCode =
  | "INVALID_SETTINGS"
  | "INVALID_DATA"
  | "INVALID_PATH"
  | "OUTPUT_EXISTS"
  | "PREPARE_FAILED"
  | "RENDER_FAILED"
  | "RESOURCE_NOT_FOUND"
  | "VIRTUAL_ORIGIN_ERROR";

export class PrintPageError extends Error {
  readonly code: PrintPageErrorCode;

  constructor(
    code: PrintPageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PrintPageError";
    this.code = code;
  }
}
