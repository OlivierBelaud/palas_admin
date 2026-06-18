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
    cart_births_without_session: 2,
    completed_cart_births_without_session: 1,
    completed_cart_value_without_session: 55,
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
  cart_activity_segments: [],
  cart_birth_segments: [
    {
      segment: 'unknown',
      segment_label: 'Inconnus',
      carts_born: 3,
      carts_born_with_email: 0,
      carts_completed: 0,
      completed_cart_value: 0,
      cart_visitors: 3,
    },
    {
      segment: 'unattributed',
      segment_label: 'Non attribue',
      carts_born: 2,
      carts_born_with_email: 1,
      carts_completed: 1,
      completed_cart_value: 55,
      cart_visitors: 0,
    },
    {
      segment: 'total',
      segment_label: 'Total journee',
      carts_born: 5,
      carts_born_with_email: 1,
      carts_completed: 1,
      completed_cart_value: 55,
      cart_visitors: 3,
    },
  ],
  abandoned_cart_messages: [],
  abandoned_cart_recoveries: [],
  abandoned_cart_summary: {
    due_messages: 0,
    sent_inside_period: 0,
    sent_after_period: 0,
    recovered_cases: 0,
    recovered_orders: 0,
    recovered_revenue: 0,
    abandoned_email_click_sessions: 0,
    recovery_rate_on_due_messages: null,
    recovery_rate_on_sent_messages: null,
  },
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

  it('keeps unattributed cart births in quality controls, not business segment tables', () => {
    const html = renderDailyReportHtml(payload)
    const cartBirthTable = html.slice(
      html.indexOf('<h2>Paniers nes</h2>'),
      html.indexOf('<h2>Relances panier CRM</h2>'),
    )
    const text = renderDailyReportText(payload)
    const cartBirthText = text.slice(text.indexOf('Paniers nes:'), text.indexOf('Relances panier CRM:'))

    expect(cartBirthTable).toContain('Inconnus')
    expect(cartBirthTable).toContain('Total journee')
    expect(cartBirthTable).not.toContain('Non attribue')
    expect(cartBirthText).not.toContain('Non attribue')
    expect(html).toContain('paniers nes sans session exploitable 2')
    expect(text).toContain('Paniers nes sans session exploitable: 2')
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
