import { EventQueue } from './queue'
import { validate } from './validation'
import { Context } from './context'
import { SegmentEvent } from './events'
import { invokeCallback } from './callback'

interface AnalyticsSettings {
  writeKey: string
  timeout?: number
  // TODO:
  // - custom url endpoint
  // - integrations object
  // - plugins
  // - reset
  // - events
  // - event level middleware
}
type Callback = (ctx: Context) => Promise<unknown> | unknown

export class Analytics {
  queue: EventQueue
  settings: AnalyticsSettings

  constructor(settings: AnalyticsSettings) {
    this.queue = new EventQueue()
    this.settings = settings
  }

  // TODO/ideas
  // - user id capture
  // - meta timestamps
  // - add callback as part of dispatch

  async track(event: string, properties?: object, options?: object, callback?: Callback): Promise<Context> {
    const segmentEvent = {
      event,
      type: 'track' as const,
      properties: { ...properties },
      options: { ...options },
    }

    return this.dispatch('track', segmentEvent, callback)
  }

  async identify(userId?: string, traits?: object, options?: object, callback?: Callback): Promise<Context> {
    // todo: grab traits from user
    // todo: grab id from user

    const segmentEvent = {
      type: 'identify' as const,
      userId,
      traits: { ...traits },
      options: { ...options },
    }

    return this.dispatch('identify', segmentEvent, callback)
  }

  private async dispatch(type: string, event: SegmentEvent, callback?: Callback): Promise<Context> {
    const ctx = new Context(event)
    validate(type, ctx.event)

    const dispatched = await this.queue.dispatch(ctx)
    return invokeCallback(dispatched, callback, this.settings.timeout)
  }
}