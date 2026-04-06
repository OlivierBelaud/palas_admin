import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Input, Label, toast } from '@manta/ui'
import { Dialog as RadixDialog } from 'radix-ui'

export function CreateProductPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [sku, setSku] = useState('')
  const [price, setPrice] = useState('')
  const [status, setStatus] = useState('draft')
  const [initialStock, setInitialStock] = useState('0')
  const [reorderPoint, setReorderPoint] = useState('10')

  const goBack = () => navigate('/products')

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

      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.message || `Error ${res.status}`)
      }

      const data = await res.json()
      queryClient.invalidateQueries({ queryKey: ['products'] })

      if (data.events) {
        toast.success('Product created via workflow', {
          description: `${data.product.title} — Events: ${data.events.join(', ')}`,
        })
      } else {
        toast.success('Product created', { description: data.product.title })
      }

      if (data.product.id) {
        navigate(`/products/${data.product.id}`)
      } else {
        navigate('/products')
      }
    } catch (err: unknown) {
      toast.error('Failed to create product', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <RadixDialog.Root open onOpenChange={(open) => { if (!open) goBack() }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <RadixDialog.Content className="fixed inset-0 z-50 flex flex-col bg-background">
          <RadixDialog.Title className="sr-only">Create Product</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">Create a new product</RadixDialog.Description>

          {/* Header */}
          <div className="flex items-center justify-end gap-x-2 border-b px-6 py-3">
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

          {/* Body */}
          <div className="flex flex-1 flex-col items-center overflow-y-auto py-16">
            <div className="flex w-full max-w-[720px] flex-col gap-y-8">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Create Product</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sku
                    ? 'With SKU — runs the full create-product-pipeline workflow (validation, inventory, catalog, events)'
                    : 'Without SKU — simple draft creation'}
                </p>
              </div>

              <form
                id="create-product-form"
                onSubmit={handleSubmit}
                className="flex flex-col gap-y-6"
              >
                {/* General */}
                <div className="flex flex-col gap-y-4">
                  <h2 className="text-lg font-semibold text-foreground">
                    General
                  </h2>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-y-1">
                      <Label htmlFor="title">
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
                      <Label htmlFor="sku">
                        SKU
                      </Label>
                      <Input
                        id="sku"
                        placeholder="e.g. LEATHER-001"
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                      />
                      <span className="text-xs text-muted-foreground">
                        With SKU: runs full workflow. Without: simple creation.
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-y-1">
                    <Label htmlFor="description">
                      Description
                    </Label>
                    <textarea
                      id="description"
                      placeholder="Product description..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-y-1">
                      <Label htmlFor="price">
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
                      <Label htmlFor="status">
                        Status
                      </Label>
                      <select
                        id="status"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                        <option value="archived">Archived</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Inventory — only shown when SKU is set */}
                {sku && (
                  <div className="flex flex-col gap-y-4">
                    <h2 className="text-lg font-semibold text-foreground">
                      Inventory
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Inventory will be initialized via the sub-workflow.
                    </p>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="flex flex-col gap-y-1">
                        <Label htmlFor="initialStock">
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
                        <Label htmlFor="reorderPoint">
                          Reorder Point
                        </Label>
                        <Input
                          id="reorderPoint"
                          type="number"
                          min="0"
                          value={reorderPoint}
                          onChange={(e) => setReorderPoint(e.target.value)}
                        />
                        <span className="text-xs text-muted-foreground">
                          Low stock alert when stock &le; this value.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Workflow info */}
                {sku && (
                  <div className="rounded-lg border bg-muted p-4">
                    <span className="mb-2 text-sm font-medium text-foreground">
                      Workflow Pipeline
                    </span>
                    <div className="flex flex-col gap-y-1">
                      <span className="text-xs text-muted-foreground">1. Validate input & SKU uniqueness</span>
                      <span className="text-xs text-muted-foreground">2. Create product (draft)</span>
                      <span className="text-xs text-muted-foreground">3. Upload images (if provided)</span>
                      <span className="text-xs text-muted-foreground">4. Initialize inventory (sub-workflow)</span>
                      <span className="text-xs text-muted-foreground">5. Generate catalog entry</span>
                      <span className="text-xs text-muted-foreground">6. Emit events & activate product</span>
                    </div>
                    <span className="mt-2 text-xs text-muted-foreground">
                      Events: product.created &rarr; inventory.stocked &rarr; (low-stock alert if stock &le; reorder point)
                    </span>
                  </div>
                )}
              </form>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
