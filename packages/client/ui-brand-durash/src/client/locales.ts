/** `durashBrand` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'name': 'DuraSH',
} satisfies Record<string, string>

/** The DuraSH brand namespace key union. */
export type DuraSHBrandKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'name': 'DuraSH',
} satisfies Record<DuraSHBrandKey, string>
