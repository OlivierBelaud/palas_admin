import { useEffect, useState } from "react"
import { Container, Heading, Text, Table, StatusBadge } from "@medusajs/ui"

interface Heartbeat {
  id: number
  job: string
  message: string
  executedAt: string
}

export function CronsPage() {
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBeats = async () => {
    try {
      const res = await fetch("/api/admin/crons", { credentials: "include" })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      setHeartbeats(data.heartbeats || [])
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBeats()
    // Refresh every 30 seconds
    const interval = setInterval(fetchBeats, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="p-0 divide-y">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h1">Cron Heartbeats</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              The heartbeat cron runs every minute and writes a row to the DB.
              If rows appear, it proves Vercel Cron is working.
            </Text>
          </div>
          <StatusBadge color={heartbeats.length > 0 ? "green" : "orange"}>
            {heartbeats.length > 0 ? `${heartbeats.length} beats` : "Waiting..."}
          </StatusBadge>
        </div>

        {loading && (
          <div className="px-6 py-8 text-center text-ui-fg-muted">Loading...</div>
        )}

        {error && (
          <div className="px-6 py-4 text-ui-fg-error">Error: {error}</div>
        )}

        {!loading && heartbeats.length === 0 && !error && (
          <div className="px-6 py-8 text-center">
            <Text className="text-ui-fg-muted">
              No heartbeats yet. The cron runs every minute on Vercel.
              Wait 1-2 minutes and refresh.
            </Text>
          </div>
        )}

        {heartbeats.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>#</Table.HeaderCell>
                  <Table.HeaderCell>Job</Table.HeaderCell>
                  <Table.HeaderCell>Message</Table.HeaderCell>
                  <Table.HeaderCell>Executed At</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {heartbeats.map((beat) => (
                  <Table.Row key={beat.id}>
                    <Table.Cell>{beat.id}</Table.Cell>
                    <Table.Cell>
                      <StatusBadge color="green">{beat.job}</StatusBadge>
                    </Table.Cell>
                    <Table.Cell>{beat.message}</Table.Cell>
                    <Table.Cell>{new Date(beat.executedAt).toLocaleString()}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </Container>
    </div>
  )
}
