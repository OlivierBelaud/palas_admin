# Agents — defineAgent()

## What is an agent

An agent is a **typed AI call** that you can use as a step in your workflows. It has a contract: typed input (Zod), typed output (Zod), and instructions. The LLM is forced to return the output schema via `generateObject()`.

In a workflow, the agent result is **checkpointed** — if the workflow crashes after the agent step, the result is recovered from checkpoint (no re-call to the LLM).

## defineAgent()

```typescript
// src/agents/categorize-product.ts
export default defineAgent({
  name: 'categorize-product',
  description: 'Categorize a product into a department',
  input: z.object({
    title: z.string(),
    description: z.string().optional(),
  }),
  output: z.object({
    category: z.enum(['electronics', 'clothing', 'food', 'home', 'other']),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
  instructions: (input) =>
    `Categorize this product: "${input.title}". Description: "${input.description ?? 'none'}".`,
  system: 'You are a product categorization expert.',
  temperature: 0,
})
```

**Required fields:**
- `name` — Unique agent identifier (kebab-case)
- `description` — What this agent does
- `input` — Zod schema for the input (validated before the LLM call)
- `output` — Zod schema for the output (the LLM is forced to return this shape)
- `instructions` — Function that receives `input` directly and returns the prompt string

**Optional:**
- `system` — System prompt
- `temperature` — 0 = deterministic (default), 1 = creative
- `maxTokens` — Max response tokens
- `model` — Override model (e.g., `'gpt-4o'`, `'claude-sonnet-4-20250514'`)

## Usage in commands

```typescript
// src/commands/import-product.ts
export default defineCommand({
  name: 'import-product',
  description: 'Import and auto-categorize a product',
  input: z.object({
    title: z.string(),
    description: z.string().optional(),
    price: z.number(),
  }),
  workflow: async (input, { step }) => {
    // Create the product
    const product = await step.service.catalog.create({
      title: input.title,
      description: input.description,
      price: input.price,
      status: 'draft',
    })

    // AI categorization — typed input/output, checkpointed
    const { category, confidence } = await step.agent.categorizeProduct({
      title: input.title,
      description: input.description,
    })

    // Use the AI result
    if (confidence > 0.8) {
      await step.service.catalog.update(product.id, { category })
    }

    return { product, category, confidence }
  },
})
```

`step.agent.categorizeProduct()` is:
- **Typed** — input and output are known by autocomplete (from the Zod schemas)
- **Checkpointed** — if the workflow crashes after this step, the LLM result is recovered
- **Validated** — input is Zod-checked before calling the LLM, output is forced by `generateObject()`
- **No compensation** — LLM calls are read-only, nothing to undo

## AI provider configuration

Set the provider via environment variable:

| Variable | Provider | Default model |
|----------|----------|--------------|
| `ANTHROPIC_API_KEY` | Anthropic | claude-sonnet-4-20250514 |
| `OPENAI_API_KEY` | OpenAI | gpt-4o |
| `GOOGLE_AI_API_KEY` | Google | gemini-2.0-flash |
| `MISTRAL_API_KEY` | Mistral | mistral-large-latest |

Set `MANTA_AI_PROVIDER` to choose which provider (default: `anthropic`).

## File location

```
src/agents/{name}.ts
```

Each file exports a single `defineAgent()` as the default export. Auto-discovered at boot.

## How it works under the hood

1. `step.agent.categorizeProduct(input)` resolves the agent definition from the registry
2. Input is validated against the agent's Zod `input` schema
3. `instructions(input)` generates the prompt string
4. `generateObject()` from Vercel AI SDK calls the LLM with the `output` Zod schema
5. The LLM is forced to return valid JSON matching the schema
6. Result is checkpointed via `runStep()` (same as all other steps)
7. On workflow retry, the checkpoint is returned directly (no LLM re-call)

## Validation errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Agent name is required` | Missing name | Add `name: 'my-agent'` |
| `Agent "X" requires an output Zod schema` | Missing output | Add `output: z.object({...})` |
| `Agent "X" instructions must be a function` | String instead of function | Change to `instructions: (input) => '...'` |
| `Agent "X" not found` | Typo or missing file | Create `src/agents/X.ts` with `defineAgent()` |
| `step.agent requires ANTHROPIC_API_KEY` | No API key set | Set the environment variable |

## The primitives (updated)

```
defineModel        → Entity
defineService      → Mutations (auto-compensated)
defineCommand      → Workflow
defineQuery        → Read endpoint (CQRS read side)
defineQueryGraph   → Graph endpoint (flexible reads)
defineSubscriber   → Event reaction
defineJob          → Cron
defineLink         → Relation
defineUser         → Auth + CRUD + middleware (auto-generated)
defineAgent        → AI
```
