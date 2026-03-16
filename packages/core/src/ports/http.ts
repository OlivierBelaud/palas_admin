// SPEC-039 — IHttpPort interface

/**
 * HTTP port contract (simplified).
 * Adapters: NitroHttpAdapter.
 */
export interface IHttpPort {
  /**
   * Register a route handler.
   * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
   * @param path - The route path
   * @param handler - The request handler returning a Response
   */
  registerRoute(method: string, path: string, handler: (req: Request) => Promise<Response> | Response): void

  /**
   * Handle an incoming HTTP request through the pipeline.
   * @param req - The incoming Request
   * @returns The Response
   */
  handleRequest(req: Request): Promise<Response>
}
