// OpenAPI 3.1 spec generator — reflects Manta's CQRS architecture:
// Commands (mutations via POST /api/command/{name}) and Query Graph (reads via GET /api/query/{entity}).
// Zero manual annotation required.

import { zodToJsonSchema } from '@manta/core'
import type { z } from 'zod'

// ── Types ────────────────────────────────────────────────────────────

export interface OpenApiRoute {
  method: string
  path: string
  summary?: string
  description?: string
  tags?: string[]
  bodySchema?: z.ZodType<unknown>
  responseSchema?: z.ZodType<unknown>
  auth?: boolean
}

export interface OpenApiEntityField {
  name: string
  type: string
  nullable?: boolean
  values?: unknown
}

export interface OpenApiEntity {
  name: string
  moduleName?: string
  fields: OpenApiEntityField[]
}

export interface OpenApiCommand {
  name: string
  description: string
  inputSchema: z.ZodType<unknown>
}

export interface OpenApiSpec {
  openapi: '3.1.0'
  info: {
    title: string
    version: string
    description?: string
  }
  paths: Record<string, Record<string, unknown>>
  components: {
    schemas: Record<string, unknown>
    securitySchemes: Record<string, unknown>
  }
  tags: Array<{ name: string; description?: string }>
}

export interface GenerateOpenApiOptions {
  title?: string
  version?: string
  description?: string
  routes?: OpenApiRoute[]
  commands?: OpenApiCommand[]
  entities?: OpenApiEntity[]
  basePath?: string
}

// ── Main generator ───────────────────────────────────────────────────

