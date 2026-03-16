import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import {
  Button,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  Select,
  toast,
  FocusModal,
} from "@medusajs/ui"

export function CreateProductPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [sku, setSku] = useState("")
  const [price, setPrice] = useState("")
  const [status, setStatus] = useState("draft")
  const [initialStock, setInitialStock] = useState("0")
  const [reorderPoint, setReorderPoint] = useState("10")

  const goBack = () => navigate("/products")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      const body: Record<string, unknown> = {
        title,
        description: description || undefined,
        price: Math.round(parseFloat(price) * 100),
        status,
      }

      if (sku) {
        body.sku = sku
        body.initialStock = parseInt(initialStock, 10) || 0
        body.reorderPoint = parseInt(reorderPoint, 10) || 10
      }

      const res = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.message || `Error ${res.status}`)
      }

      const data = await res.json()
      queryClient.invalidateQueries({ queryKey: ["products"] })

      if (data.events) {
        toast.success("Product created via workflow", {
          description: `${data.product.title} — Events: ${data.events.join(", ")}`,
        })
      } else {
        toast.success("Product created", { description: data.product.title })
      }

      if (data.product.id) {
        navigate(`/products/${data.product.id}`)
      } else {
        navigate("/products")
      }
    } catch (err: unknown) {
      toast.error("Failed to create product", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <FocusModal open onOpenChange={(open) => { if (!open) goBack() }}>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <Button variant="secondary" onClick={goBack}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-product-form"
              isLoading={submitting}
            >
              Create Product
            </Button>
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Create Product</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-1">
                {sku
                  ? "With SKU — runs the full create-product-pipeline workflow (validation, inventory, catalog, events)"
                  : "Without SKU — simple draft creation"}
              </Text>
            </div>

            <form
              id="create-product-form"
              onSubmit={handleSubmit}
              className="flex flex-col gap-y-6"
            >
              {/* General */}
              <div className="flex flex-col gap-y-4">
                <Heading level="h2" className="text-ui-fg-base">
                  General
                </Heading>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-y-1">
                    <Label htmlFor="title" size="small" weight="plus">
                      Title *
                    </Label>
                    <Input
                      id="title"
                      placeholder="e.g. Premium Leather Jacket"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-y-1">
                    <Label htmlFor="sku" size="small" weight="plus">
                      SKU
                    </Label>
                    <Input
                      id="sku"
                      placeholder="e.g. LEATHER-001"
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                    />
                    <Text size="xsmall" className="text-ui-fg-muted">
                      With SKU: runs full workflow. Without: simple creation.
                    </Text>
                  </div>
                </div>

                <div className="flex flex-col gap-y-1">
                  <Label htmlFor="description" size="small" weight="plus">
                    Description
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="Product description..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-y-1">
                    <Label htmlFor="price" size="small" weight="plus">
                      Price * (in dollars)
                    </Label>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 129.99"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-y-1">
                    <Label htmlFor="status" size="small" weight="plus">
                      Status
                    </Label>
                    <Select value={status} onValueChange={setStatus}>
                      <Select.Trigger>
                        <Select.Value placeholder="Select status" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="draft">Draft</Select.Item>
                        <Select.Item value="published">Published</Select.Item>
                        <Select.Item value="archived">Archived</Select.Item>
                      </Select.Content>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Inventory — only shown when SKU is set */}
              {sku && (
                <div className="flex flex-col gap-y-4">
                  <Heading level="h2" className="text-ui-fg-base">
                    Inventory
                  </Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    Inventory will be initialized via the sub-workflow.
                  </Text>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-y-1">
                      <Label htmlFor="initialStock" size="small" weight="plus">
                        Initial Stock
                      </Label>
                      <Input
                        id="initialStock"
                        type="number"
                        min="0"
                        value={initialStock}
                        onChange={(e) => setInitialStock(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-y-1">
                      <Label htmlFor="reorderPoint" size="small" weight="plus">
                        Reorder Point
                      </Label>
                      <Input
                        id="reorderPoint"
                        type="number"
                        min="0"
                        value={reorderPoint}
                        onChange={(e) => setReorderPoint(e.target.value)}
                      />
                      <Text size="xsmall" className="text-ui-fg-muted">
                        Low stock alert when stock ≤ this value.
                      </Text>
                    </div>
                  </div>
                </div>
              )}

              {/* Workflow info */}
              {sku && (
                <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
                  <Text size="small" weight="plus" className="text-ui-fg-base mb-2">
                    Workflow Pipeline
                  </Text>
                  <div className="flex flex-col gap-y-1">
                    <Text size="xsmall" className="text-ui-fg-muted">1. Validate input & SKU uniqueness</Text>
                    <Text size="xsmall" className="text-ui-fg-muted">2. Create product (draft)</Text>
                    <Text size="xsmall" className="text-ui-fg-muted">3. Upload images (if provided)</Text>
                    <Text size="xsmall" className="text-ui-fg-muted">4. Initialize inventory (sub-workflow)</Text>
                    <Text size="xsmall" className="text-ui-fg-muted">5. Generate catalog entry</Text>
                    <Text size="xsmall" className="text-ui-fg-muted">6. Emit events & activate product</Text>
                  </div>
                  <Text size="xsmall" className="text-ui-fg-muted mt-2">
                    Events: product.created → inventory.stocked → (low-stock alert if stock ≤ reorder point)
                  </Text>
                </div>
              )}
            </form>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
