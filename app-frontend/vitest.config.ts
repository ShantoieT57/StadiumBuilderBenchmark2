import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // The integration suites render whole screens (Radix, react-hook-form, the
    // events/toast providers) in jsdom. With one worker per CPU core they starve
    // each other and individual tests blow the 5 s default under load. Cap the
    // workers and give each test a realistic budget so the full suite is stable.
    maxWorkers: '50%',
    testTimeout: 20_000,
    include: [
      'src/**/__tests__/**/*.[jt]s?(x)',
      'src/**/?(*.)+(test).[jt]s?(x)',
    ],
    // `__tests__/helpers/` holds shared mock-data factories imported BY tests, not
    // test suites themselves — excluding them keeps Vitest from failing on the
    // "No test suite found" error for a helper-only module.
    exclude: [
      'node_modules/',
      '**/*.spec.[jt]s',
      'src/**/__tests__/helpers/**',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.stories.{js,jsx,ts,tsx}',
        'src/**/__tests__/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
