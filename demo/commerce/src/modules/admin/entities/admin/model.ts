
export default defineUserModel('admin', {
  role: field.enum(['super_admin', 'editor', 'viewer']).default('super_admin'),
})
