import { ExtractedEntity } from "../types";

const SYSTEM_PROMPT = `You are an entity extraction assistant for a knowledge management system.
Extract named entities from the user-provided text below. Only extract entities that literally appear in that text. Never invent entities or use examples from these instructions.

Entity types: person, concept, place, organization, work, event.

Rules:
- The "text" field must be a verbatim substring of the user text.
- The "suggestedName" field is the canonical full form of the entity.
- Do not extract common nouns, generic phrases, or pronouns.
- Only extract entities you are confident about. Set confidence between 0 and 1.
- If the text contains no named entities, return an empty array.`;

const RESPONSE_SCHEMA = {
  type: "object" as const,
  properties: {
    entities: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          text: { type: "string" as const },
          type: {
            type: "string" as const,
            enum: [
              "person",
              "concept",
              "place",
              "organization",
              "work",
              "event",
            ],
          },
          suggestedName: { type: "string" as const },
          confidence: { type: "number" as const },
        },
        required: ["text", "type", "suggestedName", "confidence"],
      },
    },
  },
  required: ["entities"],
};

export class OllamaService {
  constructor(
    private url: string,
    private model: string
  ) {}

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.url}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async extractEntities(text: string): Promise<ExtractedEntity[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${this.url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Extract entities from this text:\n\n---\n${text}\n---`,
            },
          ],
          stream: false,
          format: RESPONSE_SCHEMA,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `Model '${this.model}' not found. Run \`ollama pull ${this.model}\` first.`
          );
        }
        throw new Error(`Ollama returned HTTP ${response.status}`);
      }

      const data = await response.json();
      const content = data.message?.content;
      if (!content) {
        throw new Error("Empty response from Ollama");
      }

      const parsed = JSON.parse(content);
      const entities: ExtractedEntity[] = (parsed.entities || []).filter(
        (e: ExtractedEntity) =>
          e.text && e.type && e.suggestedName && typeof e.confidence === "number" && text.includes(e.text)
      );

      // Sort by confidence descending
      entities.sort((a, b) => b.confidence - a.confidence);
      return entities;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(
          "Request timed out. The text might be too long for this model."
        );
      }
      if (e instanceof TypeError && (e as Error).message.includes("fetch")) {
        throw new Error(
          `Cannot connect to Ollama at ${this.url}. Is it running?`
        );
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }
}
