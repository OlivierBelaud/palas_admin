import { cn, Label as LabelComponent, Tooltip } from '@manta/ui'
import { Info } from 'lucide-react'
import { Slot } from 'radix-ui'
import type React from 'react'
import { createContext, forwardRef, type ReactNode, useContext, useId } from 'react'
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
  useFormState,
} from 'react-hook-form'

const Provider = FormProvider

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName
}

const FormFieldContext = createContext<FormFieldContextValue>({} as FormFieldContextValue)

const Field = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

type FormItemContextValue = {
  id: string
}

const FormItemContext = createContext<FormItemContextValue>({} as FormItemContextValue)

const useFormField = () => {
  const fieldContext = useContext(FormFieldContext)
  const itemContext = useContext(FormItemContext)
  const { getFieldState } = useFormContext()

  const formState = useFormState({ name: fieldContext.name })
  const fieldState = getFieldState(fieldContext.name, formState)

  if (!fieldContext) {
    throw new Error('useFormField should be used within a FormField')
  }

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formLabelId: `${id}-form-item-label`,
    formDescriptionId: `${id}-form-item-description`,
    formErrorMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

const Item = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => {
  const id = useId()

  return (
    <FormItemContext.Provider value={{ id }}>
      <div ref={ref} className={cn('flex flex-col space-y-2', className)} {...props} />
    </FormItemContext.Provider>
  )
})
Item.displayName = 'Form.Item'

const Label = forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & {
    optional?: boolean
    tooltip?: ReactNode
    icon?: ReactNode
  }
>(({ className, optional = false, tooltip, icon, ...props }, ref) => {
  const { formLabelId, formItemId } = useFormField()

  return (
    <div className="flex items-center gap-x-1">
      <LabelComponent
        id={formLabelId}
        ref={ref}
        className={cn('text-sm font-medium', className)}
        htmlFor={formItemId}
        {...props}
      />
      {tooltip && (
        <Tooltip content={tooltip}>
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
        </Tooltip>
      )}
      {icon}
      {optional && <span className="text-sm text-muted-foreground">(optional)</span>}
    </div>
  )
})
Label.displayName = 'Form.Label'

const Control = forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ ...props }, ref) => {
  const { error, formItemId, formDescriptionId, formErrorMessageId, formLabelId } = useFormField()

  return (
    <Slot.Root
      ref={ref}
      id={formItemId}
      aria-describedby={!error ? `${formDescriptionId}` : `${formDescriptionId} ${formErrorMessageId}`}
      aria-invalid={!!error}
      aria-labelledby={formLabelId}
      {...props}
    />
  )
})
Control.displayName = 'Form.Control'

const Hint = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => {
    const { formDescriptionId } = useFormField()

    return <p ref={ref} id={formDescriptionId} className={cn('text-sm text-muted-foreground', className)} {...props} />
  },
)
Hint.displayName = 'Form.Hint'

const ErrorMessage = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, children, ...props }, ref) => {
    const { error, formErrorMessageId } = useFormField()
    const msg = error ? String(error?.message) : children

    if (!msg || msg === 'undefined') {
      return null
    }

    return (
      <p
        ref={ref}
        id={formErrorMessageId}
        className={cn('text-sm text-destructive', error && 'text-destructive', className)}
        {...props}
      >
        {msg}
      </p>
    )
  },
)
ErrorMessage.displayName = 'Form.ErrorMessage'

const Form = Object.assign(Provider, {
  Item,
  Label,
  Control,
  Hint,
  ErrorMessage,
  Field,
})

export { Form }
