import type { KaliErrorCodeValue } from "../core/constants/game-ai";

export class KaliError extends Error {
  readonly code: KaliErrorCodeValue;
  readonly fallbackRow?: number;
  readonly fallbackCol?: number;

  constructor(
    code: KaliErrorCodeValue,
    message: string,
    fallbackRow?: number,
    fallbackCol?: number,
  ) {
    super(message);
    this.code = code;
    this.fallbackRow = fallbackRow;
    this.fallbackCol = fallbackCol;
  }

  hasFallback(): boolean {
    return this.fallbackRow !== undefined && this.fallbackCol !== undefined;
  }
}

export function fromGameMoveError(
  code: string,
  message: string,
  fallback: { type: string; data: Record<string, unknown> } | null | undefined,
): KaliError {
  return new KaliError(
    code as KaliErrorCodeValue,
    message,
    fallback?.data?.row as number | undefined,
    fallback?.data?.col as number | undefined,
  );
}
