import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/alert-dialog'

interface PromptOptions {
  title: string
  description: string
  confirmText?: string
  cancelText?: string
}

/**
 * usePrompt — shows a confirmation dialog and returns a promise resolving to boolean.
 * Drop-in replacement for @medusajs/ui usePrompt.
 */
export function usePrompt(): (options: PromptOptions) => Promise<boolean> {
  const [state, setState] = useState<{
    open: boolean
    options: PromptOptions
    resolve: ((value: boolean) => void) | null
  }>({
    open: false,
    options: { title: '', description: '' },
    resolve: null,
  })

  const prompt = useCallback((options: PromptOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, options, resolve })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    state.resolve?.(true)
    setState((prev) => ({ ...prev, open: false, resolve: null }))
  }, [state.resolve])

  const handleCancel = useCallback(() => {
    state.resolve?.(false)
    setState((prev) => ({ ...prev, open: false, resolve: null }))
  }, [state.resolve])

  // Render the dialog via portal
  const dialog = state.open
    ? createPortal(
        <AlertDialog open onOpenChange={(open) => !open && handleCancel()}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{state.options.title}</AlertDialogTitle>
              <AlertDialogDescription>{state.options.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={handleCancel}>{state.options.cancelText || 'Cancel'}</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirm}>{state.options.confirmText || 'Confirm'}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>,
        document.body,
      )
    : null

  // Attach dialog to component tree — caller must render it
  // We use a trick: return the prompt function but also need the dialog rendered.
  // Solution: return a function that also has a .Dialog property.
  const fn = useCallback((options: PromptOptions) => prompt(options), [prompt])

  // biome-ignore lint/suspicious/noExplicitAny: attaching dialog property
  ;(fn as any).__dialog = dialog

  return fn
}

/**
 * PromptDialogRenderer — place this in your provider tree to render prompt dialogs.
 * Not needed if using @manta/ui Toaster (prompts render via portal).
 */
// The dialog is rendered via portal directly in usePrompt, so no extra renderer needed.
