// Abandoned-cart email — React Email component.
//
// 3 adaptive layouts based on items.length:
//   - 1 product  → Hero: large centered product image + Playfair title
//   - 2 products → Duo : 2-column grid (matches the "you may also like" style)
//   - 3+ products → ListGrey: same image+title layout but on a grey background
//                   (downplays a busy cart, emphasis on the discovery section)
//
// "Ça devrait aussi vous plaire" 3-up grid is rendered ONLY when 1 ≤ items.length ≤ 2
// AND placed RIGHT AFTER the secondary CTA (RETROUVER MON PANIER).
// Then a "Les bijoux Palas sont :" heading introduces the 4 USPs.
//
// V1 design: NO prices in the email.

import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import type * as React from 'react'
import { type Locale, STRINGS } from './strings'
import { pickSuggested, type SuggestedProduct, suggestedProductUrl } from './suggested-products'

const ASSET_BASE = 'https://d3k81ch9hvuctc.cloudfront.net/company/VeFGwD/images'
const LOGO = `${ASSET_BASE}/3d0122af-ab8b-40df-b454-dad4088a01d8.jpeg`
const HERO = `${ASSET_BASE}/5133aaec-abc9-49b1-b93c-4feb18894cc1.jpeg`
const DECO_PALM = `${ASSET_BASE}/d152e8a0-e093-4403-acf9-047d079d8abd.jpeg`
const FOOTER_DECO = `${ASSET_BASE}/2982a0eb-5e22-4e4c-8bd2-da690775978a.jpeg`
const USP_HANDMADE = `${ASSET_BASE}/d536e3d8-fd78-4ba2-8de0-66bec6f93772.jpeg`
const USP_WATERPROOF = `${ASSET_BASE}/dba2e3a2-570c-43f4-9458-f88d5a5cb992.jpeg`
const USP_EXPRESS = `${ASSET_BASE}/c5aa04c6-e15e-4592-95d3-cbfc2acfb319.jpeg`
const USP_WARRANTY = `${ASSET_BASE}/51f1c760-8a3f-4140-8188-c1af2ac562ed.jpeg`
const ITEM_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='

const CTA_COLOR = '#C89934'
const CONTAINER_WIDTH = 600
const BODY_FONT = 'Inter, Arial, sans-serif'
const HEAD_FONT = '"Playfair Display", Palatino, serif'

// Mobile responsive overlay.
const MOBILE_CSS = `
@media only screen and (max-width: 600px) {
  .px-tight { padding-left: 16px !important; padding-right: 16px !important; }
}
@media only screen and (max-width: 480px) {
  .stack { display: block !important; width: 100% !important; padding: 12px 0 !important; }
}
`

export interface AbandonedCartItem {
  id: string | number | null
  title: string
  quantity: number
  /** Net line price (post existing cart discount, pre Mother's Day -15%). */
  line_price?: number | null
  image_url?: string | null
}

export interface AbandonedCartEmailProps {
  locale: Locale
  firstName?: string | null
  items: AbandonedCartItem[]
  /** ISO currency code (EUR, USD, …) — used to format prices. Defaults to 'EUR'. */
  currency?: string
  recoveryUrl: string
  unsubscribeUrl: string
}

// Mother's Day 2026 promo: -15% off catalog. TEMPORAIRE — see strings.ts header.
const PROMO_DISCOUNT = 0.15

