import { useEffect, useState } from 'react'

export const useDocumentDirection = (): 'ltr' | 'rtl' | undefined => {
  const [direction, setDirection] = useState<'ltr' | 'rtl' | undefined>(() => {
    if (typeof document !== 'undefined') {
      return (document.documentElement.getAttribute('dir') as 'ltr' | 'rtl') || undefined
    }
    return undefined
  })

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'dir' &&
          mutation.target === document.documentElement
        ) {
          const newDirection = document.documentElement.getAttribute('dir') as 'ltr' | 'rtl'
          setDirection(newDirection || undefined)
        }
      })
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dir'],
    })

    return () => {
      observer.disconnect()
    }
  }, [])

  return direction
}
