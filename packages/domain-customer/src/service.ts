// CustomerModuleService — Manta re-encoding of @medusajs/customer
//
// Multi-entity module: manages 4 entities with separate repositories.
// CRUD methods follow Manta/Medusa conventions (context last, optional).
//
// Auto-generated-style CRUD for each entity:
//   Customer:              retrieveCustomer, listCustomers, createCustomers, updateCustomers,
//                          deleteCustomers, softDeleteCustomers, restoreCustomers
//   CustomerAddress:       retrieveCustomerAddress, listCustomerAddresses, createCustomerAddresses,
//                          updateCustomerAddresses, deleteCustomerAddresses, ...
//   CustomerGroup:         retrieveCustomerGroup, listCustomerGroups, createCustomerGroups,
//                          updateCustomerGroups, deleteCustomerGroups, ...
//   CustomerGroupCustomer: (managed internally)
//
// Custom mutations:
//   addCustomerToGroup(pair | pairs)
//   removeCustomerFromGroup(pair | pairs)

import type { IRepository } from '@manta/core'
import { MantaError } from '@manta/core'

export interface GroupCustomerPair {
  customer_id: string
  customer_group_id: string
  created_by?: string
  metadata?: Record<string, unknown> | null
}

export interface CustomerModuleDeps {
  customerRepository: IRepository
  customerAddressRepository: IRepository
  customerGroupRepository: IRepository
  customerGroupCustomerRepository: IRepository
}

type R = Record<string, unknown>
type UpdateData = R & { id: string }

export class CustomerModuleService {
  private customerRepo: IRepository
  private addressRepo: IRepository
  private groupRepo: IRepository
  private groupCustomerRepo: IRepository

  constructor(deps: CustomerModuleDeps) {
    this.customerRepo = deps.customerRepository
    this.addressRepo = deps.customerAddressRepository
    this.groupRepo = deps.customerGroupRepository
    this.groupCustomerRepo = deps.customerGroupCustomerRepository
  }

  // ═══════════════════════════════════════════════════════════════
  // Customer CRUD
  // ═══════════════════════════════════════════════════════════════

  async retrieveCustomer(id: string): Promise<R> {
    const results = await this.customerRepo.find({ where: { id } })
    if (results.length === 0) throw new MantaError('NOT_FOUND', `Customer with id "${id}" not found`)
    return results[0] as R
  }

  async listCustomers(filters?: R, config?: { order?: R; skip?: number; take?: number }): Promise<R[]> {
    return this.customerRepo.find({
      where: filters,
      order: config?.order as Record<string, 'ASC' | 'DESC'>,
      offset: config?.skip,
      limit: config?.take,
    }) as Promise<R[]>
  }

  async listAndCountCustomers(
    filters?: R,
    config?: { order?: R; skip?: number; take?: number },
  ): Promise<[R[], number]> {
    return this.customerRepo.findAndCount({
      where: filters,
      order: config?.order as Record<string, 'ASC' | 'DESC'>,
      offset: config?.skip,
      limit: config?.take,
    }) as Promise<[R[], number]>
  }

  async createCustomers(data: R | R[]): Promise<R | R[]> {
    const items = Array.isArray(data) ? data : [data]

    // Handle nested address creation
    const results: R[] = []
    for (const item of items) {
      const { addresses, ...customerData } = item
      const created = (await this.customerRepo.create(customerData)) as R
      const customer = Array.isArray(created) ? created[0] : created

      if (addresses && Array.isArray(addresses)) {
        const addressRecords = (addresses as R[]).map((addr) => ({
          ...addr,
          customer_id: customer.id,
        }))
        await this.addressRepo.create(addressRecords)
      }

      results.push(customer)
    }

    return Array.isArray(data) ? results : results[0]
  }

  async updateCustomers(data: UpdateData | UpdateData[]): Promise<R | R[]> {
    const items = Array.isArray(data) ? data : [data]
    const updated: R[] = []
    for (const item of items) {
      const result = (await this.customerRepo.update(item)) as R
      updated.push(result)
    }
    return Array.isArray(data) ? updated : updated[0]
  }

  async deleteCustomers(ids: string | string[]): Promise<void> {
    const idArray = Array.isArray(ids) ? ids : [ids]

    // Cascade: delete addresses and group memberships
    for (const id of idArray) {
      const addresses = await this.addressRepo.find({ where: { customer_id: id } })
      if (addresses.length > 0) {
        await this.addressRepo.delete(addresses.map((a) => (a as R).id as string))
      }
      const memberships = await this.groupCustomerRepo.find({ where: { customer_id: id } })
      if (memberships.length > 0) {
        await this.groupCustomerRepo.delete(memberships.map((m) => (m as R).id as string))
      }
    }

    await this.customerRepo.delete(idArray)
  }

  async softDeleteCustomers(ids: string | string[]): Promise<R> {
    const idArray = Array.isArray(ids) ? ids : [ids]
    return this.customerRepo.softDelete(idArray)
  }

  async restoreCustomers(ids: string | string[]): Promise<void> {
    const idArray = Array.isArray(ids) ? ids : [ids]
    return this.customerRepo.restore(idArray)
  }

  // ═══════════════════════════════════════════════════════════════
  // CustomerAddress CRUD
  // ═══════════════════════════════════════════════════════════════

