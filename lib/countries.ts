/**
 * Países disponibles para el emparejamiento. El `code` es lo que viaja a la
 * columna `country` de Supabase y lo que compara la RPC join_queue_or_match().
 *
 * Lista de arranque (Fase 2). Ampliar aquí y nada más: la validación del
 * servidor y el <select> leen de este mismo array.
 */
export const COUNTRIES = [
  { code: "ES", name: "España", flag: "🇪🇸" },
  { code: "MX", name: "México", flag: "🇲🇽" },
  { code: "AR", name: "Argentina", flag: "🇦🇷" },
  { code: "CO", name: "Colombia", flag: "🇨🇴" },
  { code: "CL", name: "Chile", flag: "🇨🇱" },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];

export function isValidCountry(value: string): value is CountryCode {
  return COUNTRIES.some((country) => country.code === value);
}

export function countryName(code: string | null | undefined): string | null {
  return COUNTRIES.find((country) => country.code === code)?.name ?? null;
}
