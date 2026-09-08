# ComfyUI Batch Studio

ComfyUI Batch Studio is an Electron desktop application for managing a deterministic ComfyUI batch-generation project lifecycle around user-operated Grok Web.

## v1 status

The v1 implementation is complete for the currently accepted scope: project setup, story planning, integrated Civitai model catalog management, Grok-assisted model selection, Prompt Plan review/editing, deterministic workflow compilation, integrated Cloudflare R2 file management, model availability checks, and Preflight readiness.

The repository CI validates dependency installation, TypeScript type checking, the v1 regression suite, and the production build.

The following remain intentionally outside v1 and require separate future requirements/decisions before implementation:

- ComfyUI Queue / progress / cancel / output collection runtime integration.

## Development

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm start
```

Regression tests:

```bash
npm test
```

## Civitai model catalog

The former `civit-model-viewer` functionality is integrated directly into Batch Studio as the **モデルカタログ** stage.

Set the Civitai API key before starting the app:

```powershell
$env:CIVIT_API_KEY = "your-api-key"
npm run dev
```

The API key is kept in the Electron Main Process and is sent only to the configured Civitai endpoints. It is not persisted in project files and is not exposed to Grok Web.

The integrated catalog supports:

- Public / Private Civitai Model Collection synchronization.
- Persistent `model_catalog.json` with `generation` and change counts.
- Cross-collection model / file-name search.
- Model, Version, File, thumbnail and trained-word inspection.
- Observed-use LoRA `strengthBaseline` using `median-of-post-medians:newest-200` when at least five distinct posts provide evidence.
- Named selection templates for Collection / Model / Version selections.
- Selected-manifest JSON copy.

The catalog is stored in the application data directory and new projects use it by default. Existing projects with an explicit external `catalogPath` remain compatible and can opt into the integrated catalog from the モデルカタログ stage.

## Cloudflare R2 file management

The former `r2-file-manager` functionality is integrated directly into Batch Studio under the **モデル配置** stage. New Batch Studio workflows do not require a separate local Flask server or browser-based R2 File Manager.

R2 credentials can be entered from the in-app connection settings or supplied through environment variables:

```powershell
$env:R2_ACCOUNT_ID = "your-account-id"
$env:R2_ACCESS_KEY = "your-access-key-id"
$env:R2_SECRET_ACCESS_KEY = "your-secret-access-key"
# Optional
$env:R2_PUBLIC_URL = "https://example.com"
$env:CLOUDFLARE_API_TOKEN = "your-cloudflare-api-token"
npm run dev
```

Secrets are handled only by the Electron Main Process. Persisted secrets are encrypted with Electron `safeStorage`; they are not written to project artifacts or exposed to Grok Web.

The integrated R2 manager supports:

- Connection test and persistent encrypted credentials.
- Bucket list/create/delete for empty buckets.
- Folder-style object browsing, paging and bucket-wide search.
- Large-file multipart upload from the Main Process without loading the whole file into Renderer memory.
- Upload pause, resume, cancel, persisted progress state, and resume after application restart.
- Object move/rename and multi-object delete.
- Public URL or time-limited presigned download URL generation.
- URL / `curl` / `wget` / `aria2c` command generation.
- Batch download selection independent from the main delete-selection state, up to 500 objects.
- Cross-folder batch selection, bucket-wide search and named batch-download templates.
- Optional account storage metrics when a Cloudflare API Token is configured.
- Direct R2 lookup from Model Availability and Preflight using the project's configured R2 bucket/prefix.

Existing projects that use `r2IndexPath` remain compatible as a legacy fallback when integrated R2 lookup is not configured.

## Core principles

- Grok decides semantic/creative content; Batch Studio validates, stores, and deterministically compiles it.
- Grok Web remains user-operated. Batch Studio does not automate login, DOM scraping, send, attachment upload, or response retrieval.
- Confirmed artifacts are never silently overwritten; edits begin from explicit drafts and previous confirmed versions are preserved in history.
- Workflow generation is template/manifest-driven and does not ask Grok to generate ComfyUI Workflow JSON.
- Civitai catalog synchronization is owned by Batch Studio; Grok receives the resulting catalog as a file and never receives the Civitai API key.
- Cloudflare R2 credentials are owned by the Batch Studio Main Process and are never exposed to Grok Web.
- v1 ends at Preflight (`READY` / `BLOCKED`) and does not queue ComfyUI jobs.

See `docs/README.md` for the specification set.
