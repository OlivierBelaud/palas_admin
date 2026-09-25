#!/usr/bin/env node
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { open, readFile, unlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SCOPE = 'https://www.googleapis.com/auth/datamanager'
const HELP = `Google Ads Data Manager — local Desktop OAuth bootstrap

Usage:
  node demo/commerce/scripts/google-ads-oauth.mjs --credentials /private/desktop-client.json --output /private/.env.google-ads

Enable Data Manager API in the Google Cloud project. Download a Desktop OAuth
client JSON, then run this command on the computer with your browser. Sign in
with the Google account that can access the Palas Google Ads account.
Open the printed Google authorization link; the callback listens only on 127.0.0.1.
Credentials and refresh token are written to a NEW file with mode 0600, never stdout.
The script never uploads events. No developer token or SaaS store is required.

For an external OAuth app, Testing refresh tokens for this scope expire after
7 days. Switch the consent screen to In production, then authorize again to
obtain a new token. In production does not guarantee a permanent token: grants
can be revoked or expire. Keep downloaded credentials and output outside git.
`

function credential(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_./~-]{1,4096}$/.test(value)
}

/** Bootstrap a local operator's Desktop OAuth grant; only file paths enter the CLI. */
export async function bootstrapGoogleAdsOAuth({
  credentialsPath,
  outputPath,
  timeoutMs = 300000,
  onAuthorizationUrl = (url) => console.log(`Open this link in your local browser:\n${url}`),
}) {
  let client
  try {
    client = JSON.parse(await readFile(credentialsPath, 'utf8')).installed
  } catch {
    throw new Error('Cannot read the downloaded Desktop OAuth client JSON')
  }
  if (!credential(client?.client_id) || !credential(client?.client_secret)) {
    throw new Error('A downloaded Desktop OAuth client JSON with client_id and client_secret is required')
  }
  let output
  try {
    output = await open(outputPath, 'wx', 0o600)
  } catch {
    throw new Error('Cannot create output file; choose a new private path (existing files are never overwritten)')
  }
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(48).toString('base64url')
  let completed = false
  let timer
  let server
  try {
    const codePromise = new Promise((accept, reject) => {
      server = createServer((request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        const callback = new URL(request.url || '/', 'http://127.0.0.1')
        const returnedState = callback.searchParams.get('state') || ''
        if (
          request.method !== 'GET' ||
          callback.pathname !== '/oauth2callback' ||
          Buffer.byteLength(returnedState) !== Buffer.byteLength(state) ||
          !timingSafeEqual(Buffer.from(returnedState), Buffer.from(state))
        ) {
          response.writeHead(400).end('Invalid OAuth callback')
          return
        }
        if (callback.searchParams.has('error')) {
          response.writeHead(400).end('Authorization denied. Return to the terminal.')
          reject(new Error('Google authorization was denied'))
          return
        }
        const code = callback.searchParams.get('code')
        if (!code || code.length > 4096) {
          response.writeHead(400).end('Missing authorization code')
          return
        }
        response.end('Authorization received. Return to the terminal; you may close this tab.')
        accept(code)
      })
      server.on('error', () => reject(new Error('Cannot open the local OAuth callback listener')))
      timer = setTimeout(() => reject(new Error('Google authorization timed out')), timeoutMs)
    })
    // Attach the rejection handler immediately, including while opening the listener.
    const codeResult = codePromise.then(
      (code) => ({ code }),
      (error) => ({ error }),
    )
    await new Promise((accept, reject) => {
      server.once('error', () => reject(new Error('Cannot open the local OAuth callback listener')))
      server.listen(0, '127.0.0.1', accept)
    })
    const redirect = `http://127.0.0.1:${server.address().port}/oauth2callback`
    const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authorization.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirect,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString()
    await onAuthorizationUrl(authorization.toString())
    const result = await codeResult
    if (result.error) throw result.error
    clearTimeout(timer)
    let response
    let tokens
    try {
      response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.client_id,
          client_secret: client.client_secret,
          code: result.code,
          code_verifier: verifier,
          redirect_uri: redirect,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      })
      tokens = await response.json()
    } catch {
      throw new Error('Google token exchange failed or timed out')
    }
    if (!response.ok) throw new Error('Google token exchange failed; check client configuration and authorize again')
    if (!credential(tokens?.refresh_token))
      throw new Error('Google returned no usable refresh token; authorize again with consent')
    if (tokens.scope && !String(tokens.scope).split(' ').includes(SCOPE))
      throw new Error('Google did not grant the datamanager scope')
    const values = {
      GOOGLE_ADS_CLIENT_ID: client.client_id,
      GOOGLE_ADS_CLIENT_SECRET: client.client_secret,
      GOOGLE_ADS_REFRESH_TOKEN: tokens.refresh_token,
    }
    await output.writeFile(
      `${Object.entries(values)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join('\n')}\n`,
    )
    await output.sync()
    completed = true
  } finally {
    clearTimeout(timer)
    if (server) {
      server.closeAllConnections()
      await new Promise((accept) => server.close(accept))
    }
    await output.close()
    if (!completed) await unlink(outputPath).catch(() => {})
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    return
  }
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    if (!['--credentials', '--output'].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Use --help for the supported file-path arguments')
    }
    options[args[index]] = args[index + 1]
  }
  if (!options['--credentials'] || !options['--output'])
    throw new Error('Both --credentials and --output file paths are required; use --help')
  await bootstrapGoogleAdsOAuth({
    credentialsPath: resolve(options['--credentials']),
    outputPath: resolve(options['--output']),
  })
  console.log(
    'Google OAuth credentials saved privately. Configure the Google Ads customer and conversion action IDs before testing.',
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    // Never echo provider errors, paths, credentials, authorization codes or tokens.
    console.error(
      'Google OAuth setup failed. Check the Desktop client file, consent, and a new writable output path; use --help.',
    )
    process.exitCode = 1
  })
}
