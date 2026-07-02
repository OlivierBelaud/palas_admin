import { useParams } from 'react-router-dom'

import { ShopifyDiscountForm } from '../../discount-form'

export default function EditDiscountPage() {
  const params = useParams()
  const discountId = decodeParam(params.id)
  return <ShopifyDiscountForm discountId={discountId} />
}

function decodeParam(value: string | undefined): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
