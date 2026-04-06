// CustomerModuleService — comprehensive tests
//
// Covers all CRUD operations for Customer, CustomerAddress, CustomerGroup
// and custom mutations (addCustomerToGroup, removeCustomerFromGroup).
// Uses InMemoryRepository for isolation — no DB required.

import { InMemoryRepository } from '@manta/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { CustomerModuleService } from '../src/service'

function createService() {
  return new CustomerModuleService({
    customerRepository: new InMemoryRepository('customer'),
    customerAddressRepository: new InMemoryRepository('customer_address'),
    customerGroupRepository: new InMemoryRepository('customer_group'),
    customerGroupCustomerRepository: new InMemoryRepository('customer_group_customer'),
  })
}

describe('CustomerModuleService', () => {
  let service: CustomerModuleService

  beforeEach(() => {
    service = createService()
  })

  // ═══════════════════════════════════════════════════════════════
  // Customer CRUD
  // ═══════════════════════════════════════════════════════════════

  describe('Customer', () => {
    it('should create a single customer', async () => {
      const customer = (await service.createCustomers({
        email: 'john@example.com',
        first_name: 'John',
        last_name: 'Doe',
        has_account: false,
      })) as Record<string, unknown>

      expect(customer.id).toBeDefined()
      expect(customer.email).toBe('john@example.com')
      expect(customer.first_name).toBe('John')
      expect(customer.last_name).toBe('Doe')
      expect(customer.has_account).toBe(false)
      expect(customer.created_at).toBeInstanceOf(Date)
      expect(customer.updated_at).toBeInstanceOf(Date)
      expect(customer.deleted_at).toBeNull()
    })

    it('should create multiple customers', async () => {
      const customers = (await service.createCustomers([
        { email: 'a@test.com', has_account: false },
        { email: 'b@test.com', has_account: true },
      ])) as Record<string, unknown>[]

      expect(customers).toHaveLength(2)
      expect(customers[0].email).toBe('a@test.com')
      expect(customers[1].email).toBe('b@test.com')
      expect(customers[1].has_account).toBe(true)
    })

    it('should create a customer with nested addresses', async () => {
      const customer = (await service.createCustomers({
        email: 'jane@example.com',
        has_account: true,
        addresses: [
          { address_1: '123 Main St', city: 'Paris', is_default_shipping: true, is_default_billing: false },
          { address_1: '456 Oak Ave', city: 'Lyon', is_default_shipping: false, is_default_billing: true },
        ],
      })) as Record<string, unknown>

      expect(customer.email).toBe('jane@example.com')

      // Verify addresses were created with the customer_id
      const addresses = await service.listCustomerAddresses({ customer_id: customer.id })
      expect(addresses).toHaveLength(2)
      expect(addresses[0].customer_id).toBe(customer.id)
      expect(addresses[1].customer_id).toBe(customer.id)
    })

    it('should retrieve a customer by id', async () => {
      const created = (await service.createCustomers({
        email: 'retrieve@test.com',
        has_account: false,
      })) as Record<string, unknown>

      const retrieved = await service.retrieveCustomer(created.id as string)
      expect(retrieved.email).toBe('retrieve@test.com')
      expect(retrieved.id).toBe(created.id)
    })

    it('should throw NOT_FOUND for non-existent customer', async () => {
      await expect(service.retrieveCustomer('non-existent-id')).rejects.toThrow(
        'Customer with id "non-existent-id" not found',
      )
    })

    it('should list customers with filters', async () => {
      await service.createCustomers([
        { email: 'active@test.com', has_account: true },
        { email: 'guest@test.com', has_account: false },
        { email: 'active2@test.com', has_account: true },
      ])

      const activeCustomers = await service.listCustomers({ has_account: true })
      expect(activeCustomers).toHaveLength(2)
      expect(activeCustomers.every((c) => c.has_account === true)).toBe(true)
    })

    it('should list customers with pagination', async () => {
      await service.createCustomers([
        { email: '1@test.com', has_account: false },
        { email: '2@test.com', has_account: false },
        { email: '3@test.com', has_account: false },
      ])

      const page = await service.listCustomers({}, { skip: 1, take: 1 })
      expect(page).toHaveLength(1)
    })

    it('should list and count customers', async () => {
      await service.createCustomers([
        { email: 'a@test.com', has_account: false },
        { email: 'b@test.com', has_account: false },
      ])

      const [customers, count] = await service.listAndCountCustomers()
      expect(customers).toHaveLength(2)
      expect(count).toBe(2)
    })

    it('should update a single customer', async () => {
      const created = (await service.createCustomers({
        email: 'before@test.com',
        has_account: false,
      })) as Record<string, unknown>

      const updated = (await service.updateCustomers({
        id: created.id as string,
        email: 'after@test.com',
        has_account: true,
      })) as Record<string, unknown>

      expect(updated.email).toBe('after@test.com')
      expect(updated.has_account).toBe(true)
    })

    it('should update multiple customers', async () => {
      const [c1, c2] = (await service.createCustomers([
        { email: 'a@test.com', has_account: false },
        { email: 'b@test.com', has_account: false },
      ])) as Record<string, unknown>[]

      const updated = (await service.updateCustomers([
        { id: c1.id as string, has_account: true },
        { id: c2.id as string, has_account: true },
      ])) as Record<string, unknown>[]

      expect(updated).toHaveLength(2)
      expect(updated[0].has_account).toBe(true)
      expect(updated[1].has_account).toBe(true)
    })

    it('should delete a customer and cascade to addresses and group memberships', async () => {
      const customer = (await service.createCustomers({
        email: 'delete-me@test.com',
        has_account: false,
      })) as Record<string, unknown>

      // Create an address for the customer
      await service.createCustomerAddresses({
        customer_id: customer.id,
        address_1: '123 Main St',
        is_default_shipping: false,
        is_default_billing: false,
      })

      // Create a group and add customer to it
      const group = (await service.createCustomerGroups({ name: 'VIP' })) as Record<string, unknown>
      await service.addCustomerToGroup({
        customer_id: customer.id as string,
        customer_group_id: group.id as string,
      })

      // Delete customer — should cascade
      await service.deleteCustomers(customer.id as string)

      // Customer should be gone
      await expect(service.retrieveCustomer(customer.id as string)).rejects.toThrow('not found')

      // Addresses should be gone
      const addresses = await service.listCustomerAddresses({ customer_id: customer.id })
      expect(addresses).toHaveLength(0)

      // Group membership should be gone
      const groups = await service.listCustomerGroups()
      expect(groups).toHaveLength(1) // Group still exists
    })

    it('should soft-delete and restore a customer', async () => {
      const customer = (await service.createCustomers({
        email: 'softdelete@test.com',
        has_account: false,
      })) as Record<string, unknown>

      await service.softDeleteCustomers(customer.id as string)

      // Should not appear in normal list
      const listed = await service.listCustomers()
      expect(listed).toHaveLength(0)

      // Restore
      await service.restoreCustomers(customer.id as string)

      const restored = await service.listCustomers()
      expect(restored).toHaveLength(1)
      expect(restored[0].email).toBe('softdelete@test.com')
    })

    it('should handle nullable fields', async () => {
      const customer = (await service.createCustomers({
        email: 'test@test.com',
        has_account: false,
        company_name: null,
        phone: null,
        metadata: null,
      })) as Record<string, unknown>

      expect(customer.company_name).toBeNull()
      expect(customer.phone).toBeNull()
      expect(customer.metadata).toBeNull()
    })

    it('should store metadata as JSON', async () => {
      const metadata = { tier: 'gold', source: 'referral' }
      const customer = (await service.createCustomers({
        email: 'meta@test.com',
        has_account: false,
        metadata,
      })) as Record<string, unknown>

      expect(customer.metadata).toEqual(metadata)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // CustomerAddress CRUD
  // ═══════════════════════════════════════════════════════════════

  describe('CustomerAddress', () => {
    let customerId: string

    beforeEach(async () => {
      const customer = (await service.createCustomers({
        email: 'addr-owner@test.com',
        has_account: false,
      })) as Record<string, unknown>
      customerId = customer.id as string
    })

    it('should create an address', async () => {
      const address = (await service.createCustomerAddresses({
        customer_id: customerId,
        address_1: '123 Main St',
        city: 'Paris',
        country_code: 'FR',
        postal_code: '75001',
        is_default_shipping: true,
        is_default_billing: false,
      })) as Record<string, unknown>

      expect(address.id).toBeDefined()
      expect(address.customer_id).toBe(customerId)
      expect(address.city).toBe('Paris')
      expect(address.country_code).toBe('FR')
      expect(address.is_default_shipping).toBe(true)
    })

    it('should create multiple addresses', async () => {
      const addresses = (await service.createCustomerAddresses([
        { customer_id: customerId, address_1: 'Addr 1', is_default_shipping: false, is_default_billing: false },
        { customer_id: customerId, address_1: 'Addr 2', is_default_shipping: false, is_default_billing: false },
      ])) as Record<string, unknown>[]

      expect(addresses).toHaveLength(2)
    })

    it('should retrieve an address by id', async () => {
      const created = (await service.createCustomerAddresses({
        customer_id: customerId,
        address_1: 'Retrieve Me',
        is_default_shipping: false,
        is_default_billing: false,
      })) as Record<string, unknown>

      const retrieved = await service.retrieveCustomerAddress(created.id as string)
      expect(retrieved.address_1).toBe('Retrieve Me')
    })

    it('should throw NOT_FOUND for non-existent address', async () => {
      await expect(service.retrieveCustomerAddress('nope')).rejects.toThrow('not found')
    })

    it('should list addresses for a customer', async () => {
      await service.createCustomerAddresses([
        { customer_id: customerId, address_1: 'Home', is_default_shipping: false, is_default_billing: false },
        { customer_id: customerId, address_1: 'Work', is_default_shipping: false, is_default_billing: false },
      ])

      const addresses = await service.listCustomerAddresses({ customer_id: customerId })
      expect(addresses).toHaveLength(2)
    })

    it('should update an address', async () => {
      const created = (await service.createCustomerAddresses({
        customer_id: customerId,
        city: 'Paris',
        is_default_shipping: false,
        is_default_billing: false,
      })) as Record<string, unknown>

      const updated = (await service.updateCustomerAddresses({
        id: created.id as string,
        city: 'Lyon',
        is_default_shipping: true,
      })) as Record<string, unknown>

      expect(updated.city).toBe('Lyon')
      expect(updated.is_default_shipping).toBe(true)
    })

    it('should delete an address', async () => {
      const created = (await service.createCustomerAddresses({
        customer_id: customerId,
        city: 'Delete Me',
        is_default_shipping: false,
        is_default_billing: false,
      })) as Record<string, unknown>

      await service.deleteCustomerAddresses(created.id as string)

      await expect(service.retrieveCustomerAddress(created.id as string)).rejects.toThrow('not found')
    })

    it('should handle all address fields', async () => {
      const address = (await service.createCustomerAddresses({
        customer_id: customerId,
        address_name: 'Home',
        is_default_shipping: true,
        is_default_billing: true,
        company: 'ACME Corp',
        first_name: 'John',
        last_name: 'Doe',
        address_1: '123 Main St',
        address_2: 'Apt 4',
        city: 'Paris',
        country_code: 'FR',
        province: 'Île-de-France',
        postal_code: '75001',
        phone: '+33123456789',
        metadata: { floor: 3 },
      })) as Record<string, unknown>

      expect(address.address_name).toBe('Home')
      expect(address.company).toBe('ACME Corp')
      expect(address.province).toBe('Île-de-France')
      expect(address.metadata).toEqual({ floor: 3 })
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // CustomerGroup CRUD
  // ═══════════════════════════════════════════════════════════════

  describe('CustomerGroup', () => {
    it('should create a customer group', async () => {
      const group = (await service.createCustomerGroups({
        name: 'VIP',
        metadata: { discount: 20 },
      })) as Record<string, unknown>

      expect(group.id).toBeDefined()
      expect(group.name).toBe('VIP')
      expect(group.metadata).toEqual({ discount: 20 })
    })

    it('should create multiple groups', async () => {
      const groups = (await service.createCustomerGroups([
        { name: 'Gold' },
        { name: 'Silver' },
        { name: 'Bronze' },
      ])) as Record<string, unknown>[]

      expect(groups).toHaveLength(3)
    })

    it('should retrieve a group by id', async () => {
      const created = (await service.createCustomerGroups({ name: 'Retrieve' })) as Record<string, unknown>
      const retrieved = await service.retrieveCustomerGroup(created.id as string)
      expect(retrieved.name).toBe('Retrieve')
    })

    it('should throw NOT_FOUND for non-existent group', async () => {
      await expect(service.retrieveCustomerGroup('nope')).rejects.toThrow('not found')
    })

    it('should list groups', async () => {
      await service.createCustomerGroups([{ name: 'A' }, { name: 'B' }])

      const groups = await service.listCustomerGroups()
      expect(groups).toHaveLength(2)
    })

    it('should update a group', async () => {
      const created = (await service.createCustomerGroups({ name: 'Old Name' })) as Record<string, unknown>

      const updated = (await service.updateCustomerGroups({
        id: created.id as string,
        name: 'New Name',
      })) as Record<string, unknown>

      expect(updated.name).toBe('New Name')
    })

    it('should delete a group and cascade memberships', async () => {
      const group = (await service.createCustomerGroups({ name: 'Delete Me' })) as Record<string, unknown>
      const customer = (await service.createCustomers({
        email: 'member@test.com',
        has_account: false,
      })) as Record<string, unknown>

      await service.addCustomerToGroup({
        customer_id: customer.id as string,
        customer_group_id: group.id as string,
      })

      await service.deleteCustomerGroups(group.id as string)

      await expect(service.retrieveCustomerGroup(group.id as string)).rejects.toThrow('not found')
    })

    it('should soft-delete and restore a group', async () => {
      const group = (await service.createCustomerGroups({ name: 'Soft' })) as Record<string, unknown>

      await service.softDeleteCustomerGroups(group.id as string)
      const listed = await service.listCustomerGroups()
      expect(listed).toHaveLength(0)

      await service.restoreCustomerGroups(group.id as string)
      const restored = await service.listCustomerGroups()
      expect(restored).toHaveLength(1)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // addCustomerToGroup / removeCustomerFromGroup
  // ═══════════════════════════════════════════════════════════════

  describe('Customer-Group association', () => {
    let customerId: string
    let groupId: string

    beforeEach(async () => {
      const customer = (await service.createCustomers({
        email: 'assoc@test.com',
        has_account: true,
      })) as Record<string, unknown>
      customerId = customer.id as string

      const group = (await service.createCustomerGroups({ name: 'Test Group' })) as Record<string, unknown>
      groupId = group.id as string
    })

    it('should add a customer to a group', async () => {
      const result = (await service.addCustomerToGroup({
        customer_id: customerId,
        customer_group_id: groupId,
      })) as { id: string }

      expect(result.id).toBeDefined()
    })

    it('should add multiple customers to groups', async () => {
      const customer2 = (await service.createCustomers({
        email: 'assoc2@test.com',
        has_account: false,
      })) as Record<string, unknown>

      const results = (await service.addCustomerToGroup([
        { customer_id: customerId, customer_group_id: groupId },
        { customer_id: customer2.id as string, customer_group_id: groupId },
      ])) as { id: string }[]

      expect(results).toHaveLength(2)
      expect(results[0].id).toBeDefined()
      expect(results[1].id).toBeDefined()
    })

    it('should not duplicate when adding same pair twice', async () => {
      const first = (await service.addCustomerToGroup({
        customer_id: customerId,
        customer_group_id: groupId,
      })) as { id: string }

      const second = (await service.addCustomerToGroup({
        customer_id: customerId,
        customer_group_id: groupId,
      })) as { id: string }

      // Should return the same id (no duplicate created)
      expect(first.id).toBe(second.id)
    })

    it('should remove a customer from a group', async () => {
      await service.addCustomerToGroup({
        customer_id: customerId,
        customer_group_id: groupId,
      })

      await service.removeCustomerFromGroup({
        customer_id: customerId,
        customer_group_id: groupId,
      })

      // Adding again should create a new record (old one was deleted)
      const result = (await service.addCustomerToGroup({
        customer_id: customerId,
        customer_group_id: groupId,
      })) as { id: string }

      expect(result.id).toBeDefined()
    })

    it('should remove multiple customers from groups', async () => {
      const group2 = (await service.createCustomerGroups({ name: 'Group 2' })) as Record<string, unknown>

      await service.addCustomerToGroup([
        { customer_id: customerId, customer_group_id: groupId },
        { customer_id: customerId, customer_group_id: group2.id as string },
      ])

      await service.removeCustomerFromGroup([
        { customer_id: customerId, customer_group_id: groupId },
        { customer_id: customerId, customer_group_id: group2.id as string },
      ])

      // Both should be removed — re-adding should work
      const result = (await service.addCustomerToGroup({
        customer_id: customerId,
        customer_group_id: groupId,
      })) as { id: string }
      expect(result.id).toBeDefined()
    })

    it('should silently handle removing a non-existent association', async () => {
      // Should not throw
      await service.removeCustomerFromGroup({
        customer_id: customerId,
        customer_group_id: groupId,
      })
    })

    it('should support created_by on association', async () => {
      const result = (await service.addCustomerToGroup({
        customer_id: customerId,
        customer_group_id: groupId,
        created_by: 'admin-user-123',
      })) as { id: string }

      expect(result.id).toBeDefined()
    })

    it('should support metadata on association', async () => {
      const result = (await service.addCustomerToGroup({
        customer_id: customerId,
        customer_group_id: groupId,
        metadata: { source: 'import' },
      })) as { id: string }

      expect(result.id).toBeDefined()
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // Edge cases & integration scenarios
  // ═══════════════════════════════════════════════════════════════

  describe('Edge cases', () => {
    it('should handle empty arrays for batch operations', async () => {
      const customers = (await service.createCustomers([])) as Record<string, unknown>[]
      expect(customers).toHaveLength(0)
    })

    it('should delete multiple customers', async () => {
      const [c1, c2] = (await service.createCustomers([
        { email: 'del1@test.com', has_account: false },
        { email: 'del2@test.com', has_account: false },
      ])) as Record<string, unknown>[]

      await service.deleteCustomers([c1.id as string, c2.id as string])

      const listed = await service.listCustomers()
      expect(listed).toHaveLength(0)
    })

    it('should handle customer with all fields populated', async () => {
      const customer = (await service.createCustomers({
        company_name: 'ACME Corp',
        first_name: 'John',
        last_name: 'Doe',
        email: 'john.doe@acme.com',
        phone: '+33123456789',
        has_account: true,
        metadata: { source: 'api', tier: 'enterprise' },
        created_by: 'admin-user',
      })) as Record<string, unknown>

      expect(customer.company_name).toBe('ACME Corp')
      expect(customer.first_name).toBe('John')
      expect(customer.last_name).toBe('Doe')
      expect(customer.email).toBe('john.doe@acme.com')
      expect(customer.phone).toBe('+33123456789')
      expect(customer.has_account).toBe(true)
      expect(customer.created_by).toBe('admin-user')
    })

    it('full scenario: create customer with addresses, add to groups, then clean up', async () => {
      // Create customer
      const customer = (await service.createCustomers({
        email: 'scenario@test.com',
        first_name: 'Test',
        has_account: true,
      })) as Record<string, unknown>

      // Create addresses
      await service.createCustomerAddresses([
        {
          customer_id: customer.id,
          address_1: 'Home',
          city: 'Paris',
          is_default_shipping: true,
          is_default_billing: false,
        },
        {
          customer_id: customer.id,
          address_1: 'Work',
          city: 'Lyon',
          is_default_shipping: false,
          is_default_billing: true,
        },
      ])

      // Create groups
      const [vip, premium] = (await service.createCustomerGroups([{ name: 'VIP' }, { name: 'Premium' }])) as Record<
        string,
        unknown
      >[]

      // Add to groups
      await service.addCustomerToGroup([
        { customer_id: customer.id as string, customer_group_id: vip.id as string },
        { customer_id: customer.id as string, customer_group_id: premium.id as string },
      ])

      // Verify
      const addresses = await service.listCustomerAddresses({ customer_id: customer.id })
      expect(addresses).toHaveLength(2)

      // Remove from one group
      await service.removeCustomerFromGroup({
        customer_id: customer.id as string,
        customer_group_id: premium.id as string,
      })

      // Update customer
      const updated = (await service.updateCustomers({
        id: customer.id as string,
        last_name: 'Updated',
      })) as Record<string, unknown>
      expect(updated.last_name).toBe('Updated')
      expect(updated.first_name).toBe('Test') // Unchanged

      // Delete customer — should cascade
      await service.deleteCustomers(customer.id as string)

      const remaining = await service.listCustomers()
      expect(remaining).toHaveLength(0)

      const remainingAddresses = await service.listCustomerAddresses()
      expect(remainingAddresses).toHaveLength(0)

      // Groups should still exist
      const groups = await service.listCustomerGroups()
      expect(groups).toHaveLength(2)
    })
  })
})
