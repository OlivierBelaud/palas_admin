// SPEC-067/082 — ILoggerPort interface

/**
 * Logger port contract.
 * Adapters: PinoLogger (dev/prod).
 */
export interface ILoggerPort {
  /** Log at error level */
  error(msg: string, ...args: unknown[]): void
  /** Log at warn level */
  warn(msg: string, ...args: unknown[]): void
  /** Log at info level */
  info(msg: string, ...args: unknown[]): void
  /** Log at http level */
  http(msg: string, ...args: unknown[]): void
  /** Log at verbose level */
  verbose(msg: string, ...args: unknown[]): void
  /** Log at debug level */
  debug(msg: string, ...args: unknown[]): void
  /** Log at silly level */
  silly(msg: string, ...args: unknown[]): void

  /**
   * Log a panic-level message and potentially crash.
   * @param data - Arbitrary data to log
   */
  panic(data: unknown): void

  /**
   * Start a timed activity log.
   * @param msg - The activity description
   * @returns An activity ID for progress/success/failure
   */
  activity(msg: string): string

  /**
   * Log progress on an activity.
   * @param id - The activity ID
   * @param msg - Progress message
   */
  progress(id: string, msg: string): void

  /**
   * Mark an activity as successful.
   * @param id - The activity ID
   * @param msg - Success message
   */
  success(id: string, msg: string): void

  /**
   * Mark an activity as failed.
   * @param id - The activity ID
   * @param msg - Failure message
   */
  failure(id: string, msg: string): void

  /**
   * Check if a given log level would be output.
   * @param level - The log level to check
   * @returns True if messages at this level would be logged
   */
  shouldLog(level: string): boolean

  /**
   * Override the current log level.
   * @param level - The new log level
   */
  setLogLevel(level: string): void

  /**
   * Reset the log level to the default.
   */
  unsetLogLevel(): void
}
