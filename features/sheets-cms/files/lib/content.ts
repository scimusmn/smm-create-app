/**
 * Read content/content.json, written by `yarn pull-content`.
 *
 * Record keys come from the sheet's header row. getEntry() returns the row
 * whose `key` column matches.
 */
import content from "../content/content.json";

export type ContentRecord = Record<string, string>;

export function getContent(): ContentRecord[] {
  return content.records as ContentRecord[];
}

/** Convenience: first record where `key` column matches (common pattern for keyed copy). */
export function getEntry(key: string): ContentRecord | undefined {
  return getContent().find((record) => record.key === key);
}

export const contentMeta = {
  pulledAt: content.pulledAt,
  sheetId: content.sheetId,
};
