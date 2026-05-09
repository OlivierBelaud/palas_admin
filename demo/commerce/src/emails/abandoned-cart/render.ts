// Render the React Email tree to subject/html/text triples.
//
// `@react-email/render` v2 returns a string from `render(node)` (HTML) and a
// plain-text string from `render(node, { plainText: true })`. We compute both
// in parallel.

import { render } from '@react-email/render'
import * as React from 'react'
import { AbandonedCartEmail, type AbandonedCartEmailProps } from './AbandonedCartEmail'
import { STRINGS } from './strings'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export async function renderAbandonedCart(props: AbandonedCartEmailProps): Promise<RenderedEmail> {
  const node = React.createElement(AbandonedCartEmail, props)
  const [html, text] = await Promise.all([render(node), render(node, { plainText: true })])
  return {
    subject: STRINGS[props.locale].subject,
    html,
    text,
  }
}
