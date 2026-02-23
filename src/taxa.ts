import { TaxaMapping } from "./types";

export const DEFAULT_TAXA_MAPPINGS: TaxaMapping[] = [
  { prefix: "@", label: "People", folder: "00 knowledge/people" },
  { prefix: "+", label: "Concepts", folder: "00 knowledge/concepts" },
  { prefix: "~", label: "Places", folder: "00 knowledge/places" },
  { prefix: "\u2022", label: "Projects", folder: "00 knowledge/projects" },
  { prefix: "\u00A9", label: "Works", folder: "00 knowledge/works" },
  { prefix: "\u00BA", label: "Organizations", folder: "00 knowledge/organizations" },
  { prefix: "\u221E", label: "Events", folder: "00 knowledge/events" },
];

export function findTaxonByPrefix(
  text: string,
  mappings: TaxaMapping[]
): TaxaMapping | null {
  // Sort by prefix length descending so multi-char prefixes match first
  const sorted = [...mappings].sort(
    (a, b) => b.prefix.length - a.prefix.length
  );
  for (const mapping of sorted) {
    if (text.startsWith(mapping.prefix)) {
      return mapping;
    }
  }
  return null;
}

export function stripPrefix(text: string, mapping: TaxaMapping): string {
  if (text.startsWith(mapping.prefix)) {
    return text.slice(mapping.prefix.length);
  }
  return text;
}

export function addPrefix(name: string, mapping: TaxaMapping): string {
  return mapping.prefix + name;
}

export function getAllPrefixes(mappings: TaxaMapping[]): string[] {
  return mappings.map((m) => m.prefix);
}

/**
 * Map LLM entity type strings to taxa prefixes.
 */
export const ENTITY_TYPE_TO_PREFIX: Record<string, string> = {
  person: "@",
  concept: "+",
  place: "~",
  organization: "\u00BA",
  work: "\u00A9",
  event: "\u221E",
};

export function taxonForEntityType(
  entityType: string,
  mappings: TaxaMapping[]
): TaxaMapping | null {
  const prefix = ENTITY_TYPE_TO_PREFIX[entityType];
  if (!prefix) return null;
  return mappings.find((m) => m.prefix === prefix) ?? null;
}
