// Source types for ts-to-zod codegen.
// Running `pnpm gen-schemas` converts this file into src/modules/posthog/schemas.ts with matching Zod schemas.
//
// WRITE side — we pin to posthog-node's SDK types via `satisfies` checks in the generated file.
// READ side — we define these ourselves because posthog-node does not type HogQL query responses.

import type { EventMessage as SdkEventMessage, IdentifyMessage as SdkIdentifyMessage } from 'posthog-node'

// ── Write-side (input for capture / identify) ──────────────────────
// Shapes intentionally mirror posthog-node types — verified at compile time below.

export interface PostHogCaptureInput {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
  timestamp?: Date
  uuid?: string
}

export interface PostHogIdentifyInput {
  distinctId: string
  properties?: Record<string, unknown>
}

// Compile-time drift check: TS fails here if posthog-node changes its EventMessage/IdentifyMessage shape
type _AssertCaptureMatchesSdk = PostHogCaptureInput extends Partial<SdkEventMessage> ? true : false
type _AssertIdentifyMatchesSdk = PostHogIdentifyInput extends Partial<SdkIdentifyMessage> ? true : false
const _assertCapture: _AssertCaptureMatchesSdk = true
const _assertIdentify: _AssertIdentifyMatchesSdk = true
void _assertCapture
void _assertIdentify

// ── Read-side (HogQL query response shapes) ────────────────────────
// posthog-node does not expose these. Shapes match PostHog's documented events/persons table schema.

export interface PostHogEvent {
  uuid: string
  event: string
  distinctId: string
  timestamp: string
  properties: Record<string, unknown>
  personId: string | null
  url: string | null
}

export interface PostHogPerson {
  id: string
  distinctId: string
  email: string | null
  name: string | null
  createdAt: string
  properties: Record<string, unknown>
}

export interface PostHogInsight {
  id: number
  shortId: string | null
  name: string
  description: string | null
  filters: Record<string, unknown>
  createdAt: string
  updatedAt: string | null
}
