
// Customer -> Address (1:N cross-module link)
// Pivot columns: type ('shipping' | 'billing'), is_default (for shipping)
export default defineLink('customer', many('address'), {
  type: field.text(),
  is_default: field.boolean().default(false),
})
