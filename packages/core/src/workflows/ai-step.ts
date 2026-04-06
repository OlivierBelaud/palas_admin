// AI step implementation — isolated to avoid requiring ai SDK at compile time.
// This file is loaded dynamically via require() only when step.agent is called.

import { MantaError } from '../errors/manta-error'

// biome-ignore lint/suspicious/noExplicitAny: AI SDK model type varies
async function resolveAiModel(modelName?: string): Promise<any> {
  const provider = process.env.MANTA_AI_PROVIDER ?? 'anthropic'

  switch (provider) {
    case 'anthropic': {
      const key = process.env.ANTHROPIC_API_KEY
      if (!key) throw new MantaError('INVALID_DATA', 'step.agent requires ANTHROPIC_API_KEY environment variable')
      // @ts-expect-error — optional dependency loaded dynamically
      const mod = await import(/* @vite-ignore */ '@ai-sdk/anthropic')
      return mod.createAnthropic({ apiKey: key })(modelName ?? 'claude-sonnet-4-20250514')
    }
    case 'openai': {
      const key = process.env.OPENAI_API_KEY
      if (!key) throw new MantaError('INVALID_DATA', 'step.agent requires OPENAI_API_KEY environment variable')
      // @ts-expect-error — optional dependency loaded dynamically
      const mod = await import(/* @vite-ignore */ '@ai-sdk/openai')
      return mod.createOpenAI({ apiKey: key })(modelName ?? 'gpt-4o')
    }
    case 'google': {
      const key = process.env.GOOGLE_AI_API_KEY
      if (!key) throw new MantaError('INVALID_DATA', 'step.agent requires GOOGLE_AI_API_KEY environment variable')
      // @ts-expect-error — optional dependency loaded dynamically
      const mod = await import(/* @vite-ignore */ '@ai-sdk/google')
      return mod.createGoogleGenerativeAI({ apiKey: key })(modelName ?? 'gemini-2.0-flash')
    }
    case 'mistral': {
      const key = process.env.MISTRAL_API_KEY
      if (!key) throw new MantaError('INVALID_DATA', 'step.agent requires MISTRAL_API_KEY environment variable')
      // @ts-expect-error — optional dependency loaded dynamically
      const mod = await import(/* @vite-ignore */ '@ai-sdk/mistral')
      return mod.createMistral({ apiKey: key })(modelName ?? 'mistral-large-latest')
    }
    default:
      throw new MantaError(
        'INVALID_DATA',
        `Unknown AI provider "${provider}". Set MANTA_AI_PROVIDER to anthropic, openai, google, or mistral.`,
      )
  }
}

// biome-ignore lint/suspicious/noExplicitAny: AgentDefinition generic
export async function executeAgent(agentDef: any, parsedInput: unknown, promptText: string): Promise<unknown> {
  // @ts-expect-error — optional dependency loaded dynamically
  const mod = await import(/* @vite-ignore */ 'ai')
  const model = await resolveAiModel(agentDef.model)

  const result = await mod.generateObject({
    model,
    prompt: promptText,
    schema: agentDef.output,
    temperature: agentDef.temperature ?? 0,
    maxTokens: agentDef.maxTokens,
    system: agentDef.system,
  })
  return result.object
}
