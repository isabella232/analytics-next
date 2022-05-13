import { Analytics } from './analytics'
import { Context } from './core/context'

/**
 * The names of any Analytics instance methods that can be called pre-initialization.
 * These methods should exist statically on AnalyticsBrowser.
 */
type PreInitMethodName =
  | 'trackSubmit'
  | 'trackClick'
  | 'trackLink'
  | 'trackForm'
  | 'pageview'
  | 'identify'
  | 'reset'
  | 'group'
  | 'track'
  | 'ready'
  | 'alias'
  | 'debug'
  | 'page'
  | 'once'
  | 'off'
  | 'on'
  | 'addSourceMiddleware'
  | 'addIntegrationMiddleware'
  | 'setAnonymousId'
  | 'addDestinationMiddleware'

// Union of all analytics methods that _do not_ return a Promise
type SyncPreInitMethodName = {
  [MethodName in PreInitMethodName]: ReturnType<
    Analytics[MethodName]
  > extends Promise<any>
    ? never
    : MethodName
}[PreInitMethodName]

const flushSyncAnalyticsCalls = (
  name: SyncPreInitMethodName,
  analytics: Analytics,
  buffer: PreInitMethodCallBuffer
): void => {
  buffer.getCalls(name).forEach((c) => {
    callSyncAnalyticsMethod(
      analytics,
      c as PreInitMethodCall<SyncPreInitMethodName>
    )
  })
}

export const flushAddSourceMiddleware = async (
  analytics: Analytics,
  buffer: PreInitMethodCallBuffer
) => {
  for (const c of buffer.getCalls('addSourceMiddleware')) {
    await callAnalyticsMethod(analytics, c).catch(console.error)
  }
}

export const flushOn = flushSyncAnalyticsCalls.bind(this, 'on')

export const flushSetAnonymousID = flushSyncAnalyticsCalls.bind(
  this,
  'setAnonymousId'
)

export const flushAnalyticsCallsInNewTask = (
  analytics: Analytics,
  buffer: PreInitMethodCallBuffer
): void => {
  buffer.toArray().forEach((m) => {
    setTimeout(() => {
      callAnalyticsMethod(analytics, m).catch(console.error)
    }, 0)
  })
}

/**
 *  Represents a buffered method call that occurred before initialization.
 */
export interface PreInitMethodCall<
  MethodName extends PreInitMethodName = PreInitMethodName
> {
  method: MethodName
  args: PreInitMethodParams<MethodName>
  called: boolean
  resolve: (v: ReturnType<Analytics[MethodName]>) => void
  reject: (reason: any) => void
}

const normalizeSnippetBuffer = (buffer: SnippetBuffer): PreInitMethodCall[] => {
  return buffer.map(
    ([methodName, ...args]) =>
      ({
        method: methodName,
        resolve: () => {},
        reject: console.error,
        args,
        called: false,
      } as PreInitMethodCall)
  )
}

type PreInitMethodParams<MethodName extends PreInitMethodName> = Parameters<
  Analytics[MethodName]
>

type SnippetWindowBufferedMethodCall<
  MethodName extends PreInitMethodName = PreInitMethodName
> = [MethodName, ...PreInitMethodParams<MethodName>]

/**
 * A list of the method calls before initialization for snippet users
 * For example, [["track", "foo", {bar: 123}], ["page"], ["on", "ready", function(){..}]
 */
type SnippetBuffer = SnippetWindowBufferedMethodCall[]

/**
 * Fetch the buffered method calls from the window object and normalize them.
 */
export const getSnippetWindowBuffer = (): PreInitMethodCall[] => {
  const wa = window.analytics
  const buffered =
    // @ts-expect-error
    (wa && wa[0] ? [...wa] : []) as SnippetBuffer
  return normalizeSnippetBuffer(buffered)
}

/**
 * Infer return type; if return type is promise, unwrap it.
 */
type ReturnTypeUnwrap<Fn> = Fn extends (...args: any[]) => infer ReturnT
  ? ReturnT extends PromiseLike<infer Unwrapped>
    ? Unwrapped
    : ReturnT
  : never

type MethodCallMap = Partial<Record<PreInitMethodName, PreInitMethodCall[]>>

/**
 *  Represents any and all the buffered method calls that occurred before initialization.
 */
export class PreInitMethodCallBuffer {
  private _value = {} as MethodCallMap

  public toArray(): PreInitMethodCall[] {
    return Object.values(this._value).reduce((acc, v) => {
      return acc.concat(...v)
    }, [] as PreInitMethodCall[])
  }

  public getCalls(methodName: PreInitMethodName): PreInitMethodCall[] {
    return this._value[methodName] || []
  }

