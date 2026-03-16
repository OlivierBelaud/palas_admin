import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Button,
  Container,
  Heading,
  Text,
  StatusBadge,
  toast,
} from "@medusajs/ui"

interface TestResult {
  name: string
  status: "pass" | "fail" | "skip"
  durationMs: number
  logs: string[]
  error?: string
}

interface TestReport {
  summary: { total: number; passed: number; failed: number; durationMs: number; allPassed: boolean }
  tests: TestResult[]
}

export function TestPanel() {
  const queryClient = useQueryClient()
  const [running, setRunning] = useState<string | null>(null)
  const [report, setReport] = useState<TestReport | null>(null)
  const [lastAction, setLastAction] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<any>(null)

  const runAction = async (name: string, body: Record<string, unknown>) => {
    setRunning(name)
    setLastAction(name)
    setLastResult(null)
    try {
      const res = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(`${name} failed`, { description: data.message || `Error ${res.status}` })
        setLastResult({ error: data.message })
      } else {
        toast.success(`${name} completed`, {
          description: data.events ? `Events: ${data.events.join(", ")}` : `Product: ${data.product?.title}`,
        })
        setLastResult(data)
        queryClient.invalidateQueries({ queryKey: ["products"] })
      }
    } catch (err) {
      toast.error(`${name} error`, { description: (err as Error).message })
      setLastResult({ error: (err as Error).message })
    } finally {
      setRunning(null)
    }
  }

  const runTestSuite = async () => {
    setRunning("Full Test Suite")
    setReport(null)
    try {
      const res = await fetch("/api/admin/test", {
        method: "POST",
        credentials: "include",
      })
      const data: TestReport = await res.json()
      setReport(data)
      if (data.summary.allPassed) {
        toast.success(`All ${data.summary.total} tests passed`, {
          description: `${data.summary.durationMs}ms`,
        })
      } else {
        toast.error(`${data.summary.failed} test(s) failed`, {
          description: `${data.summary.passed}/${data.summary.total} passed`,
        })
      }
      queryClient.invalidateQueries({ queryKey: ["products"] })
    } catch (err) {
      toast.error("Test suite error", { description: (err as Error).message })
    } finally {
      setRunning(null)
    }
  }

  return (
    <Container className="p-0 divide-y">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Workflow Tests</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Battle-test the framework: workflows, events, compensation, locking
          </Text>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 px-6 py-4">
        <Button
          variant="secondary"
          size="small"
          isLoading={running === "Create Normal"}
          onClick={() => runAction("Create Normal", {
            title: `Test Product ${Date.now()}`,
            description: "Normal workflow — 6 steps, events, subscribers",
            sku: `NORMAL-${Date.now()}`,
            price: 9999,
            initialStock: 50,
            reorderPoint: 10,
          })}
        >
          Create Normal
        </Button>

        <Button
          variant="secondary"
          size="small"
          isLoading={running === "Create Low Stock"}
          onClick={() => runAction("Create Low Stock", {
            title: `Low Stock Item ${Date.now()}`,
            description: "Low stock → triggers event chain: stocked → low-stock → notification",
            sku: `LOWSTOCK-${Date.now()}`,
            price: 29999,
            initialStock: 3,
            reorderPoint: 10,
          })}
        >
          Create + Low Stock Alert
        </Button>

        <Button
          variant="secondary"
          size="small"
          isLoading={running === "Create Simple"}
          onClick={() => runAction("Create Simple", {
            title: `Simple Draft ${Date.now()}`,
            description: "No SKU — bypasses workflow, simple creation",
            price: 1999,
            status: "draft",
          })}
        >
          Create Simple (no workflow)
        </Button>

        <Button
          variant="secondary"
          size="small"
          isLoading={running === "Duplicate SKU"}
          onClick={() => runAction("Duplicate SKU", {
            title: "Should Fail",
            sku: "DUPLICATE-TEST",
            price: 100,
            initialStock: 1,
            reorderPoint: 1,
          })}
        >
          Test Duplicate SKU
        </Button>

        <Button
          variant="primary"
          size="small"
          isLoading={running === "Full Test Suite"}
          onClick={runTestSuite}
        >
          Run Full Test Suite (7 tests)
        </Button>
      </div>

      {/* Last action result */}
      {lastResult && !report && (
        <div className="px-6 py-4">
          <Text size="small" weight="plus" className="mb-2">
            Last: {lastAction}
          </Text>
          <pre className="bg-ui-bg-subtle rounded-lg p-3 text-xs overflow-x-auto max-h-[200px] overflow-y-auto">
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        </div>
      )}

      {/* Test suite report */}
      {report && (
        <div className="px-6 py-4">
          <div className="flex items-center gap-3 mb-4">
            <Text size="small" weight="plus">
              Test Report: {report.summary.passed}/{report.summary.total} passed
            </Text>
            <StatusBadge color={report.summary.allPassed ? "green" : "red"}>
              {report.summary.allPassed ? "ALL PASS" : `${report.summary.failed} FAILED`}
            </StatusBadge>
            <Text size="xsmall" className="text-ui-fg-muted">
              {report.summary.durationMs}ms
            </Text>
          </div>

          <div className="flex flex-col gap-3">
            {report.tests.map((test, i) => (
              <div key={i} className="rounded-lg border border-ui-border-base p-3">
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge color={test.status === "pass" ? "green" : "red"}>
                    {test.status.toUpperCase()}
                  </StatusBadge>
                  <Text size="small" weight="plus">{test.name}</Text>
                  <Text size="xsmall" className="text-ui-fg-muted">{test.durationMs}ms</Text>
                </div>
                {test.logs.length > 0 && (
                  <pre className="bg-ui-bg-subtle rounded p-2 text-xs mt-2 overflow-x-auto max-h-[150px] overflow-y-auto">
                    {test.logs.join("\n")}
                  </pre>
                )}
                {test.error && (
                  <Text size="xsmall" className="text-ui-fg-error mt-1">
                    Error: {test.error}
                  </Text>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Container>
  )
}
