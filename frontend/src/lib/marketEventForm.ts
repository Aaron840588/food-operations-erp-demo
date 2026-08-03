export interface MarketEventChecklistIdentity {
  id: number;
  status: string;
}

export interface MarketEventCatalogAvailability {
  sku: string;
  is_active?: boolean;
}

export function getMarketEventChecklistKey(
  selectedEvent: MarketEventChecklistIdentity | null | undefined,
): string {
  if (!selectedEvent) return "create-event";
  return `event:${selectedEvent.id}:${selectedEvent.status}`;
}

export function canDisplayMarketEventCatalogProduct(
  product: MarketEventCatalogAvailability,
  allocatedSkus: ReadonlySet<string>,
): boolean {
  return product.is_active !== false
    || allocatedSkus.has(product.sku.trim().toLowerCase());
}