function formatMoney(amount: number, currency: string, locale: Locale): string {
  const intlLocale = locale === 'fr' ? 'fr-FR' : 'en-US'
  try {
    return new Intl.NumberFormat(intlLocale, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

interface PricePair {
  original: string
  discounted: string
}

function priceFor(item: AbandonedCartItem, currency: string, locale: Locale): PricePair | null {
  if (typeof item.line_price !== 'number' || !Number.isFinite(item.line_price) || item.line_price <= 0) return null
  return {
    original: formatMoney(item.line_price, currency, locale),
    discounted: formatMoney(item.line_price * (1 - PROMO_DISCOUNT), currency, locale),
  }
}

export function AbandonedCartEmail(props: AbandonedCartEmailProps): React.ReactElement {
  const { locale, items, recoveryUrl, unsubscribeUrl } = props
  const currency = props.currency ?? 'EUR'
  const t = STRINGS[locale]
  const showSuggested = items.length >= 1 && items.length <= 2
  const suggested: SuggestedProduct[] = showSuggested
    ? pickSuggested(
        items.map((i) => i.title),
        3,
      )
    : []

  return (
    <Html lang={locale}>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: required for inline <style> in email HTML; MOBILE_CSS is a static string */}
        <style dangerouslySetInnerHTML={{ __html: MOBILE_CSS }} />
      </Head>
      <Preview>{t.preview}</Preview>
      <Body style={{ backgroundColor: '#ffffff', margin: 0, padding: 0, fontFamily: BODY_FONT, color: '#0e1f27' }}>
        <Container style={{ width: CONTAINER_WIDTH, maxWidth: '100%', margin: '0 auto', padding: 0 }}>
          {/* ── Logo banner ──────────────────────────────────────────── */}
          <Section style={{ padding: 0, textAlign: 'center' }}>
            <Link href={recoveryUrl} style={{ display: 'block' }}>
              <Img
                src={LOGO}
                alt="PALAS"
                width={CONTAINER_WIDTH}
                style={{ display: 'block', width: '100%', maxWidth: '100%', height: 'auto', border: 0 }}
              />
            </Link>
          </Section>

          {/* ── Hero text image ──────────────────────────────────────── */}
          <Section style={{ textAlign: 'center', padding: '48px 16px 24px' }}>
            <Img
              src={HERO}
              alt={t.heading}
              width="350"
              style={{
                display: 'block',
                margin: '0 auto',
                width: '350px',
                maxWidth: '100%',
                height: 'auto',
                border: 0,
              }}
            />
          </Section>

          {/* ── Body intro ───────────────────────────────────────────── */}
          <Section className="px-tight" style={{ padding: '0 50px 24px', textAlign: 'center' }}>
            <Text style={{ fontSize: 14, lineHeight: 1.5, margin: 0, color: '#000000' }}>
              {t.subHeading}
              <br />
              <br />
              {t.body}
              {t.bodyEmphasis ? <strong>{t.bodyEmphasis}</strong> : null}
            </Text>
          </Section>

          {/* ── Primary CTA ──────────────────────────────────────────── */}
          <Section style={{ textAlign: 'center', padding: '0 18px 24px' }}>
            <CTAButton href={recoveryUrl} label={t.cta1} />
          </Section>

          {/* ── Cart items — adaptive layout ─────────────────────────── */}
          {items.length === 1 && (
            <HeroProduct item={items[0]} recoveryUrl={recoveryUrl} currency={currency} locale={locale} />
          )}
          {items.length === 2 && (
            <DuoGrid items={items} recoveryUrl={recoveryUrl} currency={currency} locale={locale} />
          )}
          {items.length >= 3 && (
            <ListLayout items={items} recoveryUrl={recoveryUrl} currency={currency} locale={locale} />
          )}

          {/* ── Secondary CTA ────────────────────────────────────────── */}
          <Section style={{ textAlign: 'center', padding: '24px 18px 24px' }}>
            <CTAButton href={recoveryUrl} label={t.cta2} />
          </Section>

          {/* ── Suggested products — IMMEDIATELY after CTA2, only if 1-2 cart items ── */}
          {showSuggested && suggested.length > 0 && (
            <SuggestedProductsSection heading={t.suggestedHeading} products={suggested} />
          )}

          {/* ── "Les bijoux Palas sont :" + USPs ─────────────────────── */}
          <Section style={{ padding: '24px 16px 0', textAlign: 'center' }}>
            <Text
              style={{
                fontFamily: HEAD_FONT,
                fontSize: 28,
                lineHeight: 1.2,
                margin: 0,
                fontWeight: 400,
                color: '#000000',
                textAlign: 'center',
              }}
            >
              {t.uspsHeading}
            </Text>
          </Section>
          <Section className="px-tight" style={{ padding: '24px 75px 32px' }}>
            <UspRow left={[USP_HANDMADE, t.usp1Title, t.usp1Body]} right={[USP_WATERPROOF, t.usp2Title, t.usp2Body]} />
            <UspRow left={[USP_EXPRESS, t.usp3Title, t.usp3Body]} right={[USP_WARRANTY, t.usp4Title, t.usp4Body]} />
          </Section>

          {/* ── Decorative palm break ────────────────────────────────── */}
          <Section style={{ padding: '0 0 24px', textAlign: 'center' }}>
            <Img
              src={DECO_PALM}
              alt=""
              width="250"
              style={{
                display: 'block',
                margin: '0 auto',
                width: '250px',
                maxWidth: '100%',
                height: 'auto',
                border: 0,
              }}
            />
          </Section>

          {/* ── Contact ─────────────────────────────────────────────── */}
          <Section className="px-tight" style={{ padding: '16px 75px 48px', textAlign: 'center' }}>
            <Text style={{ fontSize: 14, lineHeight: 1.5, color: '#000000', margin: 0, textAlign: 'center' }}>
              {t.contactBefore}
              <Link href="mailto:hello@fancypalas.com" style={{ color: '#000000', textDecoration: 'underline' }}>
                hello@fancypalas.com
              </Link>
            </Text>
          </Section>

          {/* ── Footer palm logo ─────────────────────────────────────── */}
          <Section style={{ padding: 0, textAlign: 'center' }}>
            <Img
              src={FOOTER_DECO}
              alt="PALAS"
              width="438"
              style={{
                display: 'block',
                margin: '0 auto',
                width: '438px',
                maxWidth: '100%',
                height: 'auto',
                border: 0,
              }}
            />
          </Section>

          {/* ── Unsubscribe ─────────────────────────────────────────── */}
          <Section style={{ padding: '9px 18px', textAlign: 'center' }}>
            <Text
              style={{
                fontSize: 14,
                fontWeight: 600,
                lineHeight: 1.5,
                margin: 0,
                color: '#0e1f27',
                textAlign: 'center',
              }}
            >
              {t.unsubscribeBefore}
              <Link href={unsubscribeUrl} style={{ color: '#929292', textDecoration: 'underline' }}>
                {t.unsubscribeLink}
              </Link>
              .
            </Text>
          </Section>

          <Hr style={{ borderColor: 'transparent', height: 1, margin: 0 }} />
        </Container>
      </Body>
    </Html>
  )
}

export default AbandonedCartEmail

// ───────────────────────── Sub-components ────────────────────────────

function CTAButton({ href, label }: { href: string; label: string }): React.ReactElement {
  return (
    <Button
      href={href}
      style={{
        backgroundColor: CTA_COLOR,
        color: '#ffffff',
        padding: '10px 45px',
        fontSize: 15,
        fontWeight: 400,
        textDecoration: 'none',
        borderRadius: 0,
        display: 'inline-block',
        fontFamily: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
      }}
    >
      {label}
    </Button>
  )
}

// Layout 1 — Hero Product (single product, big image + serif title).
function HeroProduct({
  item,
  recoveryUrl,
  currency,
  locale,
}: {
  item: AbandonedCartItem
  recoveryUrl: string
  currency: string
  locale: Locale
}): React.ReactElement {
  const price = priceFor(item, currency, locale)
  return (
    <Section style={{ padding: '0 24px 8px', textAlign: 'center' }}>
      <Link href={recoveryUrl} style={{ textDecoration: 'none' }}>
        <Img
          src={item.image_url ?? ITEM_PLACEHOLDER}
          alt={item.title}
          width="420"
          style={{
            display: 'block',
            margin: '0 auto',
            width: '420px',
            maxWidth: '100%',
            height: 'auto',
            border: 0,
          }}
        />
      </Link>
      <Text
        style={{
          fontFamily: HEAD_FONT,
          fontSize: 28,
          lineHeight: 1.2,
          margin: '20px 0 0',
          fontWeight: 400,
          color: '#000000',
          textAlign: 'center',
        }}
      >
        {item.title}
      </Text>
      {price && (
        <Text style={{ fontSize: 18, lineHeight: 1.3, margin: '10px 0 0', textAlign: 'center', color: '#000000' }}>
          <span style={{ textDecoration: 'line-through', color: '#888888', marginRight: 8 }}>{price.original}</span>
          <strong style={{ color: CTA_COLOR }}>{price.discounted}</strong>
        </Text>
      )}
    </Section>
  )
}

// Layout 2 — Duo (2 products as 2-column grid, like "you may also like").
function DuoGrid({
  items,
  recoveryUrl,
  currency,
  locale,
}: {
  items: AbandonedCartItem[]
  recoveryUrl: string
  currency: string
  locale: Locale
}): React.ReactElement {
  return (
    <Section style={{ padding: '0 24px' }}>
      <Row>
        {items.map((item, idx) => (
          <ProductCard
            // biome-ignore lint/suspicious/noArrayIndexKey: rendered once
            key={`${item.id ?? 'i'}-${idx}`}
            href={recoveryUrl}
            image={item.image_url ?? ITEM_PLACEHOLDER}
            title={item.title}
            widthPct="50%"
            maxImg={260}
            price={priceFor(item, currency, locale)}
          />
        ))}
      </Row>
    </Section>
  )
}

// Layout 3 — List (3+ products): identical to Duo (same card style, same
// image size 260px, same white background, same black titles), just chunked
// into pairs. Odd count → the last item is centered via 25% / 50% / 25%
// flanking columns.
function ListLayout({
  items,
  recoveryUrl,
  currency,
  locale,
}: {
  items: AbandonedCartItem[]
  recoveryUrl: string
  currency: string
  locale: Locale
}): React.ReactElement {
  const pairs: Array<[AbandonedCartItem, AbandonedCartItem | null]> = []
  for (let i = 0; i < items.length; i += 2) {
    pairs.push([items[i], items[i + 1] ?? null])
  }

  return (
    <Section style={{ padding: '0 24px' }}>
      {pairs.map(([a, b], rowIdx) =>
        b ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: rendered once
          <Row key={`row-${rowIdx}`}>
            <ProductCard
              href={recoveryUrl}
              image={a.image_url ?? ITEM_PLACEHOLDER}
              title={a.title}
              widthPct="50%"
              maxImg={260}
              price={priceFor(a, currency, locale)}
            />
            <ProductCard
              href={recoveryUrl}
              image={b.image_url ?? ITEM_PLACEHOLDER}
              title={b.title}
              widthPct="50%"
              maxImg={260}
              price={priceFor(b, currency, locale)}
            />
          </Row>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: rendered once
          <Row key={`row-${rowIdx}`}>
            <Column className="stack" style={{ width: '25%' }} />
            <ProductCard
              href={recoveryUrl}
              image={a.image_url ?? ITEM_PLACEHOLDER}
              title={a.title}
              widthPct="50%"
              maxImg={260}
              price={priceFor(a, currency, locale)}
            />
            <Column className="stack" style={{ width: '25%' }} />
          </Row>
        ),
      )}
    </Section>
  )
}

function ProductCard({
  href,
  image,
  title,
  widthPct,
  maxImg,
  price,
}: {
  href: string
  image: string
  title: string
  widthPct: string
  maxImg: number
  price?: PricePair | null
}): React.ReactElement {
  return (
    <Column
      className="stack"
      style={{ width: widthPct, padding: '8px 8px', verticalAlign: 'top', textAlign: 'center' }}
    >
      <Link href={href} style={{ textDecoration: 'none' }}>
        <Img
          src={image}
          alt={title}
          width={String(maxImg)}
          style={{
            display: 'block',
            margin: '0 auto',
            width: '100%',
            maxWidth: `${maxImg}px`,
            height: 'auto',
            border: 0,
          }}
        />
        <Text
          style={{
            fontFamily: BODY_FONT,
            fontSize: 13,
            lineHeight: 1.4,
            margin: '10px 0 0',
            fontWeight: 400,
            color: '#000000',
            textAlign: 'center',
            textDecoration: 'underline',
          }}
        >
          {title}
        </Text>
      </Link>
      {price && (
        <Text style={{ fontSize: 13, lineHeight: 1.3, margin: '4px 0 0', textAlign: 'center', color: '#000000' }}>
          <span style={{ textDecoration: 'line-through', color: '#888888', marginRight: 6 }}>{price.original}</span>
          <strong style={{ color: CTA_COLOR }}>{price.discounted}</strong>
        </Text>
      )}
    </Column>
  )
}

// "Ça devrait aussi vous plaire" — 3 products, picked from pool excluding cart.
function SuggestedProductsSection({
  heading,
  products,
}: {
  heading: string
  products: SuggestedProduct[]
}): React.ReactElement {
  return (
    <>
      <Section style={{ padding: '24px 16px 16px', textAlign: 'center' }}>
        <Text
          style={{
            fontFamily: HEAD_FONT,
            fontSize: 28,
            lineHeight: 1.2,
            margin: 0,
            fontWeight: 400,
            color: '#000000',
            textAlign: 'center',
          }}
        >
          {heading}
        </Text>
      </Section>
      <Section style={{ padding: '0 24px 32px' }}>
        <Row>
          {products.map((p) => (
            <ProductCard
              key={p.handle}
              href={suggestedProductUrl(p.handle)}
              image={p.imageUrl}
              title={p.title}
              widthPct="33.33%"
              maxImg={170}
            />
          ))}
        </Row>
      </Section>
    </>
  )
}

function UspRow({
  left,
  right,
}: {
  left: [string, string, string]
  right: [string, string, string]
}): React.ReactElement {
  return (
    <Row>
      <UspColumn img={left[0]} title={left[1]} body={left[2]} />
      <UspColumn img={right[0]} title={right[1]} body={right[2]} />
    </Row>
  )
}

function UspColumn({ img, title, body }: { img: string; title: string; body: string }): React.ReactElement {
  return (
    <Column className="stack" style={{ width: '50%', padding: '4px 0', verticalAlign: 'top', textAlign: 'center' }}>
      <Img src={img} alt="" width="65" style={{ display: 'block', margin: '0 auto', border: 0 }} />
      <Text
        style={{
          fontSize: 14,
          fontWeight: 700,
          margin: '8px 0 4px',
          color: '#0e1f27',
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      <Text style={{ fontSize: 14, margin: 0, color: '#667085', textAlign: 'center' }}>{body}</Text>
    </Column>
  )
}
