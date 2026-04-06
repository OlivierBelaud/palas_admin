import { defineQueryGraph } from '@manta/core'

// Admin has full access to the query graph
export default defineQueryGraph('*')