export function generateOpenApiSpec(options: GenerateOpenApiOptions): OpenApiSpec {
  const basePath = options.basePath ?? '/api'
  const tags = new Map<string, string>()

  const spec: OpenApiSpec = {
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'Manta API',
      version: options.version ?? '1.0.0',
      description:
        options.description ??
        'Auto-generated from Manta CQRS architecture. Commands = mutations, Query Graph = reads.',
    },
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
        },
      },
    },
    tags: [],
  }

  // ── 1. Command endpoints (mutations) ───────────────────────────────

  if (options.commands && options.commands.length > 0) {
    tags.set('Commands', 'Mutation endpoints — execute business logic via defineCommand()')

    for (const cmd of options.commands) {
      const pathKey = `${basePath}/command/${cmd.name}`
      spec.paths[pathKey] = {
        post: {
          summary: cmd.description,
          description: `Execute the \`${cmd.name}\` command. Input is validated against the Zod schema defined in defineCommand().`,
          tags: ['Commands'],
          operationId: `command_${cmd.name.replace(/-/g, '_')}`,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: zodToJsonSchema(cmd.inputSchema),
              },
            },
          },
          responses: {
            '200': {
              description: 'Command executed successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      result: { type: 'object', description: 'Command result data' },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Invalid input — Zod validation failed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/MantaError' },
                },
              },
            },
            '401': { description: 'Unauthorized — missing or invalid JWT' },
            '500': { description: 'Internal server error' },
          },
          security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        },
      }
    }
  }

  // ── 2. Query Graph endpoints (reads) ───────────────────────────────

  if (options.entities && options.entities.length > 0) {
    tags.set('Query', 'Read endpoints — auto-generated from DML entities via the Query Graph')

    for (const entity of options.entities) {
      const entityLower = entity.name.charAt(0).toLowerCase() + entity.name.slice(1)
      const plural = pluralize(entityLower)
      const tagName = entity.name

      tags.set(tagName, `CRUD reads for ${entity.name} entity`)

      // Generate component schema for this entity
      spec.components.schemas[entity.name] = entityFieldsToJsonSchema(entity)

      // GET /api/query/{entity} — list with filters + pagination
      const listPath = `${basePath}/query/${entityLower}`
      spec.paths[listPath] = {
        get: {
          summary: `List ${entity.name} records`,
          description: `Query the ${entity.name} entity via the Query Graph. Supports filtering, pagination, field selection, and ordering.`,
          tags: ['Query', tagName],
          operationId: `list_${entityLower}`,
          parameters: [...buildQueryParameters(), ...buildFilterParameters(entity)],
          responses: {
            '200': {
              description: `List of ${entity.name} records`,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      [plural]: {
                        type: 'array',
                        items: { $ref: `#/components/schemas/${entity.name}` },
                      },
                      count: { type: 'integer', description: 'Total number of matching records' },
                    },
                    required: [plural, 'count'],
                  },
                },
              },
            },
            '400': {
              description: 'Invalid query parameters',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/MantaError' },
                },
              },
            },
            '401': { description: 'Unauthorized' },
          },
          security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        },
      }

      // GET /api/query/{entity}/{id} — get by ID
      const detailPath = `${basePath}/query/${entityLower}/{id}`
      spec.paths[detailPath] = {
        get: {
          summary: `Get ${entity.name} by ID`,
          description: `Retrieve a single ${entity.name} record by its unique identifier.`,
          tags: ['Query', tagName],
          operationId: `get_${entityLower}`,
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
              description: `Unique identifier of the ${entity.name}`,
            },
            {
              name: 'fields',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Comma-separated list of fields to return',
              example: buildFieldsExample(entity),
            },
          ],
          responses: {
            '200': {
              description: `${entity.name} record`,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: `#/components/schemas/${entity.name}` },
                    },
                    required: ['data'],
                  },
                },
              },
            },
            '404': {
              description: 'Not found',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/MantaError' },
                },
              },
            },
            '401': { description: 'Unauthorized' },
          },
          security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        },
      }
    }
  }

  // ── 3. Auth routes (auto-generated per defineUserModel context) ──────────

  // V2: auth routes are per-context (/api/{ctx}/login, /api/{ctx}/me, etc.)
  // They are dynamically generated from defineUserModel — not hardcoded here.
  // TODO: Populate from discovered user definitions for accurate OpenAPI spec.
  const authRoutes: Array<{ method: string; path: string; summary: string; auth: boolean }> = []

  tags.set('Auth', 'Authentication — register, login, JWT management')

  for (const route of authRoutes) {
    const pathKey = route.path
    if (!spec.paths[pathKey]) spec.paths[pathKey] = {}

    const operation: Record<string, unknown> = {
      summary: route.summary,
      tags: ['Auth'],
      operationId: `auth_${route.path.split('/').pop()?.replace(/-/g, '_')}`,
      responses: {
        '200': {
          description: 'Successful response',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        '400': {
          description: 'Invalid request',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/MantaError' } } },
        },
        '401': { description: 'Unauthorized' },
      },
    }

    if (route.auth) {
      operation.security = [{ bearerAuth: [] }]
    }

    spec.paths[pathKey][route.method.toLowerCase()] = operation
  }

  // ── 4. Static routes (src/api/ — edge cases) ──────────────────────

  if (options.routes && options.routes.length > 0) {
    tags.set('Custom', 'Custom static routes from src/api/')

    for (const route of options.routes) {
      const pathKey = route.path.replace(/:(\w+)/g, '{$1}').replace(/\*\*/g, '{path}')
      if (!spec.paths[pathKey]) spec.paths[pathKey] = {}

      const operation: Record<string, unknown> = {
        summary: route.summary ?? `${route.method.toUpperCase()} ${route.path}`,
        tags: route.tags ?? ['Custom'],
      }

      // Extract path parameters
      const paramMatches = route.path.matchAll(/:(\w+)/g)
      const parameters: Array<Record<string, unknown>> = []
      for (const match of paramMatches) {
        parameters.push({
          name: match[1],
          in: 'path',
          required: true,
          schema: { type: 'string' },
        })
      }
      if (parameters.length > 0) operation.parameters = parameters

      // Add request body if POST/PUT/PATCH
      if (['POST', 'PUT', 'PATCH'].includes(route.method.toUpperCase()) && route.bodySchema) {
        operation.requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: zodToJsonSchema(route.bodySchema),
            },
          },
        }
      }

      operation.responses = {
        '200': {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: route.responseSchema ? zodToJsonSchema(route.responseSchema) : { type: 'object' },
            },
          },
        },
        '400': {
          description: 'Invalid request',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/MantaError' } } },
        },
      }

      if (route.auth !== false) {
        operation.security = [{ bearerAuth: [] }, { apiKeyAuth: [] }]
      }

      spec.paths[pathKey][route.method.toLowerCase()] = operation
    }
  }

  // ── 5. Shared component schemas ────────────────────────────────────

  spec.components.schemas.MantaError = {
    type: 'object',
    description: 'Standard Manta error response',
    properties: {
      type: {
        type: 'string',
        description: 'Error type code',
        example: 'INVALID_DATA',
        enum: [
          'INVALID_DATA',
          'NOT_FOUND',
          'DUPLICATE_ERROR',
          'UNAUTHORIZED',
          'FORBIDDEN',
          'UNEXPECTED_STATE',
          'CONFLICT',
        ],
      },
      message: { type: 'string', description: 'Human-readable error message', example: 'Validation failed' },
      code: { type: 'string', description: 'Optional machine-readable code' },
      details: { type: 'object', description: 'Additional error details (e.g. Zod validation errors)' },
    },
    required: ['type', 'message'],
  }

  spec.components.schemas.PaginationParams = {
    type: 'object',
    description: 'Standard pagination parameters for Query Graph endpoints',
    properties: {
      limit: { type: 'integer', default: 100, maximum: 10000, minimum: 1, description: 'Max records to return' },
      offset: { type: 'integer', default: 0, minimum: 0, description: 'Number of records to skip' },
      order: { type: 'string', description: 'Sort order. Prefix with - for descending.', example: '-created_at' },
    },
  }

  // ── 6. Build tags array ────────────────────────────────────────────

  // Order: Commands first, then Query, then entity-specific, then Auth, then Custom
  const tagOrder = ['Commands', 'Query']
  const entityTags = [...tags.keys()].filter((t) => !['Commands', 'Query', 'Auth', 'Custom'].includes(t))
  entityTags.sort()
  tagOrder.push(...entityTags, 'Auth', 'Custom')

  for (const name of tagOrder) {
    const description = tags.get(name)
    if (description) {
      spec.tags.push({ name, description })
    }
  }

  return spec
}

