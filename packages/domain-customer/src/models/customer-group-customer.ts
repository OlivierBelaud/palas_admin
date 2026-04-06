// CustomerGroupCustomer model — junction table for Customer <-> CustomerGroup (N:M)
// id, created_at, updated_at, deleted_at are implicit (ISO Medusa DML)

import { defineModel, field } from '@manta/core'

export const CustomerGroupCustomer = defineModel('CustomerGroupCustomer', {
  customer_id: field.text(),
  customer_group_id: field.text(),
  metadata: field.json().nullable(),
  created_by: field.text().nullable(),
})
