// Wrangler bundles .md files as text (see [[rules]] in wrangler.toml).
declare module "*.md" {
  const text: string;
  export default text;
}

// The admin page's files, bundled as text (see [[rules]] in wrangler.toml).
declare module "*?raw" {
  const text: string;
  export default text;
}
