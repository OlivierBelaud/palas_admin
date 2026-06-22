import { describe, expect, it } from 'vitest'
import {
  type DailyReportPayload,
  dailyReportSnapshotStatus,
  renderDailyReportHtml,
  renderDailyReportText,
} from '../daily-reporting'

const payload: DailyReportPayload = {
  day: '2026-06-16',
  timezone: 'Europe/Paris',
  generated_at: '2026-06-17T03:00:00.000Z',
  period: {
    start_utc: '2026-06-15T22:00:00.000Z',
    end_utc: '2026-06-16T22:00:00.000Z',
  },
  summary: {
    sessions: 10,
    unique_visitors: 8,
    orders: 1,
    revenue: 55,
    average_order_value: 55,
    session_conversion_rate: 0.1,
    visitor_conversion_rate: 0.125,
    sold_countries_count: 1,
    unattributed_orders: 1,
    unattributed_revenue: 55,
    source_max_last_event_at: '2026-06-16T21:55:00.000Z',
  },
  segments: [
    segment('unknown', 'Inconnus', 8, 7, 0, 0),
    segment('known_no_purchase', 'Prospects', 1, 1, 0, 0),
    segment('returning_customer', 'Clients', 1, 1, 0, 0),
    segment('unattributed', 'Non attribue', 0, 0, 1, 55),
    segment('total', 'Total journee', 10, 8, 1, 55),
  ],
  countries: [{ country_code: 'FR', country_name: 'France', orders: 1, revenue: 55 }],
  cart_summary: {
    carts_created: 4,
    carts_created_converted: 1,
    carts_created_conversion_rate: 0.25,
    carts_updated: 12,
    carts_updated_converted: 1,
    carts_updated_conversion_rate: 1 / 12,
  },
  abandoned_cart_emails: [
    {
      message_type: 'abandoned_cart_1',
      label: 'Email 1',
      sent: 10,
      opens: null,
      open_rate: null,
      clicks: 3,
      click_rate: 0.3,
      conversions: 1,
      conversion_rate: 0.1,
      revenue: 55,
    },
    {
      message_type: 'abandoned_cart_2',
      label: 'Email 2',
      sent: 4,
      opens: null,
      open_rate: null,
      clicks: 1,
      click_rate: 0.25,
      conversions: 0,
      conversion_rate: 0,
      revenue: 0,
    },
    {
      message_type: 'abandoned_cart_3',
      label: 'Email 3',
      sent: 1,
      opens: null,
      open_rate: null,
      clicks: 0,
      click_rate: 0,
      conversions: 0,
      conversion_rate: 0,
      revenue: 0,
    },
  ],
  sources: [],
  channel_segments: [],
}

describe('daily reporting render', () => {
  it('keeps unattributed orders in quality controls, not lifecycle segments', () => {
    const html = renderDailyReportHtml(payload)
    const segmentTable = html.slice(html.indexOf('<h2>Segments</h2>'), html.indexOf('<h2>Pays livres</h2>'))

    expect(segmentTable).toContain('Inconnus')
    expect(segmentTable).toContain('Prospects')
    expect(segmentTable).toContain('Clients')
    expect(segmentTable).toContain('Total journee')
    expect(segmentTable).not.toContain('Non attribue')
    expect(html).toContain('Cmd sans session')
    expect(html).toContain('class="kpi-table"')
    expect(html).not.toContain('class="kpis"')
    expect(html).toContain('commandes sans session exploitable')
    expect(html).toContain('Paniers')
    expect(html).toContain('Paniers crees')
    expect(html).toContain('Relances panier CRM')
    expect(html).toContain('Email 1')
    expect(html).toContain('Taux ouv.')
    expect(html).toContain('Definitions rapides')
    expect(html).toContain('Sources de trafic')
    expect(html).toContain('Canaux operationnels par segment')
    expect(html).toContain('Commandes sans session')
  })

  it('omits the false unattributed segment from the text report too', () => {
    const text = renderDailyReportText(payload)
    const segmentBlock = text.slice(text.indexOf('Segments:'), text.indexOf('Pays:'))

    expect(segmentBlock).toContain('Inconnus')
    expect(segmentBlock).toContain('Prospects')
    expect(segmentBlock).toContain('Clients')
    expect(segmentBlock).toContain('Total journee')
    expect(segmentBlock).not.toContain('Non attribue')
    expect(text).toContain('Commandes sans session exploitable: 1')
    expect(text).toContain('Paniers crees: 4')
    expect(text).toContain('Relances panier CRM:')
    expect(text).toContain('Email 1: 10 envoyes')
    expect(text).toContain('Definitions rapides:')
  })

  it('marks the snapshot partial when visitor sessions are stale', () => {
    const readyPayload = {
      ...payload,
      summary: {
        ...payload.summary,
        unattributed_orders: 0,
        unattributed_revenue: 0,
      },
    }

    expect(dailyReportSnapshotStatus(readyPayload)).toBe('ready')
    expect(
      dailyReportSnapshotStatus({
        ...readyPayload,
        summary: {
          ...readyPayload.summary,
          source_max_last_event_at: '2026-06-16T12:00:00.000Z',
        },
      }),
    ).toBe('partial')
  })
})

function segment(
  segment: DailyReportPayload['segments'][number]['segment'],
  label: string,
  sessions: number,
  uniqueVisitors: number,
  orders: number,
  revenue: number,
): DailyReportPayload['segments'][number] {
  return {
    segment,
    label,
    sessions,
    unique_visitors: uniqueVisitors,
    orders,
    revenue,
    average_order_value: orders > 0 ? revenue / orders : null,
    session_conversion_rate: sessions > 0 ? orders / sessions : null,
    visitor_conversion_rate: uniqueVisitors > 0 ? orders / uniqueVisitors : null,
  }
}