  async retrieveCustomerAddress(id: string): Promise<R> {
    const results = await this.addressRepo.find({ where: { id } })
    if (results.length === 0) throw new MantaError('NOT_FOUND', `CustomerAddress with id "${id}" not found`)
    return results[0] as R
  }

  async listCustomerAddresses(filters?: R, config?: { order?: R; skip?: number; take?: number }): Promise<R[]> {
    return this.addressRepo.find({
      where: filters,
      order: config?.order as Record<string, 'ASC' | 'DESC'>,
      offset: config?.skip,
      limit: config?.take,
    }) as Promise<R[]>
  }

  async createCustomerAddresses(data: R | R[]): Promise<R | R[]> {
    return this.addressRepo.create(Array.isArray(data) ? data : data) as Promise<R | R[]>
  }

  async updateCustomerAddresses(data: UpdateData | UpdateData[]): Promise<R | R[]> {
    const items = Array.isArray(data) ? data : [data]
    const updated: R[] = []
    for (const item of items) {
      const result = (await this.addressRepo.update(item)) as R
      updated.push(result)
    }
    return Array.isArray(data) ? updated : updated[0]
  }

  async deleteCustomerAddresses(ids: string | string[]): Promise<void> {
    const idArray = Array.isArray(ids) ? ids : [ids]
    await this.addressRepo.delete(idArray)
  }

  // ═══════════════════════════════════════════════════════════════
  // CustomerGroup CRUD
  // ═══════════════════════════════════════════════════════════════

  async retrieveCustomerGroup(id: string): Promise<R> {
    const results = await this.groupRepo.find({ where: { id } })
    if (results.length === 0) throw new MantaError('NOT_FOUND', `CustomerGroup with id "${id}" not found`)
    return results[0] as R
  }

  async listCustomerGroups(filters?: R, config?: { order?: R; skip?: number; take?: number }): Promise<R[]> {
    return this.groupRepo.find({
      where: filters,
      order: config?.order as Record<string, 'ASC' | 'DESC'>,
      offset: config?.skip,
      limit: config?.take,
    }) as Promise<R[]>
  }

  async createCustomerGroups(data: R | R[]): Promise<R | R[]> {
    return this.groupRepo.create(Array.isArray(data) ? data : data) as Promise<R | R[]>
  }

  async updateCustomerGroups(data: UpdateData | UpdateData[]): Promise<R | R[]> {
    const items = Array.isArray(data) ? data : [data]
    const updated: R[] = []
    for (const item of items) {
      const result = (await this.groupRepo.update(item)) as R
      updated.push(result)
    }
    return Array.isArray(data) ? updated : updated[0]
  }

  async deleteCustomerGroups(ids: string | string[]): Promise<void> {
    const idArray = Array.isArray(ids) ? ids : [ids]

    // Cascade: delete group memberships
    for (const id of idArray) {
      const memberships = await this.groupCustomerRepo.find({ where: { customer_group_id: id } })
      if (memberships.length > 0) {
        await this.groupCustomerRepo.delete(memberships.map((m) => (m as R).id as string))
      }
    }

    await this.groupRepo.delete(idArray)
  }

  async softDeleteCustomerGroups(ids: string | string[]): Promise<R> {
    const idArray = Array.isArray(ids) ? ids : [ids]
    return this.groupRepo.softDelete(idArray)
  }

  async restoreCustomerGroups(ids: string | string[]): Promise<void> {
    const idArray = Array.isArray(ids) ? ids : [ids]
    return this.groupRepo.restore(idArray)
  }

  // ═══════════════════════════════════════════════════════════════
  // Custom mutations — addCustomerToGroup / removeCustomerFromGroup
  // ═══════════════════════════════════════════════════════════════

  async addCustomerToGroup(
    pairOrPairs: GroupCustomerPair | GroupCustomerPair[],
  ): Promise<{ id: string } | { id: string }[]> {
    const pairs = Array.isArray(pairOrPairs) ? pairOrPairs : [pairOrPairs]
    const results: { id: string }[] = []

    for (const pair of pairs) {
      // Check for existing to avoid duplicates
      const existing = await this.groupCustomerRepo.find({
        where: {
          customer_id: pair.customer_id,
          customer_group_id: pair.customer_group_id,
        },
      })

      if (existing.length > 0) {
        results.push({ id: (existing[0] as R).id as string })
        continue
      }

      const created = (await this.groupCustomerRepo.create({
        customer_id: pair.customer_id,
        customer_group_id: pair.customer_group_id,
        created_by: pair.created_by,
        metadata: pair.metadata,
      })) as R
      const record = Array.isArray(created) ? created[0] : created
      results.push({ id: record.id as string })
    }

    return Array.isArray(pairOrPairs) ? results : results[0]
  }

  async removeCustomerFromGroup(pairOrPairs: GroupCustomerPair | GroupCustomerPair[]): Promise<void> {
    const pairs = Array.isArray(pairOrPairs) ? pairOrPairs : [pairOrPairs]

    for (const pair of pairs) {
      const existing = await this.groupCustomerRepo.find({
        where: {
          customer_id: pair.customer_id,
          customer_group_id: pair.customer_group_id,
        },
      })

      if (existing.length > 0) {
        await this.groupCustomerRepo.delete(existing.map((r) => (r as R).id as string))
      }
    }
  }
}
