import type { IncomingMessage } from 'node:http'

/** Transport-owned body state: wire completion does not mean the Web body was consumed. */
export interface IncomingBody {
  readonly stream: ReadableStream<Uint8Array>
  readonly completed: boolean
  readonly cancellation: AbortSignal
  stop(reason?: unknown): void
}

/** Pull bounded chunks without letting Web cancellation destroy the response socket. */
export const incomingBody = (incoming: IncomingMessage): IncomingBody => {
  let completed = false
  let stopped = false
  const cancellation = new AbortController()
  let controller: ReadableStreamDefaultController<Uint8Array>
  let pending: (() => void) | undefined
  const settle = (): void => { pending?.(); pending = undefined }
  const detach = (): void => {
    incoming.off('readable', deliver)
    incoming.off('end', end)
    incoming.off('aborted', aborted)
    incoming.pause()
    settle()
  }
  const end = (): void => {
    if (stopped) return
    stopped = true
    completed = true
    controller.close()
    detach()
  }
  const stop = (reason?: unknown): void => {
    if (stopped) return
    stopped = true
    controller.error(reason ?? new Error('Request body intake stopped'))
    detach()
    cancellation.abort(reason)
  }
  const aborted = (): void => stop(new Error('Request body aborted'))
  const deliver = (): void => {
    if (stopped || !pending) return
    const chunk: unknown = incoming.read(Math.min(incoming.readableLength, 16 * 1024))
    if (chunk instanceof Uint8Array) { controller.enqueue(chunk); settle() }
    else if (incoming.readableEnded) end()
  }
  // Keep an error observer after cancellation: aborted uploads can error after body listeners detach.
  const error = (cause: Error): void => stop(cause)
  incoming.on('error', error)
  incoming.once('close', () => { incoming.off('error', error); if (!incoming.complete) aborted() })
  const stream = new ReadableStream<Uint8Array>({
    start(output) {
      controller = output
      incoming.on('readable', deliver)
      incoming.on('end', end)
      incoming.on('aborted', aborted)
    },
    pull() { return new Promise<void>((resolve) => { pending = resolve; deliver() }) },
    cancel(reason) { stopped = true; detach(); cancellation.abort(reason) },
  }, { highWaterMark: 0 })
  return { stream, get completed() { return completed }, cancellation: cancellation.signal, stop }
}
