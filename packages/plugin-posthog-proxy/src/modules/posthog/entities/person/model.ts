import { defineModel, fromZodSchema } from '@manta/core'
import { postHogPersonSchema } from '../../schemas'

export default defineModel('PostHogPerson', fromZodSchema(postHogPersonSchema)).external()
