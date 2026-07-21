import { createServer } from 'node:http'

const port = Number(process.env.RUNTIME_CACHE_PORT)
if (!Number.isInteger(port) || port <= 0) throw new Error('RUNTIME_CACHE_PORT must be a positive integer')

const store = new Map<string, unknown>()

function execute(command: unknown[]): unknown {
  const [rawName, key, value] = command
  const name = String(rawName ?? '').toLowerCase()
  if (name === 'ping') return 'PONG'
  if (name === 'get') return store.get(String(key)) ?? null
  if (name === 'set') {
    store.set(String(key), value)
    return 'OK'
  }
  if (name === 'del') return store.delete(String(key)) ? 1 : 0
  if (name === 'flushdb') {
    store.clear()
    return 'OK'
  }
  throw new Error(`Unsupported runtime cache command: ${name}`)
}

const server = createServer((request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => {
    body += chunk
  })
  request.on('end', () => {
    try {
      const payload = body ? (JSON.parse(body) as unknown[]) : ['PING']
      const result = Array.isArray(payload[0])
        ? payload.map((command) => ({ result: execute(command as unknown[]) }))
        : { result: execute(payload) }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(result))
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: String(error) }))
    }
  })
})

server.listen(port, '127.0.0.1')
