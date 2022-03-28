import { inspectorHost } from '..'
import { Analytics } from '../../analytics'

let analytics: Analytics

describe('Inspector interface', () => {
  beforeEach(() => {
    analytics = new Analytics({
      writeKey: 'abc',
    })
  })

  it('accepts and starts up an inspector client trying to connect', () => {
    const inspector = {
      start: jest.fn(),
      trace: jest.fn(),
    }
    analytics.connectInspector(inspector)

    expect(inspector.start).toHaveBeenCalledTimes(1)
  })

  it('notifies the connected inspector client about each event API call and delivery', async () => {
    const inspector = {
      start: jest.fn(),
      trace: jest.fn(),
    }

    // In practice, this step is part of the analytics loading sequence
    inspectorHost.setIntegrations({
      'Google Ads (Classic)': {},
    })

    analytics.connectInspector(inspector)

    expect(inspector.trace).not.toHaveBeenCalled()

    const timestampMatcher = expect.stringMatching(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    )
    const deliveryPromise = analytics.track('Test event').catch(() => {})

    expect(inspector.trace).toHaveBeenCalledTimes(1)
    expect(inspector.trace).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'triggered',
        timestamp: timestampMatcher,
        event: expect.objectContaining({
          event: 'Test event',
          type: 'track',
        }),
      })
    )

    await deliveryPromise

    expect(inspector.trace).toHaveBeenCalledTimes(2)
    expect(inspector.trace).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'delivered',
        timestamp: timestampMatcher,
        event: expect.objectContaining({
          event: 'Test event',
          type: 'track',
        }),
      })
    )
  })
})
