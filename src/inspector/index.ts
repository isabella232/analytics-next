import { Context, Integrations, LegacySettings } from '..'

// FIXME: Import these types directly from `@segment/inspector-core`
type SegmentEvent = object
type Inspector = {
  start: (config: object) => void
  trace: (eventPhase: object) => void
}

/**
 * Inspector clients have this much time frame to connect after initilization of
 * the library to recieve any activity that might've happened in the meantime. If
 * they connect anytime after this time frame, they'll only receive future events
 */
const DOCKING_WAIT_MS = 30000

/**
 * This class prevents hogging up any more memory than necessary by letting
 * go of object references after they've become irrelevant or useless.
 *
 * After the given time elapses, the references are released and the GC can
 * take care of the rest.
 *
 * All operations become graceful and silent no-ops once the array is disposed.
 */
class DisposableArray<T> {
  private arr: T[] | null = []
  constructor(disposeAfterT: number) {
    setTimeout(this.dispose, disposeAfterT)
  }
  dispose = () => {
    this.arr = null
  }
  get disposed() {
    return this.arr === null
  }
  push = (...items: T[]) => this.arr?.push(...items)
  forEach = (callback: (value: T, index: number, array: T[]) => void) =>
    this.arr?.forEach(callback)
}

export const inspectorHost = (() => {
  const traceHistory: DisposableArray<object> = new DisposableArray(
    DOCKING_WAIT_MS
  )
  let inspector: Inspector
  let integrationNames: string[]

  const now = () => new Date().toISOString()
  const getValue = (key: string) =>
    JSON.parse(localStorage.getItem(key) || 'null')
  const resolveDestinations = (integrations: Integrations) =>
    integrationNames?.filter((integration) =>
      typeof integrations?.[integration] === 'boolean'
        ? integrations[integration]
        : integrations?.All ?? true
    )

  // FIXME: Fix types
  const send = (traceData: object) => {
    if (!inspector && !traceHistory.disposed) {
      traceHistory.push(traceData)
      return
    }

    inspector.trace(traceData)
  }

  return {
    connectInspector: (inspectorClient: Inspector) => {
      try {
        inspectorClient.start({
          user: {
            id: getValue('ajs_user_id'),
            traits: getValue('ajs_user_traits'),
          },
        })
        inspector = inspectorClient
      } catch (error) {
        console.warn(
          `Inspector start up failed - ${(error as Error).toString()}`
        )
        return
      }

      if (!traceHistory.disposed) {
        traceHistory.forEach(send)
        traceHistory.dispose()
      }
    },
    setIntegrations: (integrations: LegacySettings['integrations']) => {
      integrationNames = Object.keys(integrations)
    },
    reportTriggered: (ctx: Context) =>
      send({
        id: ctx.id,
        stage: 'triggered',
        event: ctx.event as SegmentEvent,
        timestamp: now(),
      }),
    reportDelivered: (ctx: Context) => {
      if (inspector && !integrationNames) {
        console.warn(
          'Inspector host unaware of integrations cannot resolve destinations'
        )
      }

      send({
        id: ctx.id,
        stage: 'delivered',
        event: ctx.event as SegmentEvent,
        timestamp: now(),
        destinations: resolveDestinations(ctx.event.integrations || {}) || [],
      })
    },
  }
})()
