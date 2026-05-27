/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base de la API, p. ej. http://localhost:8000/api (sin barra final) */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
