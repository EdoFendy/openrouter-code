import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ConfigPaths } from "../config.js";
import { OrCodeError } from "../types.js";

const PricingSchema = z
  .object({
    prompt: z.string().default("0"),
    completion: z.string().default("0"),
    request: z.string().default("0"),
    image: z.string().default("0"),
    web_search: z.string().default("0"),
    internal_reasoning: z.string().default("0"),
    input_cache_read: z.string().default("0"),
    input_cache_write: z.string().default("0")
  })
  .catchall(z.string().or(z.null()).optional());

const ArchitectureSchema = z.object({
  input_modalities: z.array(z.string()).default(["text"]),
  output_modalities: z.array(z.string()).default(["text"]),
  tokenizer: z.string().nullable().optional(),
  instruct_type: z.string().nullable().optional()
});

const TopProviderSchema = z
  .object({
    context_length: z.number().int().nonnegative().nullable().optional(),
    max_completion_tokens: z.number().int().nonnegative().nullable().optional(),
    is_moderated: z.boolean().nullable().optional()
  })
  .catchall(z.unknown());

export const OpenRouterModelSchema = z
  .object({
    id: z.string(),
    canonical_slug: z.string().optional(),
    name: z.string(),
    created: z.number().optional(),
    description: z.string().optional(),
    context_length: z.number().int().nonnegative().default(0),
    architecture: ArchitectureSchema.default({
      input_modalities: ["text"],
      output_modalities: ["text"]
    }),
    pricing: PricingSchema.default({
      prompt: "0",
      completion: "0",
      request: "0",
      image: "0",
      web_search: "0",
      internal_reasoning: "0",
      input_cache_read: "0",
      input_cache_write: "0"
    }),
    top_provider: TopProviderSchema.nullable().optional(),
    per_request_limits: z.unknown().nullable().optional(),
    supported_parameters: z.array(z.string()).default([]),
    default_parameters: z.record(z.string(), z.unknown()).nullable().optional(),
    expiration_date: z.string().nullable().optional()
  })
  .catchall(z.unknown());

const ModelsResponseSchema = z.object({
  data: z.array(OpenRouterModelSchema)
});

export type OpenRouterModel = z.infer<typeof OpenRouterModelSchema>;

export type ModelCapability = {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  maxCompletionTokens?: number;
  inputModalities: string[];
  outputModalities: string[];
  supportsTools: boolean;
  supportsToolChoice: boolean;
  supportsReasoning: boolean;
  supportsIncludeReasoning: boolean;
  supportsStructuredOutputs: boolean;
  supportsResponseFormat: boolean;
  supportsInputImage: boolean;
  supportsInputFile: boolean;
  supportsInputAudio: boolean;
  supportsOutputImage: boolean;
  supportsOutputAudio: boolean;
  promptPrice: number;
  completionPrice: number;
  requestPrice: number;
  imagePrice: number;
  reasoningPrice: number;
  raw: OpenRouterModel;
};

export type ModelFilter =
  | "tools"
  | "tool-choice"
  | "reasoning"
  | "structured"
  | "response-format"
  | "image-input"
  | "file-input"
  | "audio-input"
  | "image-output"
  | "audio-output"
  | "cheap";

type CachedModels = {
  fetchedAt: string;
  data: OpenRouterModel[];
};

const CACHE_FILE = "models.json";
const MODELS_URL = "https://openrouter.ai/api/v1/models?output_modalities=all";

