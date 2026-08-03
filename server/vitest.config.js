import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js'],
      exclude: [
        'src/app.js',
        'src/socket.js',
        'src/server.js',
        'src/db/migrate.js',
        'src/db/seed.js',
        'src/db/schema.sql',
        'src/db/migrations/**',
        'src/shared/jobs/queue.js',
      ],
    },
  },
});
