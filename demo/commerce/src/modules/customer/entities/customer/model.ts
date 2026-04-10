export default defineUserModel('customer', {
  company_name: field.text().nullable(),
  first_name: field.text().nullable(),
  last_name: field.text().nullable(),
  phone: field.text().nullable(),
  has_account: field.boolean().default(false),
  created_by: field.text().nullable(),
})
