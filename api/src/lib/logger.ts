export interface Logger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

/** Adapts an Azure Functions `InvocationContext` (or anything with the same methods). */
export function contextLogger(context: {
  log(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}): Logger {
  return {
    info: (message, ...args) => context.log(message, ...args),
    warn: (message, ...args) => context.warn(message, ...args),
    error: (message, ...args) => context.error(message, ...args),
  }
}
