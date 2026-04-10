export default defineModel('Address', {
  address_name: field.text().nullable(),
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
