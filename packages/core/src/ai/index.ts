// defineAgent() — AI agent definitions for workflow steps.
//
// An agent is a typed AI call: input → LLM → output.
// Input and output are Zod-validated. The LLM call is checkpointed in workflows.
//
// Usage:
//   // src/agents/categorize-product.ts
//   export default defineAgent({
//     name: 'categorize-product',
//     description: 'Categorize a product into a department',
//     input: z.object({ title: z.string() }),
//     output: z.object({ category: z.enum(['electronics', 'clothing']) }),
//     instructions: (input) => `Categorize: "${input.title}"`,
//   })
//
//   // In a command workflow:
//   const { category } = await step.agent.categorizeProduct({ title: 'iPhone' })

import type { z } from 'zod'
import { MantaError } from '../errors/manta-error'

/**
 * Agent definition — a typed AI call with Zod input/output.
 */
export interface AgentDefinition<TInput = unknown, TOutput = unknown> {
  __type: 'agent'
  /** Unique agent name (kebab-case) */
  name: string
  /** What this agent does (for docs and AI tool discovery) */
  description: string
  /** Zod schema for the input — validated before the LLM call */
  input: z.ZodType<TInput>
  /** Zod schema for the output — the LLM is forced to return this shape */
  output: z.ZodType<TOutput>
  /** Prompt template — receives the validated input, returns the prompt string */
  instructions: (input: TInput) => string
  /** System prompt (optional) */
  system?: string
  /** Temperature (0 = deterministic, 1 = creative). Default: 0 */
  temperature?: number
  /** Max tokens for the response */
  maxTokens?: number
  /** Model override (e.g., 'gpt-4o', 'claude-sonnet-4-20250514'). Default: provider default */
  model?: string
}

/**
 * Define an AI agent — a typed, checkpointable LLM call for workflows.
 *
 * The agent has a Zod contract: input is validated, output is forced via generateObject().
 * In a workflow, the result is checkpointed — if the workflow crashes after the agent step,
 * the result is recovered from checkpoint (no re-call to the LLM).
 *
 * @example
 * export default defineAgent({
 *   name: 'categorize-product',
 *   description: 'Categorize a product into a department',
 *   input: z.object({ title: z.string() }),
 *   output: z.object({ category: z.enum(['electronics', 'clothing', 'food', 'other']) }),
 *   instructions: (input) => `Categorize this product: "${input.title}"`,
 * })
 */
export function defineAgent<TInputSchema extends z.ZodType, TOutputSchema extends z.ZodType>(config: {
  name: string
  description: string
  input: TInputSchema
  output: TOutputSchema
  instructions: (input: NoInfer<z.infer<TInputSchema>>) => string
  system?: string
  temperature?: number
  maxTokens?: number
  model?: string
}): AgentDefinition<z.infer<TInputSchema>, z.infer<TOutputSchema>> {
  if (!config.name)
    throw new MantaError(
      'INVALID_DATA',
      'Agent name is required. Usage: defineAgent({ name: "categorize-product", ... })',
    )
  if (!config.description) throw new MantaError('INVALID_DATA', `Agent "${config.name}" requires a description`)
  if (!config.input) throw new MantaError('INVALID_DATA', `Agent "${config.name}" requires an input Zod schema`)
  if (!config.output) throw new MantaError('INVALID_DATA', `Agent "${config.name}" requires an output Zod schema`)
  if (typeof config.instructions !== 'function')
    throw new MantaError('INVALID_DATA', `Agent "${config.name}" instructions must be a function: (input) => string`)
  return { ...config, __type: 'agent' as const }
}
