# Additional Cloud AI Provider Support

## Overview

The production app is the JS-only PWA (`static/`). It currently supports three AI providers defined in `static/js/ai.js`:

| Key | Name | API format |
|---|---|---|
| `groq` | Groq | OpenAI-compatible, `Authorization: Bearer` |
| `openai` | OpenAI | OpenAI-compatible, `Authorization: Bearer` |
| `ollama` | Ollama (Local) | OpenAI-compatible, no auth |

Add support for two new providers:

| Key | Name | API format |
|---|---|---|
| `gemini` | Google Gemini | OpenAI-compatible endpoint, `Authorization: Bearer` |
| `azure` | Azure OpenAI | OpenAI-compatible body, `api-key` header, custom endpoint URL |

---

## Provider Details

### Google Gemini

Google Gemini exposes an OpenAI-compatible REST endpoint, so no changes to the fetch logic are needed.

- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- **Auth header**: `Authorization: Bearer {apiKey}`
- **Request/response**: identical to OpenAI (`{model, messages, stream}` → `choices[0].message.content`)
- **`requiresKey`**: `true`
- **Models** (in order of preference):
  - `gemini-2.0-flash` *(default)*
  - `gemini-1.5-pro`
  - `gemini-1.5-flash`

### Azure OpenAI

Azure OpenAI uses an OpenAI-compatible request/response body but differs in two ways:
1. The endpoint URL is per-deployment: `https://{resourceName}.openai.azure.com/openai/deployments/{deploymentName}/chat/completions?api-version={apiVersion}`
2. The auth header is `api-key: {apiKey}` (not `Authorization: Bearer`).

The user must supply three extra settings beyond the API key:
- **Resource name** — the Azure resource name (e.g. `my-openai-resource`)
- **Deployment name** — the model deployment name (e.g. `gpt-4o`)
- **API version** — the Azure API version string (default: `2024-12-01-preview`)

Since the "model" in the request body is optional (Azure ignores it in favour of the deployment URL), do not send a `model` field in the request body for Azure.

---

## Scope of Changes

### 1. `static/js/ai.js`

#### 1a. `AI_PROVIDERS` — add two new entries

```js
gemini: {
  name: "Google Gemini",
  endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  requiresKey: true,
  models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  defaultModel: "gemini-2.0-flash",
},
azure: {
  name: "Azure OpenAI",
  endpoint: null,          // computed at runtime from user settings
  requiresKey: true,
  models: [],              // deployment names are user-defined, not enumerable
  defaultModel: "",
},
```

#### 1b. `AI.getSettings()` — extend returned object

Add three new optional fields to the returned settings shape:

```js
{
  provider: null,
  apiKey: "",
  model: "",
  azureResourceName: "",    // new
  azureDeploymentName: "",  // new
  azureApiVersion: "2024-12-01-preview",  // new (with default)
}
```

#### 1c. `AI.saveSettings()` — persist new fields

Persist `azureResourceName`, `azureDeploymentName`, and `azureApiVersion` alongside the existing fields.

#### 1d. `AI.chat()` — Azure-specific fetch logic

Before calling `fetch`, branch on `settings.provider`:

- For **`azure`**: 
  - Build the endpoint URL dynamically:  
    `https://{azureResourceName}.openai.azure.com/openai/deployments/{azureDeploymentName}/chat/completions?api-version={azureApiVersion}`
  - Set header `"api-key": settings.apiKey` instead of `Authorization: Bearer`
  - Omit the `model` field from the request body
- For **all other providers**: use the existing `Authorization: Bearer` logic unchanged.

#### 1e. `AI.testConnection()` — same Azure branching

Apply the same endpoint construction and header logic as in `chat()` to the test connection path.

---

### 2. `static/js/gmail.js`

`gmail.js` maintains its own local copy of `AI_PROVIDERS` (used only for email-parsing calls). Add the same two entries — `gemini` and `azure` — to that local object. The `azure` entry only needs `name`, `endpoint: null`, `requiresKey: true`, and `defaultModel: ""`. The gmail parsing call must also apply the same Azure header/endpoint branching logic wherever it calls `fetch` with an AI provider.

