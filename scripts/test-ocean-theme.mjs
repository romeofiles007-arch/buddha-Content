// Compatibility entry point: the ocean world has been replaced by the approved temple theme.
process.argv.push('--assets')
await import('./test-temple-theme.mjs')
