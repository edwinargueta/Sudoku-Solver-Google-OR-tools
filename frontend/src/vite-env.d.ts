/** The VITE_-prefixed keys this app reads. See .env.example for the rest. */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_API_DOCS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
