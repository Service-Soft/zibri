import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/**/*.ts'],
    outDir: 'dist',
    target: 'node20',
    format: ['esm', 'cjs'],
    ignoreWatch: 'sandbox',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true
});