import { ShopifyAdminClient } from '../../modules/shopify-admin/client'

type DiscountMethod = 'code' | 'automatic'
type DiscountTargetType = 'all' | 'collections' | 'products'
type DiscountValueType = 'percentage' | 'amount'

interface ShopifyDiscountMutationResult {
  codeDiscountNode?: { id: string } | null
  automaticDiscountNode?: { id: string } | null
  userErrors: Array<{ field?: string[] | null; message: string }>
}

interface ExistingDiscountTarget {
  type: DiscountTargetType
  collectionIds: string[]
  productIds: string[]
}

const discountInputSchema = z.object({
  id: z.string().min(1).optional(),
  method: z.enum(['code', 'automatic']),
  title: z.string().trim().min(1),
  code: z.string().trim().optional(),
  value_type: z.enum(['percentage', 'amount']),
  value: z.number().positive(),
  target_type: z.enum(['all', 'collections', 'products']),
  collection_ids: z.array(z.string()).default([]),
  product_ids: z.array(z.string()).default([]),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime().nullable().optional(),
  applies_once_per_customer: z.boolean().default(false),
  usage_limit: z.number().int().positive().nullable().optional(),
  combines_with_order: z.boolean().default(false),
  combines_with_product: z.boolean().default(false),
  combines_with_shipping: z.boolean().default(false),
})

interface DiscountInput {
  id?: string
  method: DiscountMethod
  title: string
  code?: string
  value_type: DiscountValueType
  value: number
  target_type: DiscountTargetType
  collection_ids: string[]
  product_ids: string[]
  starts_at: string
  ends_at?: string | null
  applies_once_per_customer: boolean
  usage_limit?: number | null
  combines_with_order: boolean
  combines_with_product: boolean
  combines_with_shipping: boolean
}

export default defineCommand({
  name: 'upsertShopifyDiscount',
  description: 'Create or update a Shopify basic discount from the Palas admin.',
  input: discountInputSchema,
  workflow: async (input) => {
    validateInput(input)
    const client = new ShopifyAdminClient()
    const existingTarget = input.id ? await readExistingTarget(client, input.id) : null
    const needsTargetReset =
      Boolean(input.id) &&
      existingTarget !== null &&
      existingTarget.type !== 'all' &&
      existingTarget.type !== input.target_type &&
      input.target_type !== 'all'

    if (input.method === 'code') {
      if (needsTargetReset) {
        await updateCodeDiscount(client, input.id as string, buildShopifyInput(input, null, 'all'))
      }
      const shopifyInput = buildShopifyInput(input, existingTarget)
      const data = await client.query<{
        discountCodeBasicCreate?: ShopifyDiscountMutationResult
        discountCodeBasicUpdate?: ShopifyDiscountMutationResult
      }>(
        input.id
          ? `
            mutation PalasUpdateCodeDiscount($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
              discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
                codeDiscountNode { id }
                userErrors { field message }
              }
            }
          `
          : `
            mutation PalasCreateCodeDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
              discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
                codeDiscountNode { id }
                userErrors { field message }
              }
            }
          `,
        input.id ? { id: input.id, basicCodeDiscount: shopifyInput } : { basicCodeDiscount: shopifyInput },
      )
      const result = input.id ? data.discountCodeBasicUpdate : data.discountCodeBasicCreate
      return normalizeResult(result, 'code')
    }

    if (needsTargetReset) {
      await updateAutomaticDiscount(client, input.id as string, buildShopifyInput(input, null, 'all'))
    }
    const shopifyInput = buildShopifyInput(input, existingTarget)
    const data = await client.query<{
      discountAutomaticBasicCreate?: ShopifyDiscountMutationResult
      discountAutomaticBasicUpdate?: ShopifyDiscountMutationResult
    }>(
      input.id
        ? `
          mutation PalasUpdateAutomaticDiscount($id: ID!, $automaticBasicDiscount: DiscountAutomaticBasicInput!) {
            discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $automaticBasicDiscount) {
              automaticDiscountNode { id }
              userErrors { field message }
            }
          }
        `
        : `
          mutation PalasCreateAutomaticDiscount($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
            discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
              automaticDiscountNode { id }
              userErrors { field message }
            }
          }
        `,
      input.id ? { id: input.id, automaticBasicDiscount: shopifyInput } : { automaticBasicDiscount: shopifyInput },
    )
    const result = input.id ? data.discountAutomaticBasicUpdate : data.discountAutomaticBasicCreate
    return normalizeResult(result, 'automatic')
  },
})

function validateInput(input: DiscountInput) {
  if (input.method === 'code' && !input.code?.trim()) {
    throw new MantaError('INVALID_DATA', 'Le code promo est obligatoire pour un discount à code.')
  }
  if (input.value_type === 'percentage' && input.value > 100) {
    throw new MantaError('INVALID_DATA', 'Le pourcentage ne peut pas dépasser 100%.')
  }
  if (input.target_type === 'collections' && input.collection_ids.length === 0) {
    throw new MantaError('INVALID_DATA', 'Sélectionne au moins une collection.')
  }
  if (input.target_type === 'products' && input.product_ids.length === 0) {
    throw new MantaError('INVALID_DATA', 'Sélectionne au moins un produit.')
  }
}

