import { defineCommandGraph } from '@manta/core'

// Admin has full access to all module commands (CRUD auto-generated from DML entities)
export default defineCommandGraph('*')
