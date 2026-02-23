# AI Taxa Extraction

Portfolio can use a local LLM via [Ollama](https://ollama.ai) to discover entities in your notes — people, concepts, places, organizations, works, and events — and suggest them as new taxa links.

## Setup

1. **Install Ollama** from [ollama.ai](https://ollama.ai)
2. **Pull a model**: `ollama pull llama3.2:3b` (or any chat model you prefer)
3. **Start Ollama** — it runs as a local server on port 11434 by default
4. **Configure in Portfolio settings:**
   - Ollama URL (default: `http://localhost:11434`)
   - Model name (default: `llama3.2:3b`)
   - Click "Test connection" to verify everything works

### Model recommendations

Any Ollama chat model works. Smaller models (1-4B parameters) are faster but less accurate. Larger models find more entities with higher confidence but take longer.

Tested models:
- `llama3.2:3b` — good balance of speed and accuracy
- `gemma3:4b` — fast, solid results

## How it works

When you click the **↻** refresh button in the suggestions sidebar (or when auto-analyze is enabled), Portfolio:

1. Sends the note text (or selected text) to Ollama
2. Asks the model to extract entities as structured JSON
3. Filters results — removes entities with missing fields, low confidence, or text that doesn't appear verbatim in the note
4. Displays suggestions in the AI Taxa Extraction section of the sidebar

Each suggestion shows:
- **Entity name** — what the model found
- **Type** — person, concept, place, organization, work, or event
- **Confidence** — the model's confidence score (suggestions below 0.7 are marked "low confidence")

### Entity types

The model extracts six entity types, each mapped to a taxa prefix:

| Entity type  | Taxa prefix |
|-------------|-------------|
| person       | `@`         |
| concept      | `+`         |
| place        | `~`         |
| organization | `º`         |
| work         | `©`         |
| event        | `∞`         |

## Actions

For each AI suggestion, you can:

- **Link** — creates the taxa file and links the first mention in your note
- **✕ Dismiss** — hides this suggestion for the current session
- **Ignore** — permanently blocklists the term

## Auto-analyze

When "Auto-analyze on file open" is enabled in settings, Portfolio automatically runs AI extraction whenever you switch to a new file. Results are cached per file until you manually refresh.

When disabled, you control when extraction runs by clicking the ↻ button.

## When Ollama isn't available

If Ollama isn't running or the model isn't installed, the sidebar shows a helpful message with:
- The configured model name
- A link to Settings for connection details
- A "Retry" button to check again

If AI extraction is turned off entirely (Settings → Portfolio → Enable AI taxa extraction), the section explains what the feature does and where to enable it.

## Privacy

All AI processing happens locally on your machine through Ollama. No text is sent to external servers. Portfolio communicates only with the Ollama instance running at the URL you configure (localhost by default).

## Troubleshooting

**"Ollama not available"** — Make sure Ollama is running. Check with `ollama list` in your terminal.

**"Model not found"** — The configured model isn't installed. Run `ollama pull <model-name>`.

**Slow extraction** — Try a smaller model. Extraction has a 60-second timeout.

**No entities found** — The model didn't find anything matching the six entity types, or everything it found already has a taxa file. Try a different model or check that your note contains identifiable entities.

**Duplicate suggestions** — This is a [known issue](https://github.com/blakeeboyd/obsidian-portfolio/issues). The model sometimes returns the same entity more than once with slightly different confidence scores.
