export default {
  plugins: {
    // Tailwind removed in Phase 10 D5 — it was processed but entirely unused,
    // and its Preflight reset conflicted with Bootstrap's base layer.
    autoprefixer: {},
  },
}
