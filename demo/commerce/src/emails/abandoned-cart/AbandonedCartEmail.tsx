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
  Heading,
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
import { type AbandonedCartMessageType, ASSISTANCE_COPY, type DiscountKind, REMINDER_COPY } from './sequence-strings'
import { type AbandonedCartStrings, type Locale, STRINGS } from './strings'
import { pickSuggested, type SuggestedProduct, suggestedProductUrl } from './suggested-products'

const ASSET_BASE = 'https://d3k81ch9hvuctc.cloudfront.net/company/VeFGwD/images'
// Source: Klaviyo flow "04 | Panier Abandonné" (templates XievGd, SC8bep and WjabxS).
const EMAIL_1_HEADER = `${ASSET_BASE}/3d0122af-ab8b-40df-b454-dad4088a01d8.jpeg`
const EMAIL_2_HEADER = `${ASSET_BASE}/2ad06794-ddad-4fe8-a9f8-770c54dcf786.jpeg`
const EMAIL_3_HEADER = `${ASSET_BASE}/d5b52b1f-3aa4-480c-9280-f8de3944b486.jpeg`
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
const HEAD_FONT = 'Didot, "Bodoni 72", "Cormorant Garamond", "Times New Roman", serif'
const REMINDER_FONT = '"Nunito Sans", "Nunito-Sans-Klaviyo-Hosted", Arial, sans-serif'
const ASSISTANCE_FONT = 'Times, "Times New Roman", serif'
const RETINA_IMAGE_SCALE = 2

