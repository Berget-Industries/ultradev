import path from 'node:path'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  earlyAccess: true,
  schema: path.join('prisma', 'schema'),
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://ultradev:ultradev@localhost:5432/ultradev',
  },
})
