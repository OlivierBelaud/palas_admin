import { Button, Card, toast } from '@manta/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

// CQRS: all mutations go through POST /api/admin/command/:name
async function runCommand(name: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`/api/admin/command/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw Object.assign(new Error(data.message || `Error ${res.status}`), { data })
  return data
}

export function TestPanel() {
  const queryClient = useQueryClient()
  const [running, setRunning] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<string | null>(null)
  // biome-ignore lint/suspicious/noExplicitAny: dynamic test results
  const [lastResult, setLastResult] = useState<any>(null)
  const [longRunTx, setLongRunTx] = useState<string | null>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['catalog'] })

  const runAction = async (label: string, commandName: string, body: Record<string, unknown>) => {
    setRunning(label)
    setLastAction(label)
    setLastResult(null)
    try {
      const result = await runCommand(commandName, body)
      setLastResult(result)
      toast.success(`${label} completed`, {
        description: result.data?.product
          ? `Product: ${result.data.product.title} (${result.data.product.status})`
          : JSON.stringify(result.data).slice(0, 80),
      })
      invalidate()
    } catch (err) {
      // biome-ignore lint/suspicious/noExplicitAny: error with data
      const data = (err as any).data ?? { error: (err as Error).message }
      toast.error(`${label} failed`, { description: (err as Error).message })
      setLastResult(data)
    } finally {
      setRunning(null)
    }
  }

  return (
    <Card className="divide-y p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold">CQRS Command Tests</h2>
          <span className="text-sm text-muted-foreground">
            All mutations go through POST /api/admin/command/:name
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 px-6 py-4">
        <Button
          variant="secondary"
          size="small"
          isLoading={running === 'Create Normal'}
          onClick={() =>
            runAction('Create Normal', 'create-product', {
              title: `Test Product ${Date.now()}`,
              sku: `NORMAL-${Date.now()}`,
              price: 9999,
              initialStock: 50,
              reorderPoint: 10,
            })
          }
        >
          Create Normal
        </Button>

        <Button
          variant="secondary"
          size="small"
          isLoading={running === 'Create Low Stock'}
          onClick={() =>
            runAction('Create Low Stock', 'create-product', {
              title: `Low Stock Item ${Date.now()}`,
              sku: `LOWSTOCK-${Date.now()}`,
              price: 29999,
              initialStock: 3,
              reorderPoint: 10,
            })
          }
        >
          Create + Low Stock Alert
        </Button>

        <Button
          variant="secondary"
          size="small"
          isLoading={running === 'Duplicate SKU'}
          onClick={() =>
            runAction('Duplicate SKU', 'create-product', {
              title: 'Should Fail',
              sku: 'DUPLICATE-TEST',
              price: 100,
              initialStock: 1,
              reorderPoint: 1,
            })
          }
        >
          Test Duplicate SKU
        </Button>

        <Button
          variant="secondary"
          size="small"
          isLoading={running === 'Concurrence Test'}
          onClick={async () => {
            setRunning('Concurrence Test')
            setLastAction('Concurrence Test')
            setLastResult(null)
            try {
              const sku = `CONCURRENT-${Date.now()}`
              const body = { title: 'Concurrent', sku, price: 100, initialStock: 1, reorderPoint: 1 }
              const [r1, r2] = await Promise.allSettled([
                runCommand('create-product', { ...body, title: 'Concurrent A' }),
                runCommand('create-product', { ...body, title: 'Concurrent B' }),
              ])
              // biome-ignore lint/suspicious/noExplicitAny: dynamic results
              const successes = [r1, r2].filter((r) => r.status === 'fulfilled' && (r as any).value?.data?.product)
              const failures = [r1, r2].filter((r) => r.status === 'rejected')
              setLastResult({
                sku,
                // biome-ignore lint/suspicious/noExplicitAny: dynamic results
                request1: r1.status === 'fulfilled' ? r1.value : { error: (r1 as any).reason?.message },
                // biome-ignore lint/suspicious/noExplicitAny: dynamic results
                request2: r2.status === 'fulfilled' ? r2.value : { error: (r2 as any).reason?.message },
                successes: successes.length,
                failures: failures.length,
                verdict:
                  successes.length === 1 && failures.length === 1
                    ? 'PASS — only 1 of 2 concurrent requests succeeded'
                    : `${successes.length} succeeded, ${failures.length} failed`,
              })
              toast.success(`Concurrence: ${successes.length} success, ${failures.length} rejected`)
              invalidate()
            } catch (err) {
              setLastResult({ error: (err as Error).message })
            } finally {
              setRunning(null)
            }
          }}
        >
          Test Concurrence (2 simultaneous)
        </Button>

        <Button
          variant="secondary"
          size="small"
          isLoading={running === 'Long-Running Workflow'}
          onClick={async () => {
            setRunning('Long-Running Workflow')
            setLastAction('Long-Running Workflow')
            setLastResult(null)
            setLongRunTx(null)
            try {
              const result = await runCommand('launch-long-running', {
                title: `Long-Run Import ${Date.now()}`,
                sku: `LONGRUN-${Date.now()}`,
                price: 4999,
              })
              if (result.data?.status === 'suspended') {
                setLongRunTx(result.data.transactionId)
                setLastResult(result)
                invalidate()
                toast.success(`Draft created: ${result.data.product?.title}`, {
                  description: 'Workflow suspended — click Confirm or Reject',
                })
              } else {
                setLastResult(result)
                toast.success('Workflow completed')
              }
            } catch (err) {
              setLastResult({ error: (err as Error).message })
              toast.error('Error', { description: (err as Error).message })
            } finally {
              setRunning(null)
            }
          }}
        >
          Test Long-Running Workflow
        </Button>

        {longRunTx && (
          <>
            <Button
              variant="default"
              size="small"
              isLoading={running === 'Confirm Long-Run'}
              onClick={async () => {
                setRunning('Confirm Long-Run')
                try {
                  const result = await runCommand('confirm-workflow', {
                    transactionId: longRunTx,
                    action: 'confirm',
                  })
                  setLastResult(result)
                  setLongRunTx(null)
                  toast.success('Confirmed!', { description: `Status: ${result.data?.status}` })
                  invalidate()
                } catch (err) {
                  setLastResult({ error: (err as Error).message })
                  toast.error('Confirm error', { description: (err as Error).message })
                } finally {
                  setRunning(null)
                }
              }}
            >
              Confirm
            </Button>
            <Button
              variant="destructive"
              size="small"
              isLoading={running === 'Reject Long-Run'}
              onClick={async () => {
                setRunning('Reject Long-Run')
                try {
                  const result = await runCommand('confirm-workflow', {
                    transactionId: longRunTx,
                    action: 'reject',
                    reason: 'User rejected',
                  })
                  setLastResult(result)
                  setLongRunTx(null)
                  toast.error('Rejected', { description: 'Workflow rolled back' })
                } catch (err) {
                  setLastResult({ error: (err as Error).message })
                  toast.error('Reject error', { description: (err as Error).message })
                } finally {
                  setRunning(null)
                }
              }}
            >
              Reject
            </Button>
          </>
        )}

        <Button
          variant="destructive"
          size="small"
          isLoading={running === 'Reset DB'}
          onClick={async () => {
            setRunning('Reset DB')
            setLastAction('Reset DB')
            setLastResult(null)
            try {
              const result = await runCommand('reset-data')
              setLastResult(result)
              toast.success('Database reset', { description: result.data?.message })
              invalidate()
            } catch (err) {
              toast.error('Reset error', { description: (err as Error).message })
              setLastResult({ error: (err as Error).message })
            } finally {
              setRunning(null)
            }
          }}
        >
          Reset Database
        </Button>
      </div>

      {/* Last action result */}
      {lastResult && (
        <div className="px-6 py-4">
          <span className="mb-2 text-sm font-medium">
            Last: {lastAction}
          </span>
          <pre className="max-h-[200px] overflow-x-auto overflow-y-auto rounded-lg bg-muted p-3 text-xs">
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        </div>
      )}
    </Card>
  )
}
