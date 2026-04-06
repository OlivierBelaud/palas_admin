import { field, model } from '../../dml/model'

export const AuthIdentity = model.define('AuthIdentity', {
  app_metadata: field.json().nullable(),
})

export const ProviderIdentity = model.define('ProviderIdentity', {
  entity_id: field.text(),
  provider: field.text().index(),
  auth_identity_id: field.text().index(),
  user_metadata: field.json().nullable(),
  provider_metadata: field.json().nullable(),
})
