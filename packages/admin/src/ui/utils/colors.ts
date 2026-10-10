export const METHOD_COLORS: Record<string, string> = {
  GET: '#1f883d',
  POST: '#0969da',
  PUT: '#bf8700',
  DELETE: '#cf222e',
  PATCH: '#1f6feb',
}

/** Returns the dot color for a given override mode kind. */
export const modeDotColor = (kind: string): string => {
  if (kind === 'http-status' || kind === 'business-failure' || kind === 'destroy') return '#cf222e'
  if (kind === 'delay' || kind === 'hang') return '#bf8700'
  return '#0969da'
}
