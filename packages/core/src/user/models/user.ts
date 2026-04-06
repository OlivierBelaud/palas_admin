import { field, model } from '../../dml/model'

export const User = model.define('User', {
  first_name: field.text().nullable(),
  last_name: field.text().nullable(),
  email: field.text().unique(),
  avatar_url: field.text().nullable(),
  metadata: field.json().nullable(),
})

export const Invite = model.define('Invite', {
  email: field.text().index(),
  accepted: field.boolean().default(false),
  token: field.text(),
  expires_at: field.dateTime(),
  metadata: field.json().nullable(),
})
