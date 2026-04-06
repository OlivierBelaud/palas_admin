// CustomerAddress model — DML definition
// id, created_at, updated_at, deleted_at are implicit (ISO Medusa DML)

import { defineModel, field } from '@manta/core'

export const CustomerAddress = defineModel('CustomerAddress', {
  customer_id: field.text(),
  address_name: field.text().nullable(),
  is_default_shipping: field.boolean(),
  is_default_billing: field.boolean(),
  company: field.text().nullable(),
  first_name: field.text().nullable(),
  last_name: field.text().nullable(),
  address_1: field.text().nullable(),
  address_2: field.text().nullable(),
  city: field.text().nullable(),
  country_code: field.text().nullable(),
  province: field.text().nullable(),
  postal_code: field.text().nullable(),
  phone: field.text().nullable(),
  metadata: field.json().nullable(),
})