---

### 3. `static/js/app.js` — Settings UI

#### 3a. `renderSettings()` — conditional Azure fields

After the existing Model dropdown, add a conditionally-rendered section for Azure-specific inputs that is only visible when `settings.provider === "azure"`:

```html
<div class="settings-field" id="azure-fields" style="display: none">
  <label for="azure-resource">Azure Resource Name</label>
  <input type="text" id="azure-resource" class="form-control"
         placeholder="e.g. my-openai-resource" />

  <label for="azure-deployment">Deployment Name</label>
  <input type="text" id="azure-deployment" class="form-control"
         placeholder="e.g. gpt-4o" />

  <label for="azure-api-version">API Version</label>
  <input type="text" id="azure-api-version" class="form-control"
         placeholder="2024-12-01-preview" />
</div>
```

Populate these inputs with saved values when rendering.

#### 3b. `onProviderChange()` — show/hide Azure fields

When the user selects `azure`, show `#azure-fields` and clear the model dropdown (Azure deployments are user-defined). For all other providers, hide `#azure-fields` and populate the model dropdown as today.

#### 3c. `saveAISettings()` — save Azure fields

Read the three new inputs and pass them to `AI.saveSettings()`.

---

## Settings Storage Schema

Settings are persisted in `localStorage` under `fincoach-ai-settings`. After this change the stored JSON shape is:

```json
{
  "provider": "azure",
  "apiKey": "...",
  "model": "",
  "azureResourceName": "my-resource",
  "azureDeploymentName": "gpt-4o",
  "azureApiVersion": "2024-12-01-preview"
}
```

The three `azure*` keys are present in every saved settings object (empty strings for non-Azure providers). This keeps `getSettings()` shape consistent.

---

## Tests to Write / Update

### `tests/js/ai.test.js`

- **`AI_PROVIDERS` has five providers**: `groq`, `openai`, `ollama`, `gemini`, `azure`
- **Gemini entry** has `requiresKey: true`, non-empty `models` array, valid HTTPS endpoint
- **Azure entry** has `requiresKey: true`, `endpoint: null`, empty `models` array
- **`getSettings()`** returns `azureResourceName: ""`, `azureDeploymentName: ""`, `azureApiVersion: "2024-12-01-preview"` as defaults
- **`saveSettings()` / `getSettings()` round-trip** preserves Azure fields
- **`chat()` with Azure provider** calls `fetch` with `api-key` header (not `Authorization`) and the correct dynamically-built endpoint URL
- **`testConnection()` with Azure provider** uses the same header/endpoint logic

### `tests/js/ai-integration.test.js`

- **`AI_PROVIDERS` structure validation** (section 9): update assertion to expect five providers; add gemini endpoint must contain `generativelanguage.googleapis.com`; add azure `endpoint` must be `null`

### `tests/e2e/test_settings_ui.py`

- **Provider dropdown contains Gemini and Azure** options
- **Selecting Azure** shows the `#azure-fields` section and hides it for non-Azure providers
- **Save + reload with Azure settings** preserves `azureResourceName`, `azureDeploymentName`, `azureApiVersion`

---

## Acceptance Criteria

1. `AI_PROVIDERS` in `ai.js` contains exactly five keys: `groq`, `openai`, `ollama`, `gemini`, `azure`.
2. Selecting Gemini in Settings shows the API key field and a populated model dropdown; no extra fields.
3. Selecting Azure in Settings shows the API key field, an empty/user-editable model field, and the three Azure-specific input fields.
4. Saving Azure settings and reloading the page restores all five fields correctly.
5. `AI.chat()` and `AI.testConnection()` call the correct endpoint and set the correct auth header for every provider.
6. `gmail.js` local `AI_PROVIDERS` includes `gemini` and `azure`.
7. All existing JS unit tests continue to pass (`make test-js`).
8. All new tests pass.
9. `make lint-js` passes with zero errors.
10. The E2E Settings tests pass with the new provider options visible.
 