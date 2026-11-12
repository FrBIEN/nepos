import { defineConfig } from 'vite';

export default defineConfig({
    build: { assetsInlineLimit: () => true, cssCodeSplit: false, modulePreload: false, rollupOptions: { output: { inlineDynamicImports: true } } },
    // Use relative paths for assets (allows deployment in subdirectories)
    base: './',
    server: {
        host: true,
        watch: { ignored: ['**/docs/**', '**/README.md', '**/scripts/**'] },
    },
    preview: {
        host: true,
    },
});
