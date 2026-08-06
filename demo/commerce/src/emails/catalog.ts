import {
  type DailyReportPayload,
  dailyReportSubject,
  renderDailyReportHtml,
  renderDailyReportText,
} from '../utils/daily-reporting'
import { renderAbandonedCart } from './abandoned-cart/render'
import { renderAdminInviteEmail } from './admin-invite/render'
import type { EmailTemplatePreviewInput, RenderedEmailTemplatePreview, ReportStatus } from './catalog-contract'
import { renderPaymentHelpEmail } from './payment-help/render'

const RECOVERY_URL = 'https://fancypalas.com/cart/c/mock-preview?utm_source=palas_crm&utm_campaign=abandoned_cart'
const UNSUBSCRIBE_URL = 'https://admin.fancypalas.com/api/contact/unsubscribe?t=preview'
const INVITE_URL = 'https://admin.fancypalas.com/auth/invite?token=preview-token'

export async function renderEmailTemplatePreview(
  input: EmailTemplatePreviewInput,
): Promise<RenderedEmailTemplatePreview> {
  switch (input.templateId) {
    case 'abandoned_cart_1':
    case 'abandoned_cart_2':
    case 'abandoned_cart_3': {
      const discountCode = input.customerStatus === 'new' && input.promotionActive ? 'PALAS-WELCOME-10' : null
      const items = previewItems(input.itemCount)
      const rendered = await renderAbandonedCart({
        locale: input.locale,
        firstName: 'Camille',
        items,
        currency: 'EUR',
        recoveryUrl: RECOVERY_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
        discountCode,
      })
      return {
        ...rendered,
        appliedBranches: [
          input.locale === 'en' ? 'English copy' : 'French copy',
          discountCode
            ? 'Welcome promotion shown'
            : input.customerStatus === 'returning'
              ? 'Welcome promotion hidden: existing customer'
              : 'Welcome promotion hidden: campaign inactive',
          `${items.length} cart item(s)`,
        ],
      }
    }
    case 'payment_help_1': {
      const rendered = renderPaymentHelpEmail({
        locale: input.locale,
        firstName: 'Camille',
        recoveryUrl: RECOVERY_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      })
      return { ...rendered, appliedBranches: [input.locale === 'en' ? 'English copy' : 'French copy'] }
    }
    case 'admin_invite': {
      const rendered = renderAdminInviteEmail(INVITE_URL)
      return { ...rendered, appliedBranches: ['Fixed French copy', 'Invitation link valid for 7 days'] }
    }
    case 'daily_reporting': {
      const payload = buildDailyReportPreviewPayload(input.reportStatus)
      return {
        subject: dailyReportSubject(payload),
        html: renderDailyReportHtml(payload),
        text: renderDailyReportText(payload),
        appliedBranches: [
          input.reportStatus === 'ready' ? 'Complete reporting snapshot' : 'Partial reporting snapshot',
        ],
      }
    }
    default:
      return assertNever(input.templateId)
  }
}

function assertNever(value: never): never {
  throw new MantaError('UNEXPECTED_STATE', `Unsupported email template: ${value}`)
}

function previewItems(count: number) {
  const items = [
    ['Bague Sol', 'https://cdn.shopify.com/s/files/1/0560/3045/2608/files/Bague-sol.jpg'],
    ['Boucles Flora', 'https://cdn.shopify.com/s/files/1/0560/3045/2608/files/Boucles-Flora.jpg'],
    ['Collier Mia', 'https://cdn.shopify.com/s/files/1/0560/3045/2608/files/Collier-Mia.jpg'],
    ['Bracelet Alma', 'https://cdn.shopify.com/s/files/1/0560/3045/2608/files/Bracelet-Alma.jpg'],
  ] as const
  return items.slice(0, Math.max(1, Math.min(4, Math.round(count)))).map(([title, image_url], index) => ({
    id: `preview-${index + 1}`,
    title,
    quantity: 1,
    image_url,
  }))
}

function buildDailyReportPreviewPayload(status: ReportStatus): DailyReportPayload {
  const partial = status === 'partial'
  return {
    day: '2026-08-05',
    timezone: 'Europe/Paris',
    generated_at: '2026-08-06T03:00:00.000Z',
    period: { start_utc: '2026-08-04T22:00:00.000Z', end_utc: '2026-08-05T22:00:00.000Z' },
    summary: {
      sessions: partial ? 0 : 842,
      unique_visitors: partial ? 0 : 691,
      orders: 24,
      revenue: 3248,
      average_order_value: 135.33,
      session_conversion_rate: 0.0285,
      visitor_conversion_rate: 0.0347,
      sold_countries_count: 7,
      unattributed_orders: partial ? 3 : 0,
      unattributed_revenue: partial ? 286 : 0,
      source_max_last_event_at: partial ? null : '2026-08-05T21:58:00.000Z',
    },
    segments: [
      {
        segment: 'unknown',
        label: 'Inconnus',
        sessions: 520,
        unique_visitors: 480,
        orders: 8,
        revenue: 920,
        average_order_value: 115,
        session_conversion_rate: 0.0154,
        visitor_conversion_rate: 0.0167,
      },
      {
        segment: 'returning_customer',
        label: 'Clients',
        sessions: 322,
        unique_visitors: 211,
        orders: 16,
        revenue: 2328,
        average_order_value: 145.5,
        session_conversion_rate: 0.0497,
        visitor_conversion_rate: 0.0758,
      },
    ],
    countries: [
      { country_code: 'FR', country_name: 'France', orders: 18, revenue: 2440 },
      { country_code: 'US', country_name: 'États-Unis', orders: 6, revenue: 808 },
    ],
    cart_summary: {
      carts_created: 96,
      carts_created_visitors: 91,
      carts_created_converted: 18,
      carts_created_conversion_rate: 0.1978,
      carts_updated: 210,
      carts_updated_sessions: 122,
      carts_updated_visitors: 110,
      carts_updated_converted: 20,
      carts_updated_conversion_rate: 0.1818,
      cart_view_events: 308,
      cart_view_sessions: 174,
      cart_view_visitors: 158,
      cart_view_converted: 22,
      cart_view_conversion_rate: 0.1392,
      total_cart_visitors: 184,
      total_cart_converted: 24,
      total_cart_conversion_rate: 0.1304,
      older_cart_orders: 4,
      older_cart_revenue: 492,
    },
    cart_activity_segments: [],
    cart_birth_segments: [],
    abandoned_cart_emails: [
      {
        message_type: 'abandoned_cart_1',
        label: 'Email 1',
        sent: 38,
        opens: 24,
        open_rate: 0.6316,
        clicks: 11,
        click_rate: 0.2895,
        conversions: 5,
        conversion_rate: 0.1316,
        revenue: 624,
      },
      {
        message_type: 'abandoned_cart_2',
        label: 'Email 2',
        sent: 21,
        opens: 12,
        open_rate: 0.5714,
        clicks: 6,
        click_rate: 0.2857,
        conversions: 2,
        conversion_rate: 0.0952,
        revenue: 238,
      },
      {
        message_type: 'abandoned_cart_3',
        label: 'Email 3',
        sent: 12,
        opens: 6,
        open_rate: 0.5,
        clicks: 3,
        click_rate: 0.25,
        conversions: 1,
        conversion_rate: 0.0833,
        revenue: 119,
      },
    ],
    sources: [
      {
        source: 'Meta Ads',
        sessions: 318,
        unique_visitors: 286,
        orders: 9,
        revenue: 1120,
        session_share: 0.3777,
      },
    ],
    channel_segments: [],
  }
}
