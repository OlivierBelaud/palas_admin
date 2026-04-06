// @manta/domain-customer — Customer domain module
//
// Re-encoded from @medusajs/customer for the Manta framework.
// Standalone module with its own models, service, and tests.
//
// Models: Customer, CustomerAddress, CustomerGroup, CustomerGroupCustomer
// Service: CustomerModuleService (multi-entity, separate repos per entity)

export { Customer } from './models/customer'
export { CustomerAddress } from './models/customer-address'
export { CustomerGroup } from './models/customer-group'
export { CustomerGroupCustomer } from './models/customer-group-customer'
export type { CustomerModuleDeps, GroupCustomerPair } from './service'
export { CustomerModuleService } from './service'
