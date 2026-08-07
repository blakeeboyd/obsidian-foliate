import { TaxaMapping } from "./types";

// Default taxa ship with prefixes and labels only; the user assigns a folder
// (and optional template) per taxon. A taxon with no folder set leaves its
// files at the vault root and isn't auto-moved.
export const DEFAULT_TAXA_MAPPINGS: TaxaMapping[] = [
  { prefix: "@", label: "People", folder: "" },
  { prefix: "+", label: "Concepts", folder: "" },
  { prefix: "~", label: "Places", folder: "" },
  { prefix: "\u2022", label: "Projects", folder: "" },
  { prefix: "\u00A9", label: "Works", folder: "" },
  { prefix: "\u00A1", label: "Images", folder: "" },
  { prefix: "\u00BA", label: "Organizations", folder: "" },
  { prefix: "\u221E", label: "Events", folder: "" },
];

// The single domain: groups other taxa. Same shape as a taxon.
export const DEFAULT_DOMAIN: TaxaMapping = { prefix: "\u2248", label: "Domains", folder: "" };

export function findTaxonByPrefix(
  text: string,
  mappings: TaxaMapping[]
): TaxaMapping | null {
  // A prefix is one character, so no two can shadow each other and the first
  // match is the only match.
  for (const mapping of mappings) {
    if (mapping.prefix && text.startsWith(mapping.prefix)) {
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
