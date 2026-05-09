# @manta/adapter-notification-resend

Resend adapter for Manta's `INotificationPort`. Sends transactional email through [Resend](https://resend.com/).

## Install

```bash
pnpm add @manta/adapter-notification-resend
```

## Usage

In `manta.config.ts`:

```ts
import { ResendNotificationAdapter } from '@manta/adapter-notification-resend'

export default defineConfig({
  adapters: {
    notification: () =>
      new ResendNotificationAdapter({
        apiKey: process.env.RESEND_API_KEY,
        defaultFrom: process.env.RESEND_FROM_EMAIL, // "Brand <noreply@domain.com>"
        defaultReplyTo: process.env.RESEND_REPLY_TO,
      }),
  },
})
```

Then from any command/step:

```ts
await ctx.app.notification.send({
  channel: 'email',
  to: 'customer@example.com',
  subject: 'Your order is on its way',
  html: renderedHtml,
  text: renderedText,
  tags: [{ name: 'category', value: 'shipping' }],
})
```

## Behavior

- **Email-only.** Sending other channels throws `MantaError('INVALID_DATA')`.
- **Validation.** Missing `subject`, body (`html` or `text`), or `from` → `INVALID_DATA`.
- **Resend 4xx errors** (validation/auth/quota) → returns `{ status: 'FAILURE', error }`.
- **Network/transport errors** → throws `MantaError('UNEXPECTED_STATE')` so the workflow runner can retry.

## See also

- [Resend SDK docs](https://resend.com/docs/send-with-nodejs)
- `INotificationPort` interface in `@manta/core/ports/notification`
