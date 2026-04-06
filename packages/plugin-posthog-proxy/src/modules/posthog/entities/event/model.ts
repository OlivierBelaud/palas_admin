import { defineModel, fromZodSchema } from '@manta/core'
import { postHogEventSchema } from '../../schemas'

export default defineModel('PostHogEvent', fromZodSchema(postHogEventSchema)).external()