async function updateCodeDiscount(client: ShopifyAdminClient, id: string, shopifyInput: Record<string, unknown>) {
  const data = await client.query<{ discountCodeBasicUpdate: ShopifyDiscountMutationResult }>(
    `
      mutation PalasResetCodeDiscountTarget($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode { id }
          userErrors { field message }
        }
      }
    `,
    { id, basicCodeDiscount: shopifyInput },
  )
  normalizeResult(data.discountCodeBasicUpdate, 'code')
}

async function updateAutomaticDiscount(client: ShopifyAdminClient, id: string, shopifyInput: Record<string, unknown>) {
  const data = await client.query<{ discountAutomaticBasicUpdate: ShopifyDiscountMutationResult }>(
    `
      mutation PalasResetAutomaticDiscountTarget($id: ID!, $automaticBasicDiscount: DiscountAutomaticBasicInput!) {
        discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $automaticBasicDiscount) {
          automaticDiscountNode { id }
          userErrors { field message }
        }
      }
    `,
    { id, automaticBasicDiscount: shopifyInput },
  )
  normalizeResult(data.discountAutomaticBasicUpdate, 'automatic')
}

function buildShopifyInput(input: DiscountInput, existingTarget: ExistingDiscountTarget | null, forcedTarget?: 'all') {
  const base: Record<string, unknown> = {
    title: input.title.trim(),
    startsAt: input.starts_at,
    endsAt: input.ends_at || null,
    combinesWith: {
      orderDiscounts: input.combines_with_order,
      productDiscounts: input.combines_with_product,
      shippingDiscounts: input.combines_with_shipping,
    },
    customerGets: {
      value: buildValue(input.value_type, input.value),
      items:
        forcedTarget === 'all'
          ? { all: true }
          : buildItems(input.target_type, input.collection_ids, input.product_ids, existingTarget),
    },
  }

  if (input.method === 'code') {
    return {
      ...base,
      code: input.code?.trim(),
      customerSelection: { all: true },
      appliesOncePerCustomer: input.applies_once_per_customer,
      usageLimit: input.usage_limit ?? null,
    }
  }

  return base
}

function buildValue(type: DiscountValueType, value: number) {
  if (type === 'percentage') return { percentage: value / 100 }
  return { discountAmount: { amount: String(value), appliesOnEachItem: false } }
}

function buildItems(
  target: DiscountTargetType,
  collectionIds: string[],
  productIds: string[],
  existingTarget: ExistingDiscountTarget | null,
) {
  if (target === 'collections') {
    return {
      collections: {
        add: collectionIds,
        remove: difference(existingTarget?.type === 'collections' ? existingTarget.collectionIds : [], collectionIds),
      },
    }
  }
  if (target === 'products') {
    return {
      products: {
        productsToAdd: productIds,
        productsToRemove: difference(existingTarget?.type === 'products' ? existingTarget.productIds : [], productIds),
      },
    }
  }
  return { all: true }
}

async function readExistingTarget(client: ShopifyAdminClient, id: string): Promise<ExistingDiscountTarget> {
  const data = await client.query<{
    discountNode: {
      discount: {
        customerGets?: {
          items?: {
            __typename: string
            collections?: { nodes?: Array<{ id: string }> }
            products?: { nodes?: Array<{ id: string }> }
          }
        }
      } | null
    } | null
  }>(
    `
      query PalasReadDiscountTarget($id: ID!) {
        discountNode(id: $id) {
          discount {
            ... on DiscountCodeBasic {
              customerGets {
                items {
                  __typename
                  ... on DiscountCollections { collections(first: 100) { nodes { id } } }
                  ... on DiscountProducts { products(first: 100) { nodes { id } } }
                }
              }
            }
            ... on DiscountAutomaticBasic {
              customerGets {
                items {
                  __typename
                  ... on DiscountCollections { collections(first: 100) { nodes { id } } }
                  ... on DiscountProducts { products(first: 100) { nodes { id } } }
                }
              }
            }
          }
        }
      }
    `,
    { id },
  )

  const items = data.discountNode?.discount?.customerGets?.items
  if (items?.__typename === 'DiscountCollections') {
    return {
      type: 'collections',
      collectionIds: items.collections?.nodes?.map((node) => node.id) ?? [],
      productIds: [],
    }
  }
  if (items?.__typename === 'DiscountProducts') {
    return {
      type: 'products',
      collectionIds: [],
      productIds: items.products?.nodes?.map((node) => node.id) ?? [],
    }
  }
  return { type: 'all', collectionIds: [], productIds: [] }
}

function difference(previous: string[], next: string[]): string[] {
  const nextSet = new Set(next)
  return previous.filter((id) => !nextSet.has(id))
}

function normalizeResult(result: ShopifyDiscountMutationResult | undefined, method: DiscountMethod) {
  if (!result) throw new MantaError('UNEXPECTED_STATE', 'Réponse Shopify invalide.')
  if (result.userErrors.length > 0) {
    throw new MantaError('INVALID_DATA', result.userErrors.map((error) => error.message).join(' | '))
  }
  const id = result.codeDiscountNode?.id ?? result.automaticDiscountNode?.id
  if (!id) throw new MantaError('UNEXPECTED_STATE', 'Shopify n’a pas renvoyé de discount.')
  return { id, method }
}
