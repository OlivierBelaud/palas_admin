import { defineModel, fromZodSchema } from '@manta/core'
import { postHogInsightSchema } from '../../schemas'

export default defineModel('PostHogInsight', fromZodSchema(postHogInsightSchema)).external()
