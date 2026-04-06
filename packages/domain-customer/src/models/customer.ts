// Customer model — DML definition
// id, created_at, updated_at, deleted_at are implicit (ISO Medusa DML)

import { defineModel, field } from '@manta/core'

export const Customer = defineModel('Customer', {
  company_name: field.text().nullable(),
  first_name: field.text().nullable(),
  last_name: field.text().nullable(),
  email: field.text().nullable(),
  phone: field.text().nullable(),
  has_account: field.boolean(),
  metadata: field.json().nullable(),
  created_by: field.text().nullable(),
})
