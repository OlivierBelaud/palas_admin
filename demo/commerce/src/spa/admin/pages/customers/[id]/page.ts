import { definePage } from '@manta/dashboard-core'

export default definePage({
  header: {
    titleField: 'first_name,last_name',
    descriptionField: 'email',
    actions: ['edit', 'delete'],
  },
  main: [
    {
      type: 'InfoCard',
      title: 'General',
      query: {
        graph: {
          entity: 'customer',
          fields: ['first_name', 'last_name', 'email', 'phone', 'company_name'],
        },
      },
    },
    {
      type: 'InfoCard',
      title: 'Billing Address',
      query: {
        name: 'customer-billing-address',
        input: { customer_id: ':id' },
      },
      fields: [
        { key: 'company', label: 'Company' },
        { key: 'first_name', label: 'First Name' },
        { key: 'last_name', label: 'Last Name' },
        { key: 'address_1', label: 'Address' },
        { key: 'address_2', label: 'Address Line 2' },
        { key: 'postal_code', label: 'Postal Code' },
        { key: 'city', label: 'City' },
        { key: 'province', label: 'Province' },
        { key: 'country_code', label: 'Country' },
        { key: 'phone', label: 'Phone' },
      ],
      emptyText: 'No billing address — will use default shipping address',
      actions: [
        { label: 'Edit', to: 'add-billing-address' },
        { label: 'Remove', action: 'delete', destructive: true },
      ],
    },
    {
      type: 'RelationTable',
      title: 'Shipping Addresses',
      query: {
        name: 'customer-addresses',
        input: { customer_id: ':id', type: 'shipping' },
      },
      columns: [
        { key: 'address_name', label: 'Name' },
        {
          key: 'is_default',
          label: 'Default',
          format: { type: 'badge', true: { label: 'Default', color: 'green' }, false: { label: '', color: 'gray' } },
        },
        { key: 'first_name', label: 'Recipient' },
        { key: 'address_1', label: 'Address' },
        { key: 'city', label: 'City' },
        { key: 'country_code', label: 'Country' },
        { key: 'postal_code', label: 'Postal Code' },
      ],
      actions: [{ label: 'Add Shipping Address', to: 'add-shipping-address' }],
      rowActions: [
        { label: 'Edit', icon: 'pencil', to: 'edit-address/:row.id' },
        { label: 'Delete', icon: 'trash', action: 'delete', entity: 'address', destructive: true },
      ],
    },
  ],
  sidebar: [
    {
      type: 'InfoCard',
      title: 'Status',
      query: {
        graph: {
          entity: 'customer',
          fields: ['has_account'],
        },
      },
      fields: [
        {
          key: 'has_account',
          label: 'Account',
          display: { type: 'badge', true: { label: 'Yes', color: 'green' }, false: { label: 'No', color: 'orange' } },
        },
      ],
    },
    {
      type: 'InfoCard',
      title: 'Dates',
      query: {
        graph: {
          entity: 'customer',
          fields: ['created_at', 'updated_at'],
        },
      },
      fields: [
        { key: 'created_at', label: 'Created', display: 'date' },
        { key: 'updated_at', label: 'Updated', display: 'date' },
      ],
    },
  ],
})
