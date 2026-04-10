export default defineModel('CustomerGroup', {
  name: field.text().unique(),
  metadata: field.json().nullable(),
  created_by: field.text().nullable(),
})
