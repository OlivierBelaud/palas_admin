import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const commandsDirectory = new URL('../src/commands/admin/', import.meta.url)

describe('abandoned-cart command source boundary', () => {
  it('keeps admin commands off the legacy direct-send helper', async () => {
    const commandFiles = (await readdir(commandsDirectory)).filter((name) => name.endsWith('.ts'))
    const sources = await Promise.all(
      commandFiles.map(async (name) => ({
        name,
        source: await readFile(new URL(name, commandsDirectory), 'utf8'),
      })),
    )

    expect(commandFiles).not.toContain('send-abandoned-cart-email.ts')
    expect(
      sources
        .filter(({ source }) => source.includes('sendAbandonedCartEmailForCart'))
        .map(({ name }) => join('src/commands/admin', name)),
    ).toEqual([])

    const canonical = sources.find(({ name }) => name === 'notify-abandoned-carts.ts')
    expect(canonical?.source).toContain('runAbandonedCartCampaign')
  })
})