// Mobile responsive overlay.
const MOBILE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400&family=Nunito+Sans:wght@400;700&display=swap');
body { width: 100% !important; margin: 0 !important; padding: 0 !important; }
.email-container { width: 100% !important; }
@media only screen and (max-width: 600px) {
  .email-container { width: 100% !important; max-width: 600px !important; }
  .px-tight { padding-left: 16px !important; padding-right: 16px !important; }
  .hero-heading { font-size: 34px !important; line-height: 0.98 !important; }
  .email-two-heading { font-size: 28px !important; line-height: 1.3 !important; }
}
@media only screen and (max-width: 480px) {
  .stack { display: block !important; width: 100% !important; padding: 12px 0 !important; }
}
`

export interface AbandonedCartItem {
  id: string | number | null
  title: string
  quantity: number
  /** Net line price. Kept for future variants, not rendered in V1 emails. */
  line_price?: number | null
  image_url?: string | null
}

export interface AbandonedCartEmailProps {
  messageType?: AbandonedCartMessageType
  locale: Locale
  firstName?: string | null
  items: AbandonedCartItem[]
  /** ISO currency code (EUR, USD, …). Kept for compatibility with callers. */
  currency?: string
  recoveryUrl: string
  unsubscribeUrl: string
  discountCode?: string | null
  discountKind?: DiscountKind | null
}

export function AbandonedCartEmail(props: AbandonedCartEmailProps): React.ReactElement {
  const {
    messageType = 'abandoned_cart_1',
    locale,
    firstName,
    items,
    recoveryUrl,
    unsubscribeUrl,
    discountCode,
    discountKind = discountCode ? 'welcome' : null,
  } = props
  const t = STRINGS[locale]
  const showSuggested = messageType === 'abandoned_cart_1' && items.length >= 1 && items.length <= 2
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
      <Preview>
        {messageType === 'abandoned_cart_2'
          ? REMINDER_COPY[locale].preview
          : messageType === 'abandoned_cart_3'
            ? ASSISTANCE_COPY[locale].preview
            : t.preview}
      </Preview>
      <Body style={{ backgroundColor: '#ffffff', margin: 0, padding: 0, fontFamily: BODY_FONT, color: '#0e1f27' }}>
        <Container
          className="email-container"
          style={{ width: '100%', maxWidth: CONTAINER_WIDTH, margin: '0 auto', padding: 0 }}
        >
          <EmailHeader messageType={messageType} recoveryUrl={recoveryUrl} />

          {messageType === 'abandoned_cart_1' ? (
            <FirstReminderContent
              discountCode={discountCode}
              discountKind={discountKind}
              items={items}
              locale={locale}
              recoveryUrl={recoveryUrl}
              suggested={suggested}
              t={t}
            />
          ) : messageType === 'abandoned_cart_2' ? (
            <SecondReminderContent
              discountCode={discountCode}
              discountKind={discountKind}
              items={items}
              locale={locale}
              recoveryUrl={recoveryUrl}
            />
          ) : (
            <AssistanceContent
              discountCode={discountCode}
              discountKind={discountKind}
              firstName={firstName}
              items={items}
              locale={locale}
              recoveryUrl={recoveryUrl}
            />
          )}

          {/* ── Shared reassurance title + USPs ───────────────────────── */}
          <Section style={{ padding: '24px 16px 0', textAlign: 'center' }}>
            <Img
              src={DECO_PALM}
              alt={t.uspsHeading}
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
          <Section className="px-tight" style={{ padding: '24px 75px 32px' }}>
            <UspRow left={[USP_HANDMADE, t.usp1Title, t.usp1Body]} right={[USP_WATERPROOF, t.usp2Title, t.usp2Body]} />
            <UspRow left={[USP_EXPRESS, t.usp3Title, t.usp3Body]} right={[USP_WARRANTY, t.usp4Title, t.usp4Body]} />
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

function EmailHeader({
  messageType,
  recoveryUrl,
}: {
  messageType: AbandonedCartMessageType
  recoveryUrl: string
}): React.ReactElement {
  const compact = messageType === 'abandoned_cart_3'
  const src =
    messageType === 'abandoned_cart_2'
      ? EMAIL_2_HEADER
      : messageType === 'abandoned_cart_3'
        ? EMAIL_3_HEADER
        : EMAIL_1_HEADER
  const width = compact ? 160 : CONTAINER_WIDTH

  return (
    <Section style={{ padding: compact ? '36px 16px 20px' : 0, textAlign: 'center' }}>
      <Link href={recoveryUrl} style={{ display: 'block' }}>
        <Img
          src={src}
          alt="PALAS"
          width={String(width)}
          style={{
            display: 'block',
            margin: '0 auto',
            width: compact ? `${width}px` : '100%',
            maxWidth: '100%',
            height: 'auto',
            border: 0,
          }}
        />
      </Link>
    </Section>
  )
}

function FirstReminderContent({
  discountCode,
  discountKind,
  items,
  locale,
  recoveryUrl,
  suggested,
  t,
}: {
  discountCode?: string | null
  discountKind: DiscountKind | null
  items: AbandonedCartItem[]
  locale: Locale
  recoveryUrl: string
  suggested: SuggestedProduct[]
  t: AbandonedCartStrings
}): React.ReactElement {
  return (
    <>
      <LiveHeading>{t.heading}</LiveHeading>
      <Section className="px-tight" style={{ padding: '0 50px 24px', textAlign: 'center' }}>
        <Text style={{ fontSize: 14, lineHeight: 1.5, margin: 0, color: '#000000' }}>
          {t.subHeading}
          <br />
          <br />
          {t.body}
          {t.bodyEmphasis ? <strong>{t.bodyEmphasis}</strong> : null}
        </Text>
      </Section>
      {discountCode ? (
        <DiscountCodeBlock code={discountCode} discountKind={discountKind} locale={locale} t={t} />
      ) : null}
      <Section style={{ textAlign: 'center', padding: '0 18px 24px' }}>
        <CTAButton href={recoveryUrl} label={t.cta1} />
      </Section>
      {items.length === 1 && <HeroProduct item={items[0]} recoveryUrl={recoveryUrl} />}
      {items.length === 2 && <DuoGrid items={items} recoveryUrl={recoveryUrl} />}
      {items.length >= 3 && <ListLayout items={items} recoveryUrl={recoveryUrl} />}
      <Section style={{ textAlign: 'center', padding: '24px 18px' }}>
        <CTAButton href={recoveryUrl} label={t.cta2} />
      </Section>
      {suggested.length > 0 ? <SuggestedProductsSection heading={t.suggestedHeading} products={suggested} /> : null}
    </>
  )
}

function SecondReminderContent({
  discountCode,
  discountKind,
  items,
  locale,
  recoveryUrl,
}: {
  discountCode?: string | null
  discountKind: DiscountKind | null
  items: AbandonedCartItem[]
  locale: Locale
  recoveryUrl: string
}): React.ReactElement {
  const copy = REMINDER_COPY[locale]
  const heading =
    discountKind === 'welcome' ? copy.welcomeHeading : discountKind === 'recovery' ? copy.recoveryHeading : copy.heading
  const promotionBody =
    discountKind === 'welcome' ? copy.welcomeBody : discountKind === 'recovery' ? copy.recoveryBody : null
  return (
    <>
      <LiveHeading variant="reminder">{heading}</LiveHeading>
      <Section className="px-tight" style={{ padding: '0 50px 20px', textAlign: 'center' }}>
        <Text style={{ fontFamily: REMINDER_FONT, fontSize: 16, lineHeight: 1.5, margin: 0, color: '#000000' }}>
          {copy.body}
          {promotionBody ? (
            <>
              <br />
              <br />
              {promotionBody}
            </>
          ) : null}
        </Text>
      </Section>
      {discountCode ? <SequenceDiscountCode code={discountCode} fontFamily={REMINDER_FONT} locale={locale} /> : null}
      <CartSnapshot items={items} locale={locale} recoveryUrl={recoveryUrl} />
      <Section style={{ textAlign: 'center', padding: '4px 18px 40px' }}>
        <CTAButton fontFamily={REMINDER_FONT} href={recoveryUrl} label={discountCode ? copy.promotionCta : copy.cta} />
      </Section>
    </>
  )
}

function AssistanceContent({
  discountCode,
  discountKind,
  firstName,
  items,
  locale,
  recoveryUrl,
}: {
  discountCode?: string | null
  discountKind: DiscountKind | null
  firstName?: string | null
  items: AbandonedCartItem[]
  locale: Locale
  recoveryUrl: string
}): React.ReactElement {
  const copy = ASSISTANCE_COPY[locale]
  const greeting = firstName?.trim() ? `${copy.greeting} ${firstName.trim()},` : `${copy.greeting},`
  const promotionCompletion =
    discountKind === 'welcome' ? copy.welcomeCompletion : discountKind === 'recovery' ? copy.recoveryCompletion : null
  return (
    <>
      <Section className="px-tight" style={{ padding: '24px 50px 12px', textAlign: 'left' }}>
        <Text
          style={{ fontFamily: ASSISTANCE_FONT, fontSize: 18, lineHeight: 1.3, margin: '0 0 18px', color: '#000000' }}
        >
          {greeting}
        </Text>
        <Text
          style={{ fontFamily: ASSISTANCE_FONT, fontSize: 18, lineHeight: 1.3, margin: '0 0 18px', color: '#000000' }}
        >
          {copy.intro}
        </Text>
        <Text
          style={{ fontFamily: ASSISTANCE_FONT, fontSize: 18, lineHeight: 1.3, margin: '0 0 10px', color: '#000000' }}
        >
          {copy.practicalIntro}
        </Text>
        {copy.benefits.map((benefit) => (
          <Text
            key={benefit}
            style={{ fontFamily: ASSISTANCE_FONT, fontSize: 18, lineHeight: 1.3, margin: '0 0 7px', color: '#000000' }}
          >
            • {benefit}
          </Text>
        ))}
        <Text
          style={{ fontFamily: ASSISTANCE_FONT, fontSize: 18, lineHeight: 1.3, margin: '20px 0 0', color: '#000000' }}
        >
          {copy.completion}
          {promotionCompletion ? ` ${promotionCompletion}` : ''}
        </Text>
      </Section>
      {discountCode ? <SequenceDiscountCode code={discountCode} fontFamily={ASSISTANCE_FONT} locale={locale} /> : null}
      <CartSnapshot items={items} locale={locale} recoveryUrl={recoveryUrl} />
      <Section style={{ textAlign: 'center', padding: '8px 18px 28px' }}>
        <CTAButton href={recoveryUrl} label={copy.cta} />
      </Section>
      <Section className="px-tight" style={{ padding: '0 50px 34px', textAlign: 'left' }}>
        <Text
          style={{
            fontFamily: ASSISTANCE_FONT,
            fontSize: 18,
            lineHeight: 1.3,
            margin: 0,
            color: '#000000',
            whiteSpace: 'pre-line',
          }}
        >
          {copy.signoff}
        </Text>
      </Section>
    </>
  )
}

function LiveHeading({
  children,
  variant = 'editorial',
}: {
  children: string
  variant?: 'editorial' | 'reminder'
}): React.ReactElement {
  const reminder = variant === 'reminder'
  return (
    <Section style={{ textAlign: 'center', padding: '48px 16px 24px' }}>
      <Heading
        as="h1"
        className={reminder ? 'email-two-heading' : 'hero-heading'}
        style={{
          fontFamily: reminder ? REMINDER_FONT : HEAD_FONT,
          fontSize: reminder ? 44 : 43,
          lineHeight: reminder ? 1.1 : 0.98,
          letterSpacing: reminder ? 0 : '-0.02em',
          margin: '0 auto',
          maxWidth: 560,
          fontWeight: 400,
          color: '#000000',
          textAlign: 'center',
        }}
      >
        {children}
      </Heading>
    </Section>
  )
}

function DiscountCodeBlock({
  code,
  discountKind,
  locale,
  t,
}: {
  code: string
  discountKind: DiscountKind | null
  locale: Locale
  t: AbandonedCartStrings
}): React.ReactElement {
  const intro =
    discountKind === 'recovery'
      ? locale === 'fr'
        ? 'Pour vous aider à finaliser ce panier, nous vous offrons exceptionnellement -10% :'
        : 'To help you complete this basket, we’re offering you an exceptional 10% off:'
      : t.discountIntro
  return (
    <Section className="px-tight" style={{ padding: '0 50px 24px', textAlign: 'center' }}>
      <Text style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 10px', color: '#000000' }}>{intro}</Text>
      <PromoCode code={code} label={t.discountCodeLabel} />
      <Text style={{ fontSize: 12, lineHeight: 1.5, margin: 0, color: '#555555' }}>{t.discountFootnote}</Text>
    </Section>
  )
}

function SequenceDiscountCode({
  code,
  fontFamily,
  locale,
}: {
  code: string
  fontFamily: string
  locale: Locale
}): React.ReactElement {
  return (
    <Section className="px-tight" style={{ padding: '0 50px 22px', textAlign: 'center' }}>
      <PromoCode code={code} fontFamily={fontFamily} label={locale === 'fr' ? 'Code promo' : 'Promo code'} />
    </Section>
  )
}

function PromoCode({
  code,
  fontFamily,
  label,
}: {
  code: string
  fontFamily?: string
  label: string
}): React.ReactElement {
  return (
    <Text
      style={{
        fontSize: 18,
        lineHeight: 1.2,
        margin: '0 auto 10px',
        color: '#000000',
        fontWeight: 700,
        letterSpacing: 0,
        fontFamily: fontFamily ?? 'Arial, "Helvetica Neue", Helvetica, sans-serif',
      }}
    >
      {label} : {code}
    </Text>
  )
}

function CartSnapshot({
  items,
  locale,
  recoveryUrl,
}: {
  items: AbandonedCartItem[]
  locale: Locale
  recoveryUrl: string
}): React.ReactElement | null {
  if (items.length === 0) return null
  return (
    <Section style={{ padding: '4px 0 20px', textAlign: 'center' }}>
      <Text
        style={{
          fontFamily: BODY_FONT,
          fontSize: 16,
          lineHeight: 1.3,
          margin: '0 0 16px',
          color: '#000000',
          fontWeight: 700,
          textAlign: 'center',
        }}
      >
        {locale === 'fr' ? 'VOTRE PANIER' : 'YOUR BASKET'}
      </Text>
      <ListLayout items={items} recoveryUrl={recoveryUrl} />
    </Section>
  )
}

function CTAButton({
  fontFamily,
  href,
  label,
}: {
  fontFamily?: string
  href: string
  label: string
}): React.ReactElement {
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
        fontFamily: fontFamily ?? 'Arial, "Helvetica Neue", Helvetica, sans-serif',
      }}
    >
      {label}
    </Button>
  )
}

// Layout 1 — Hero Product (single product, big image + serif title).
function HeroProduct({ item, recoveryUrl }: { item: AbandonedCartItem; recoveryUrl: string }): React.ReactElement {
  const imageWidth = 420

  return (
    <Section style={{ padding: '0 24px 8px', textAlign: 'center' }}>
      <Link href={recoveryUrl} style={{ textDecoration: 'none' }}>
        <Img
          src={emailImageSrc(item.image_url ?? ITEM_PLACEHOLDER, imageWidth)}
          alt={item.title}
          width={String(imageWidth)}
          style={{
            display: 'block',
            margin: '0 auto',
            width: `${imageWidth}px`,
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
    </Section>
  )
}

// Layout 2 — Duo (2 products as 2-column grid, like "you may also like").
function DuoGrid({ items, recoveryUrl }: { items: AbandonedCartItem[]; recoveryUrl: string }): React.ReactElement {
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
function ListLayout({ items, recoveryUrl }: { items: AbandonedCartItem[]; recoveryUrl: string }): React.ReactElement {
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
            />
            <ProductCard
              href={recoveryUrl}
              image={b.image_url ?? ITEM_PLACEHOLDER}
              title={b.title}
              widthPct="50%"
              maxImg={260}
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
}: {
  href: string
  image: string
  title: string
  widthPct: string
  maxImg: number
}): React.ReactElement {
  return (
    <Column
      className="stack"
      style={{ width: widthPct, padding: '8px 8px', verticalAlign: 'top', textAlign: 'center' }}
    >
      <Link href={href} style={{ textDecoration: 'none' }}>
        <Img
          src={emailImageSrc(image, maxImg)}
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
      </Link>
      <Text
        style={{
          fontFamily: BODY_FONT,
          fontSize: 13,
          lineHeight: 1.4,
          margin: '10px 0 0',
          fontWeight: 400,
          textAlign: 'center',
        }}
      >
        <Link
          href={href}
          style={{
            color: '#000000',
            textDecoration: 'underline',
          }}
        >
          {title}
        </Link>
      </Text>
    </Column>
  )
}

function emailImageSrc(src: string, displayWidth: number): string {
  if (src.startsWith('data:')) return src
  const requestedWidth = displayWidth * RETINA_IMAGE_SCALE
  return shopifyImageUrl(src, requestedWidth)
}

function shopifyImageUrl(src: string, width: number): string {
  try {
    const url = new URL(src)
    if (url.hostname !== 'cdn.shopify.com') return src
    url.searchParams.set('width', String(width))
    if (/\.(jpe?g)$/i.test(url.pathname)) {
      url.searchParams.set('format', 'pjpg')
    }
    return url.toString()
  } catch {
    return src
  }
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
