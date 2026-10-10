/** Supported route methods shared by initial state, checkboxes and the empty-filter fallback. */
export const HTTP_METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

/** An empty selection displays all supported methods, including HEAD and OPTIONS. */
export const matchesMethodFilter = (method: string, selected: ReadonlySet<string>): boolean =>
  selected.size > 0 ? selected.has(method) : HTTP_METHODS.includes(method)
