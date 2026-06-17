import { describe, expect, it } from 'vitest'
import { type DailyReportPayload, renderDailyReportHtml, renderDailyReportText } from '../daily-reporting'

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
    expect(html).toContain('commandes sans session exploitable')
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
