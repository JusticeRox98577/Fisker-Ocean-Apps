// Wrangler bundles .md files as text (see [[rules]] in wrangler.toml).
declare module "*.md" {
  const text: string;
  export default text;
}
