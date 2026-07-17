import { defineCommandGraph } from '@mantajs/core'

// Admin has full access to all module commands (CRUD auto-generated from DML entities)
export default defineCommandGraph('*')
