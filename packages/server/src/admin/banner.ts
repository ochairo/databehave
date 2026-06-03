/**
 * stdout notice emitted at `server.listen()` start when admin is
 * enabled. Splitting it out keeps the banner format unit-testable
 * (no need to spin up a real http server just to assert a string).
 */
export interface AdminBannerLogger {
  info(message: string): void
}

export const formatAdminBanner = (
  host: string,
  port: number,
  path: string,
): string =>
  `[@databehave/server] admin panel ready at http://${host}:${port}${path} (dev mock — disable in production)`

export const emitAdminBanner = (
  host: string,
  port: number,
  path: string,
  logger: AdminBannerLogger = console,
): void => {
  logger.info(formatAdminBanner(host, port, path))
}
