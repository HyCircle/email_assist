interface ImportMetaEnv {
  readonly VITE_DEFAULT_LLM_ENDPOINT?: string;
  readonly VITE_DEFAULT_LLM_MODEL?: string;
  readonly VITE_DEFAULT_LLM_TEMPERATURE?: string;
  readonly VITE_DEFAULT_STYLE_NOTES?: string;
  readonly VITE_DEFAULT_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}