// ── Helper: build standard query parameters ──────────────────────────

function buildQueryParameters(): Array<Record<string, unknown>> {
  return [
    {
      name: 'limit',
      in: 'query',
      required: false,
      schema: { type: 'integer', default: 100, maximum: 10000, minimum: 1 },
      description: 'Maximum number of records to return',
    },
    {
      name: 'offset',
      in: 'query',
      required: false,
      schema: { type: 'integer', default: 0, minimum: 0 },
      description: 'Number of records to skip for pagination',
    },
    {
      name: 'order',
      in: 'query',
      required: false,
      schema: { type: 'string' },
      description: 'Sort order. Use field name for ascending, prefix with - for descending.',
      example: '-created_at',
    },
    {
      name: 'fields',
      in: 'query',
      required: false,
      schema: { type: 'string' },
      description: 'Comma-separated list of fields to return (default: all)',
    },
    {
      name: 'withDeleted',
      in: 'query',
      required: false,
      schema: { type: 'boolean', default: false },
      description: 'Include soft-deleted records',
    },
  ]
}

// ── Helper: build filter parameters from entity fields ───────────────

function buildFilterParameters(entity: OpenApiEntity): Array<Record<string, unknown>> {
  const params: Array<Record<string, unknown>> = []

  for (const field of entity.fields) {
    const mapped = mapDmlTypeToJsonSchema(field.type)

    params.push({
      name: `filter[${field.name}]`,
      in: 'query',
      required: false,
      schema: mapped.schema,
      description: `Filter by ${field.name}${field.values ? ` (values: ${JSON.stringify(field.values)})` : ''}`,
    })
  }

  return params
}

// ── Helper: build fields example string ──────────────────────────────

function buildFieldsExample(entity: OpenApiEntity): string {
  const fieldNames = ['id', ...entity.fields.slice(0, 3).map((f) => f.name)]
  return fieldNames.join(',')
}

// ── Helper: pluralize entity name ────────────────────────────────────

