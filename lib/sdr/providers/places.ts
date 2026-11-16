/**
 * Provider Google Places API (New) - Text Search.
 * Usa field mask mínimo para reduzir custo e exposição de dados.
 * Somente servidor: a chave vem de GOOGLE_PLACES_API_KEY (nunca NEXT_PUBLIC_*).
 * Sem a chave, a busca devolve lista vazia (modo desligado).
 */

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

// Field mask mínimo - apenas os campos necessários (vai no header X-Goog-FieldMask)
const DEFAULT_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.types',
  'places.priceLevel',
  'places.location',
].join(',');

// Rate limit: no máx. 1 requisição por segundo por instância
const RATE_LIMIT_MS = 1000;
let lastRequestAt = 0;

// ============================================================
// TIPOS
// ============================================================

export type PlaceResult = {
  placeId: string;
  displayName: {
    text: string;
    languageCode: string;
  };
  address: string;
  phone: string;
  website: string | null;
  rating: number | null;
  userRatingCount: number | null;
  types: string[];
  priceLevel: string | null;
  location: {
    latitude: number;
    longitude: number;
  };
};

// ============================================================
// BUSCA DE TEXTO NO GOOGLE PLACES
// ============================================================

export async function searchPlaces(
  query: string,
  location?: { latitude: number; longitude: number },
  radius: number = 5000,
  types?: string[],
  fieldMask?: string
): Promise<PlaceResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  await delayRateLimit();

  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: 'pt-BR',
    regionCode: 'BR',
  };
  if (location) {
    body.locationBias = { circle: { center: location, radius } };
  }
  if (types && types.length > 0) {
    // Text Search aceita um único includedType; os demais são filtrados no resultado
    body.includedType = types[0];
  }

  try {
    const response = await fetch(PLACES_TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask || DEFAULT_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      // Não loga o corpo (pode ecoar parâmetros); só o status.
      console.error(`Google Places API respondeu ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results = parsePlacesResponse(data);
    return types && types.length > 1 ? results.filter((p) => p.types.some((t) => types.includes(t))) : results;
  } catch {
    console.error('Erro ao buscar no Google Places (rede/timeout).');
    return [];
  }
}

// ============================================================
// PARSE DA RESPOSTA DO GOOGLE PLACES
// ============================================================

export function parsePlacesResponse(data: any): PlaceResult[] {
  if (!data || !Array.isArray(data.places)) return [];

  return data.places.map((place: any): PlaceResult => {
    const name = place.displayName ?? {};
    return {
      placeId: place.id || '',
      displayName: {
        text: name.text || 'Sem nome',
        languageCode: name.languageCode || 'pt-BR',
      },
      address: place.formattedAddress || '',
      phone: place.internationalPhoneNumber || '',
      website: place.websiteUri || null,
      rating: place.rating ?? null,
      userRatingCount: place.userRatingCount ?? null,
      types: place.types || [],
      priceLevel: place.priceLevel || null,
      location: place.location
        ? { latitude: place.location.latitude, longitude: place.location.longitude }
        : { latitude: 0, longitude: 0 },
    };
  });
}

// ============================================================
// RATE LIMIT
// ============================================================

export async function delayRateLimit(): Promise<void> {
  const wait = lastRequestAt + RATE_LIMIT_MS - Date.now();
  lastRequestAt = Math.max(Date.now(), lastRequestAt + RATE_LIMIT_MS);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