function priceToNumber(value: unknown): number {
  if (typeof value !== "string") {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toCapability(model: OpenRouterModel): ModelCapability {
  const supported = new Set(model.supported_parameters);
  const inputModalities = model.architecture.input_modalities;
  const outputModalities = model.architecture.output_modalities;
  const maxCompletionTokens = model.top_provider?.max_completion_tokens ?? undefined;

  return {
    id: model.id,
    name: model.name,
    description: model.description ?? "",
    contextLength: model.context_length,
    ...(maxCompletionTokens === undefined ? {} : { maxCompletionTokens }),
    inputModalities,
    outputModalities,
    supportsTools: supported.has("tools"),
    supportsToolChoice: supported.has("tool_choice"),
    supportsReasoning: supported.has("reasoning"),
    supportsIncludeReasoning: supported.has("include_reasoning"),
    supportsStructuredOutputs: supported.has("structured_outputs"),
    supportsResponseFormat: supported.has("response_format"),
    supportsInputImage: inputModalities.includes("image"),
    supportsInputFile: inputModalities.includes("file"),
    supportsInputAudio: inputModalities.includes("audio"),
    supportsOutputImage: outputModalities.includes("image"),
    supportsOutputAudio: outputModalities.includes("audio"),
    promptPrice: priceToNumber(model.pricing.prompt),
    completionPrice: priceToNumber(model.pricing.completion),
    requestPrice: priceToNumber(model.pricing.request),
    imagePrice: priceToNumber(model.pricing.image),
    reasoningPrice: priceToNumber(model.pricing.internal_reasoning),
    raw: model
  };
}

export class ModelRegistry {
  private readonly cachePath: string;

  constructor(
    private readonly paths: Pick<ConfigPaths, "cacheDir">,
    private readonly ttlMs: number
  ) {
    this.cachePath = path.join(this.paths.cacheDir, CACHE_FILE);
  }

  async list(options: { forceRefresh?: boolean; apiKey?: string } = {}): Promise<ModelCapability[]> {
    const models = await this.loadModels(options);
    return models.map(toCapability).sort((left, right) => left.id.localeCompare(right.id));
  }

  async findById(id: string, options: { apiKey?: string } = {}): Promise<ModelCapability | undefined> {
    return (await this.list(options)).find((model) => model.id === id);
  }

  search(models: ModelCapability[], keywords: string[]): ModelCapability[] {
    if (keywords.length === 0) {
      return models;
    }

    const lcKeywords = keywords.map((keyword) => keyword.toLowerCase());
    return models.filter((model) => {
      const haystack = `${model.id} ${model.name} ${model.description}`.toLowerCase();
      return lcKeywords.every((keyword) => haystack.includes(keyword));
    });
  }

  filter(models: ModelCapability[], filters: ModelFilter[]): ModelCapability[] {
    return models.filter((model) =>
      filters.every((filter) => {
        switch (filter) {
          case "tools":
            return model.supportsTools;
          case "tool-choice":
            return model.supportsToolChoice;
          case "reasoning":
            return model.supportsReasoning || model.supportsIncludeReasoning;
          case "structured":
            return model.supportsStructuredOutputs;
          case "response-format":
            return model.supportsResponseFormat;
          case "image-input":
            return model.supportsInputImage;
          case "file-input":
            return model.supportsInputFile;
          case "audio-input":
            return model.supportsInputAudio;
          case "image-output":
            return model.supportsOutputImage;
          case "audio-output":
            return model.supportsOutputAudio;
          case "cheap":
            return model.promptPrice <= 0.000001 && model.completionPrice <= 0.000003;
        }
      })
    );
  }

  private async loadModels(options: { forceRefresh?: boolean; apiKey?: string }): Promise<OpenRouterModel[]> {
    if (!options.forceRefresh) {
      const cached = await this.readCache();
      if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < this.ttlMs) {
        return cached.data;
      }
    }

    const fresh = await this.fetchModels(options.apiKey);
    await this.writeCache(fresh);
    return fresh;
  }

  private async readCache(): Promise<CachedModels | undefined> {
    if (!existsSync(this.cachePath)) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(await readFile(this.cachePath, "utf8")) as unknown;
      const result = z
        .object({
          fetchedAt: z.string(),
          data: z.array(OpenRouterModelSchema)
        })
        .safeParse(parsed);
      return result.success ? result.data : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeCache(models: OpenRouterModel[]): Promise<void> {
    await mkdir(this.paths.cacheDir, { recursive: true });
    const payload: CachedModels = {
      fetchedAt: new Date().toISOString(),
      data: models
    };
    await writeFile(this.cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  private async fetchModels(apiKey?: string): Promise<OpenRouterModel[]> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(MODELS_URL, { headers });
    } catch (error) {
      throw new OrCodeError("models.fetch_failed", "Impossibile contattare OpenRouter Models API.", {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    if (!response.ok) {
      throw new OrCodeError("models.http_error", `OpenRouter Models API ha risposto ${response.status}.`, {
        status: response.status,
        body: await response.text()
      });
    }

    const parsed = ModelsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new OrCodeError("models.invalid_schema", "Schema modelli OpenRouter inatteso.", {
        issues: parsed.error.issues.map((issue) => issue.message)
      });
    }

    return parsed.data.data;
  }
}

export function renderModelTable(models: ModelCapability[], limit = 30): string {
  const rows = models.slice(0, limit).map((model) => {
    const flags = [
      model.supportsTools ? "tools" : "",
      model.supportsReasoning || model.supportsIncludeReasoning ? "reason" : "",
      model.supportsStructuredOutputs ? "json-schema" : "",
      model.supportsInputImage ? "img-in" : "",
      model.supportsOutputImage ? "img-out" : ""
    ]
      .filter(Boolean)
      .join(",");

    const promptPerMTok = (model.promptPrice * 1_000_000).toFixed(3);
    const completionPerMTok = (model.completionPrice * 1_000_000).toFixed(3);
    return `${model.id.padEnd(42)} ${String(model.contextLength).padStart(7)} ctx  $${promptPerMTok}/$${completionPerMTok} per MTok  ${flags}`;
  });

  const suffix = models.length > limit ? `\n... ${models.length - limit} altri modelli. Usa filtri più specifici.` : "";
  return [`models: ${models.length}`, ...rows].join("\n") + suffix;
}