function pluralize(name: string): string {
  if (name.endsWith('s') || name.endsWith('x') || name.endsWith('ch') || name.endsWith('sh')) {
    return `${name}es`
  }
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) {
    return `${name.slice(0, -1)}ies`
  }
  return `${name}s`
}

// ── Helper: map DML type to JSON Schema ──────────────────────────────

interface MappedType {
  schema: Record<string, unknown>
  example?: unknown
}

function mapDmlTypeToJsonSchema(dmlType: string): MappedType {
  switch (dmlType) {
    case 'text':
      return { schema: { type: 'string' }, example: 'Example text' }
    case 'number':
      return { schema: { type: 'integer' }, example: 42 }
    case 'float':
      return { schema: { type: 'number' }, example: 19.99 }
    case 'boolean':
      return { schema: { type: 'boolean' }, example: true }
    case 'bigNumber':
      return { schema: { type: 'string', description: 'Numeric string for precision' }, example: '99999999.99' }
    case 'dateTime':
      return { schema: { type: 'string', format: 'date-time' }, example: '2026-01-15T10:30:00Z' }
    case 'json':
      return { schema: { type: 'object' }, example: {} }
    case 'array':
      return { schema: { type: 'array', items: {} } }
    case 'enum':
      return { schema: { type: 'string' } }
    case 'id':
      return { schema: { type: 'string', format: 'uuid' }, example: 'prod_01H...' }
    case 'serial':
    case 'autoincrement':
      return { schema: { type: 'integer' }, example: 1 }
    default:
      return { schema: { type: 'string' } }
  }
}

// ── Helper: convert entity fields to JSON Schema ─────────────────────

function entityFieldsToJsonSchema(entity: OpenApiEntity): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = ['id']

  // Implicit ID field
  properties.id = { type: 'string', format: 'uuid', description: 'Unique identifier', example: 'prod_01H...' }

  for (const field of entity.fields) {
    const mapped = mapDmlTypeToJsonSchema(field.type)
    const propSchema: Record<string, unknown> = { ...mapped.schema }

    if (mapped.example !== undefined) {
      propSchema.example = mapped.example
    }

    // Handle enum values
    if (field.type === 'enum' && field.values) {
      const values = Array.isArray(field.values) ? field.values : Object.values(field.values as Record<string, unknown>)
      const stringValues = values.filter((v): v is string => typeof v === 'string')
      if (stringValues.length > 0) {
        propSchema.enum = stringValues
        propSchema.example = stringValues[0]
      }
    }

    if (field.nullable) {
      propSchema.nullable = true
    }

    properties[field.name] = propSchema

    if (!field.nullable) {
      required.push(field.name)
    }
  }

  // Implicit timestamp fields
  properties.created_at = { type: 'string', format: 'date-time', description: 'Creation timestamp' }
  properties.updated_at = { type: 'string', format: 'date-time', description: 'Last update timestamp' }
  properties.deleted_at = { type: 'string', format: 'date-time', nullable: true, description: 'Soft-delete timestamp' }
  required.push('created_at', 'updated_at')

  return {
    type: 'object',
    properties,
    required,
  }
}

// ── Helper: parse DML entity schema into OpenApiEntityField[] ────────
// Called by bootstrap to extract field metadata from raw DmlEntity.schema
// (where values are property class instances with a parse() method).

export function parseDmlEntityFields(schema: Record<string, unknown>): OpenApiEntityField[] {
  const fields: OpenApiEntityField[] = []

  for (const [fieldName, value] of Object.entries(schema)) {
    const v = value as Record<string, unknown>
    // Skip relations
    if (v?.__dmlRelation === true) continue
    // Skip values without parse method (not a DML property)
    if (typeof v?.parse !== 'function') continue

    const meta = (v.parse as (name: string) => Record<string, unknown>)(fieldName)
    // Skip computed fields
    if (meta.computed) continue

    const dataType = meta.dataType as { name: string } | undefined

    fields.push({
      name: fieldName,
      type: dataType?.name ?? 'text',
      nullable: (meta.nullable as boolean) || false,
      values: meta.values,
    })
  }

  return fields
}
