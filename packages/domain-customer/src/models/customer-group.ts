// CustomerGroup model — DML definition
// id, created_at, updated_at, deleted_at are implicit (ISO Medusa DML)

import { defineModel, field } from '@manta/core'

export const CustomerGroup = defineModel('CustomerGroup', {
  name: field.text(),
  metadata: field.json().nullable(),
  created_by: field.text().nullable(),
})
