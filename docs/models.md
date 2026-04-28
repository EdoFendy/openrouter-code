# Models

`or-code` fetches the full OpenRouter model catalogue live and derives capabilities from the metadata. No hardcoded lists.

## Browsing models

```bash
# All models with tool support AND reasoning
or-code models --tools --reasoning

# Cheap models supporting structured outputs
or-code models --structured --cheap

# Models that can receive images
or-code models --image-input
```

Inside the TUI:

```
/models --tools --reasoning --structured
```

## Capability flags

| Flag | What it means |
|------|---------------|
| `--tools` | `supported_parameters` includes `"tools"` |
| `--reasoning` | `supported_parameters` includes `"reasoning"` |
| `--structured` | `supported_parameters` includes `"structured_outputs"` |
| `--response-format` | `supported_parameters` includes `"response_format"` |
| `--image-input` | `architecture.input_modalities` includes `"image"` |
| `--file-input` | `architecture.input_modalities` includes `"file"` |
| `--audio-input` | `architecture.input_modalities` includes `"audio"` |
| `--image-output` | `architecture.output_modalities` includes `"image"` |
| `--audio-output` | `architecture.output_modalities` includes `"audio"` |
| `--cheap` | prompt token price below threshold |

## Understanding `/why`

```bash
or-code why anthropic/claude-opus-4
```

Outputs the capability booleans derived from that model's metadata. Useful for debugging why a model doesn't appear under a filter.

## Switching models

```bash
# CLI — saves to project config
or-code model openai/gpt-5-nano

# In-session — no restart needed
/model openai/gpt-5-nano
```

The model change is saved to `.orcode/config.json` and emitted as a `model.changed` event in the session JSONL.

## Model cache

Model metadata is cached in `~/.orcode/cache/models.json` for 1 hour (`modelCacheTtlMs`). You can force a refresh:

```
/models
```

This always re-fetches from `GET https://openrouter.ai/api/v1/models?output_modalities=all`.

## Cost tracking

Every call to OpenRouter returns usage data. `or-code` accumulates it per session and displays:

- Running total in the header (`$0.034`)
- Per-session breakdown with `/cost`
- Budget cap: set `maxCostUsd` in config to stop the agent when the limit is hit

```json
{
  "maxCostUsd": 0.50
}
```

## Config keys

```json
{
  "defaultModel": "anthropic/claude-sonnet-4.6",
  "modelCacheTtlMs": 3600000,
  "maxSteps": 25,
  "maxCostUsd": 1.00
}
```