  push(...calls: PreInitMethodCall[]): void {
    calls.forEach((el) => {
      if (this._value[el.method]) {
        this._value[el.method]?.push(el)
      } else {
        this._value[el.method] = [el]
      }
    })
  }

  clear(): void {
    this._value = {} as MethodCallMap
  }
}
export const callAnalyticsMethodHelper = <T extends PreInitMethodName>(
  analytics: Analytics,
  call: PreInitMethodCall<T>
): ReturnType<Analytics[T]> | undefined => {
  if (call.called) {
    return undefined
  }
  call.called = true
  const result = (analytics[call.method] as Function)(...call.args)
  call.resolve(result)
  return result
}

/**
 *  Call method and mark as "called"
 *  This function should never throw an error
 */
export async function callAnalyticsMethod<T extends PreInitMethodName>(
  analytics: Analytics,
  methodCall: PreInitMethodCall<T>
): Promise<void> {
  try {
    await callAnalyticsMethodHelper(analytics, methodCall)
  } catch (err) {
    methodCall.reject(err)
  }
}

export function callSyncAnalyticsMethod<T extends SyncPreInitMethodName>(
  analytics: Analytics,
  methodCall: PreInitMethodCall<T>
): void {
  try {
    callAnalyticsMethodHelper(analytics, methodCall)
  } catch (err) {
    methodCall.reject(err)
  }
}

type AnalyticsLoader = (
  preInitBuffer: PreInitMethodCallBuffer
) => Promise<[Analytics, Context]>

export class AnalyticsBuffered implements PromiseLike<[Analytics, Context]> {
  instance?: Analytics
  ctx?: Context
  private preInitBuffer = new PreInitMethodCallBuffer()
  private promise: Promise<[Analytics, Context]>
  constructor(loader: AnalyticsLoader) {
    this.promise = loader(this.preInitBuffer)
    this.promise
      .then(([ajs, ctx]) => {
        this.instance = ajs
        this.ctx = ctx
      })
      .catch(() => {
        // intentionally do nothing...
        // this result of this promise will be caught by the 'catch' block on this class.
      })
  }

  then<T1, T2 = never>(
    ...args: [
      onfulfilled:
        | ((instance: [Analytics, Context]) => T1 | PromiseLike<T1>)
        | null
        | undefined,
      onrejected?: (reason: unknown) => T2 | PromiseLike<T2>
    ]
  ) {
    return this.promise.then(...args)
  }

  catch<TResult = never>(
    ...args: [
      onrejected?:
        | ((reason: any) => TResult | PromiseLike<TResult>)
        | undefined
        | null
    ]
  ) {
    return this.promise.catch(...args)
  }

  finally(...args: [onfinally?: (() => void) | undefined | null]) {
    return this.promise.finally(...args)
  }

  trackSubmit = this._createMethod('trackSubmit')
  trackClick = this._createMethod('trackClick')
  trackLink = this._createMethod('trackLink')
  pageView = this._createMethod('pageview')
  identify = this._createMethod('identify')
  reset = this._createMethod('reset')
  group = this._createMethod('group')
  track = this._createMethod('track')
  ready = this._createMethod('ready')
  alias = this._createMethod('alias')
  debug = this._createChainableMethod('debug')
  page = this._createMethod('page')
  once = this._createChainableMethod('once')
  off = this._createChainableMethod('off')
  on = this._createChainableMethod('on')
  addSourceMiddleware = this._createMethod('addSourceMiddleware')
  addIntegrationMiddleware = this._createMethod('addIntegrationMiddleware')
  setAnonymousId = this._createMethod('setAnonymousId')
  addDestinationMiddleware = this._createMethod('addDestinationMiddleware')

  private _createMethod<T extends PreInitMethodName>(methodName: T) {
    return async (
      ...args: Parameters<Analytics[T]>
    ): Promise<ReturnTypeUnwrap<Analytics[T]>> => {
      if (this.instance) {
        const method = this.instance[methodName] as Function
        return method(...args)
      }

      return new Promise((resolve, reject) => {
        this.preInitBuffer.push({
          method: methodName,
          args,
          resolve: resolve,
          reject: reject,
          called: false,
        } as PreInitMethodCall)
      })
    }
  }

  /**
   *  These are for methods that where determining when the method gets "flushed" is not important.
   *  These methods will resolve when analytics is fully initialized, and return type (other than Analytics)will not be available.
   */
  private _createChainableMethod<T extends PreInitMethodName>(methodName: T) {
    return (...args: Parameters<Analytics[T]>): AnalyticsBuffered => {
      if (this.instance) {
        const method = this.instance[methodName] as (...args: any[]) => void
        void method(...args)
      } else {
        this.preInitBuffer.push({
          method: methodName,
          args,
          resolve: () => {},
          reject: console.error,
          called: false,
        } as PreInitMethodCall)
      }

      return this
    }
  }
}
