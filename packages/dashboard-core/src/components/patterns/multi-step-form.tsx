// MultiStepForm — Multi-step form with stepper in a FocusModal.
// Each step is a React component. Navigation between steps is automatic.
//
// Usage:
//   <MultiStepForm
//     open={open}
//     onClose={close}
//     title="Create Product"
//     steps={[
//       { label: 'Details', content: <DetailsStep /> },
//       { label: 'Pricing', content: <PricingStep /> },
//       { label: 'Inventory', content: <InventoryStep /> },
//     ]}
//     onComplete={(data) => createProduct.mutate(data)}
//   />

import { cn } from '@manta/ui'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import React, { useState } from 'react'

export interface FormStep {
  label: string
  description?: string
  content: React.ReactNode
}

export interface MultiStepFormProps {
  open: boolean
  onClose: () => void
  title: string
  steps: FormStep[]
  /** Called when the last step submits. */
  onComplete?: () => void
  /** Text for the final button. Default: 'Create' */
  completeLabel?: string
  /** Max width of the content. Default: 'max-w-2xl' */
  maxWidth?: string
}

export function MultiStepForm({
  open,
  onClose,
  title,
  steps,
  onComplete,
  completeLabel = 'Create',
  maxWidth = 'max-w-2xl',
}: MultiStepFormProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const isFirst = currentStep === 0
  const isLast = currentStep === steps.length - 1

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-sm opacity-70 hover:opacity-100">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Stepper */}
      <div className="border-b px-6 py-4">
        <div className={cn('mx-auto flex items-center gap-2', maxWidth)}>
          {steps.map((step, i) => (
            <React.Fragment key={step.label}>
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium',
                    i < currentStep
                      ? 'bg-primary text-primary-foreground'
                      : i === currentStep
                        ? 'border-2 border-primary text-primary'
                        : 'border border-muted-foreground/30 text-muted-foreground',
                  )}
                >
                  {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span
                  className={cn('text-sm font-medium', i <= currentStep ? 'text-foreground' : 'text-muted-foreground')}
                >
                  {step.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={cn('h-px flex-1', i < currentStep ? 'bg-primary' : 'bg-border')} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className={cn('mx-auto w-full px-6 py-8', maxWidth)}>
          {steps[currentStep]?.description && (
            <p className="mb-6 text-sm text-muted-foreground">{steps[currentStep].description}</p>
          )}
          {steps[currentStep]?.content}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t px-6 py-4">
        <button
          type="button"
          onClick={() => setCurrentStep((s) => s - 1)}
          disabled={isFirst}
          className={cn(
            'flex items-center gap-1 rounded-md px-4 py-2 text-sm font-medium hover:bg-muted',
            isFirst && 'invisible',
          )}
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>

        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted">
            Cancel
          </button>
          {isLast ? (
            <button
              type="button"
              onClick={onComplete}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {completeLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCurrentStep((s) => s + 1)}
              className="flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
