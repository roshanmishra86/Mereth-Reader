/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev-only in-app R1 performance gate switch (task 2.9). */
  readonly VITE_PERF_MEASURE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
