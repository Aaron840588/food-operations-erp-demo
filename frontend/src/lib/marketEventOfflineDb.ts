/**
 * Isolated, local-first persistence for the Market Events cashier.
 *
 * This database is deliberately separate from the generic offline mutation
 * queue. Bazaar sales are financial writes and must only be replayed through
 * the event-specific, client-reference-idempotent sync flow.
 */

export const MARKET_EVENT_OFFLINE_SCHEMA_VERSION = 1 as const;
export const MARKET_EVENT_PAYMENT_METHODS = [
  "Cash",
  "GCash",
  "BPI / Bank Transfer",
  "Bank Transfer",
  "Pautang",
  "Maya",
  "Card",
  "Complimentary / Gift",
] as const;

export type MarketEventPaymentMethod = typeof MARKET_EVENT_PAYMENT_METHODS[number];
export const MARKET_EVENT_PROMOTION_CODES = [
  "CLASSIC_DUO",
  "SIGNATURE_DUO",
  "COMBO_DUO",
  "B1T1",
] as const;
export type MarketEventPromotionCode = typeof MARKET_EVENT_PROMOTION_CODES[number];
export type MarketEventDiscountType = "PERCENTAGE" | "FIXED";

const DEFAULT_DATABASE_NAME = "hh_market_events_offline";
const DATABASE_VERSION = 1;

const EVENT_PACKAGES_STORE = "event_packages";
const PENDING_SALES_STORE = "pending_sales";
const CACHED_STOCK_STORE = "cached_stock";
const SYNC_METADATA_STORE = "sync_metadata";
const DEVICE_IDENTITY_STORE = "device_identity";
const PRIMARY_DEVICE_IDENTITY_KEY = "primary";
const MAX_EVENT_PACKAGE_LIFETIME_MS = 24 * 60 * 60 * 1_000;

const UNRESOLVED_SALE_STATUSES = new Set<OfflineMarketSaleStatus>([
  "pending",
  "syncing",
  "failed",
  "requires_review",
]);

const REPLAYABLE_SALE_STATUSES = new Set<OfflineMarketSaleStatus>([
  "pending",
  "syncing",
  "failed",
]);

export type OfflineMarketSaleStatus =
  | "pending"
  | "syncing"
  | "failed"
  | "requires_review"
  | "synced"
  | "voided";

export type MarketEventOfflineSyncState =
  | "ready"
  | "synced"
  | "pending"
  | "syncing"
  | "error"
  | "manual_review";

export interface OfflineMarketEventSnapshotV1 {
  id: number;
  name: string;
  event_date: string;
  location: string;
  status: string;
  staff_assigned?: string | null;
  notes?: string | null;
}

export interface OfflineMarketCashierV1 {
  username: string;
  role: "owner" | "staff";
}

export interface MarketEventOfflineDeviceIdentityV1 {
  schema_version: typeof MARKET_EVENT_OFFLINE_SCHEMA_VERSION;
  key: typeof PRIMARY_DEVICE_IDENTITY_KEY;
  device_id: string;
  label: string | null;
  created_at: string;
}

export interface OfflineMarketProductV1 {
  sku: string;
  product_name: string;
  category?: string | null;
  size?: string | null;
  retail_price: number;
}

export interface OfflineMarketStockSeedV1 {
  sku: string;
  quantity: number;
}

/**
 * A server-derived snapshot that enables one event to operate locally.
 * `source_revision` is opaque: callers may use an ETag, updated timestamp, or
 * another server-issued revision once one is available.
 */
export interface MarketEventOfflinePackageV1 {
  schema_version: typeof MARKET_EVENT_OFFLINE_SCHEMA_VERSION;
  source_revision: string;
  generated_at: string;
  expires_at: string;
  device_id: string;
  cashier: OfflineMarketCashierV1;
  event: OfflineMarketEventSnapshotV1;
  products: OfflineMarketProductV1[];
  stock: OfflineMarketStockSeedV1[];
}

export interface CachedMarketEventStockV1 {
  schema_version: typeof MARKET_EVENT_OFFLINE_SCHEMA_VERSION;
  event_id: number;
  sku: string;
  product_name: string;
  category: string | null;
  size: string | null;
  unit_price_centavos: number;
  /** Server-confirmed quantity represented by this local snapshot. */
  server_quantity: number;
  /** Quantity reserved by local sales that have not been confirmed remotely. */
  pending_quantity: number;
  /** Immediately saleable quantity on this device. */
  available_quantity: number;
  source_revision: string;
  updated_at: string;
}

export interface OfflineMarketSaleItemInputV1 {
  sku: string;
  quantity: number;
}

export interface OfflineMarketSaleInputV1 {
  event_id: number;
  client_reference: string;
  payment_method: MarketEventPaymentMethod;
  items: OfflineMarketSaleItemInputV1[];
  cash_received?: number | null;
  tip_amount?: number | null;
  payment_reference?: string | null;
  is_preorder?: boolean;
  preorder_customer_name?: string | null;
  preorder_payment_status?: "Paid" | "Unpaid" | null;
  preorder_fulfillment_status?: "Pending" | "Picked Up" | null;
  customer_name?: string | null;
  expected_subtotal: number;
  promotion_code?: MarketEventPromotionCode | null;
  discount_type?: MarketEventDiscountType | null;
  discount_value?: number | null;
  /**
   * Set when an online request failed without a definitive server response.
   * The idempotent reference remains replayable, but local void is unsafe.
   */
  delivery_uncertain?: boolean;
}

export interface PendingMarketSaleItemV1 {
  sku: string;
  quantity: number;
  product_name: string;
  category: string | null;
  size: string | null;
  price_snapshot_centavos: number;
  line_total_centavos: number;
}

export interface PendingMarketSaleV1 {
  schema_version: typeof MARKET_EVENT_OFFLINE_SCHEMA_VERSION;
  client_reference: string;
  event_id: number;
  status: OfflineMarketSaleStatus;
  payment_method: MarketEventPaymentMethod;
  items: PendingMarketSaleItemV1[];
  subtotal_amount_centavos: number;
  promotion_code: MarketEventPromotionCode | "COMPLIMENTARY" | null;
  promotion_discount_amount_centavos: number;
  discount_type: MarketEventDiscountType | null;
  discount_value: number | null;
  manual_discount_amount_centavos: number;
  discount_amount_centavos: number;
  total_amount_centavos: number;
  tip_amount_centavos: number;
  cash_received_centavos: number | null;
  change_given_centavos: number;
  payment_reference: string | null;
  customer_name: string | null;
  is_collected: boolean;
  cashier_username: string;
  device_id: string;
  is_preorder: boolean;
  preorder_customer_name: string | null;
  preorder_payment_status: "Paid" | "Unpaid" | null;
  preorder_fulfillment_status: "Pending" | "Picked Up" | null;
  delivery_uncertain: boolean;
  sync_attempt_count: number;
  last_sync_attempt_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  server_sale_id: number | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  voided_at: string | null;
  request_fingerprint: string;
}

export interface MarketEventSyncMetadataV1 {
  schema_version: typeof MARKET_EVENT_OFFLINE_SCHEMA_VERSION;
  event_id: number;
  source_revision: string;
  package_cached_at: string;
  last_synced_at: string | null;
  last_sync_attempt_at: string | null;
  sync_state: MarketEventOfflineSyncState;
  pending_sale_count: number;
  server_cursor: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
}

export interface OfflineSaleMutationResult {
  sale: PendingMarketSaleV1;
  stock: CachedMarketEventStockV1[];
  created: boolean;
}

/** Minimum server response required before committing a local stock deduction. */
export interface SyncedMarketSaleReceiptV1 {
  server_sale_id: number;
  event_id: number;
  cashier_username: string;
  payment_method: MarketEventPaymentMethod;
  items: Array<OfflineMarketSaleItemInputV1 & { price_snapshot: number }>;
  subtotal_amount: number;
  promotion_code: MarketEventPromotionCode | "COMPLIMENTARY" | null;
  promotion_discount_amount: number;
  discount_type: MarketEventDiscountType | null;
  discount_value: number | null;
  manual_discount_amount: number;
  discount_amount: number;
  total_amount: number;
  tip_amount: number;
  cash_received: number | null;
  change_given: number;
  payment_reference: string | null;
  customer_name: string | null;
  is_collected: boolean;
  is_preorder: boolean;
  preorder_customer_name: string | null;
  preorder_payment_status: "Paid" | "Unpaid" | null;
  preorder_fulfillment_status: "Pending" | "Picked Up" | null;
  server_timestamp: string;
}

export interface MarketEventSaleApiPayload {
  payment_method: MarketEventPaymentMethod;
  items: Array<{ sku: string; quantity: number }>;
  client_reference: string;
  expected_subtotal: number;
  promotion_code: MarketEventPromotionCode | null;
  discount_type: MarketEventDiscountType | null;
  discount_value: number | null;
  tip_amount: number;
  cash_received: number | null;
  payment_reference: string | null;
  customer_name: string | null;
  is_preorder: boolean;
  preorder_customer_name: string | null;
  preorder_payment_status: "Paid" | "Unpaid" | null;
  preorder_fulfillment_status: "Pending" | "Picked Up" | null;
}

interface StoredMarketEventPackageV1
  extends Omit<MarketEventOfflinePackageV1, "stock"> {
  event_id: number;
  stock_skus: string[];
  cached_at: string;
}

export interface MarketEventOfflineDbOptions {
  database_name?: string;
  indexed_db?: IDBFactory;
  now?: () => Date;
}

export class MarketEventOfflineDbError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MarketEventOfflineDbError";
    this.code = code;
  }
}

export class MarketEventOfflineValidationError extends MarketEventOfflineDbError {
  constructor(message: string) {
    super("validation_error", message);
    this.name = "MarketEventOfflineValidationError";
  }
}

export class MarketEventOfflineStockError extends MarketEventOfflineDbError {
  readonly sku: string;
  readonly requested: number;
  readonly available: number;

  constructor(sku: string, requested: number, available: number) {
    super(
      "insufficient_cached_stock",
      `Only ${available} cached unit(s) of ${sku} are available; ${requested} requested.`,
    );
    this.name = "MarketEventOfflineStockError";
    this.sku = sku;
    this.requested = requested;
    this.available = available;
  }
}

function isUnresolvedSale(sale: PendingMarketSaleV1): boolean {
  return UNRESOLVED_SALE_STATUSES.has(sale.status);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(
      transaction.error ?? new Error("IndexedDB transaction was aborted"),
    );
    transaction.onerror = () => reject(
      transaction.error ?? new Error("IndexedDB transaction failed"),
    );
  });
}

/**
 * Mobile Safari can mark an IndexedDB transaction inactive between awaited
 * request continuations. Keep one harmless request pending until the domain
 * operation has queued all of its reads and writes.
 */
function keepTransactionAlive(
  transaction: IDBTransaction,
  storeName: string,
): () => void {
  let active = true;
  const store = transaction.objectStore(storeName);

  const ping = () => {
    if (!active) return;
    let request: IDBRequest<unknown>;
    try {
      request = store.get(0);
    } catch {
      active = false;
      return;
    }
    request.onsuccess = ping;
    request.onerror = ping;
  };

  ping();
  return () => {
    active = false;
  };
}

function normalizePositiveId(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MarketEventOfflineValidationError(`${field} must be a positive integer.`);
  }
  return value;
}

function normalizeNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MarketEventOfflineValidationError(`${field} must be a non-negative integer.`);
  }
  return value;
}

function normalizePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MarketEventOfflineValidationError(`${field} must be a positive integer.`);
  }
  return value;
}

function normalizeString(
  value: string | null | undefined,
  field: string,
  options: { required?: boolean; max_length?: number } = {},
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (options.required && !normalized) {
    throw new MarketEventOfflineValidationError(`${field} is required.`);
  }
  const maxLength = options.max_length ?? 500;
  if (normalized.length > maxLength) {
    throw new MarketEventOfflineValidationError(
      `${field} cannot exceed ${maxLength} characters.`,
    );
  }
  return normalized || null;
}

function normalizeIsoTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new MarketEventOfflineValidationError(`${field} must be a valid timestamp.`);
  }
  return parsed.toISOString();
}

function normalizeClientReference(value: string): string {
  const normalized = normalizeString(value, "client_reference", {
    required: true,
    max_length: 64,
  }) as string;
  if (normalized.length < 8 || !/^[A-Za-z0-9:_-]+$/.test(normalized)) {
    throw new MarketEventOfflineValidationError(
      "client_reference must be 8-64 letters, numbers, colons, underscores, or hyphens.",
    );
  }
  return normalized;
}

function normalizeDeviceId(value: string | null | undefined): string {
  const normalized = normalizeString(value, "device_id", {
    required: true,
    max_length: 64,
  }) as string;
  if (!/^device:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new MarketEventOfflineValidationError(
      "device_id must be a device-prefixed UUID.",
    );
  }
  return normalized.toLowerCase();
}

function secureRandomUuid(): string {
  const randomUuid = typeof globalThis !== "undefined"
    ? globalThis.crypto?.randomUUID?.()
    : undefined;
  if (!randomUuid) {
    throw new MarketEventOfflineDbError(
      "secure_random_unavailable",
      "Secure random identifiers are unavailable on this device.",
    );
  }
  return randomUuid;
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new MarketEventOfflineValidationError(
      `${field} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return value as T;
}

function amountToCentavos(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new MarketEventOfflineValidationError(`${field} must be a non-negative amount.`);
  }
  const centavos = Math.round(value * 100);
  if (!Number.isSafeInteger(centavos)) {
    throw new MarketEventOfflineValidationError(`${field} is too large.`);
  }
  return centavos;
}

export function centavosToAmount(centavos: number): number {
  if (!Number.isSafeInteger(centavos)) {
    throw new MarketEventOfflineValidationError("Centavo amount must be a safe integer.");
  }
  return centavos / 100;
}

function isClassicPromotionItem(item: PendingMarketSaleItemV1): boolean {
  const sku = item.sku.toUpperCase();
  const name = item.product_name.toLowerCase();
  return (
    ["GCP-", "PEGG-", "PTE-", "UYK-", "STS-", "CMS-", "WM-"].some(
      (prefix) => sku.startsWith(prefix),
    )
    || [
      "grilled cheese",
      "pesto egg",
      "pesto, tomato",
      "ube, keso",
      "sweet tablea s'mores",
      "cookies & matcha",
      "cookies and matcha",
      "white mocha s'mores",
    ].some((token) => name.includes(token))
  );
}

function isSignaturePromotionItem(item: PendingMarketSaleItemV1): boolean {
  const sku = item.sku.toUpperCase();
  const name = item.product_name.toLowerCase();
  return (
    ["TPP-", "BMC-", "SSC-", "PCS-", "PCHXW-", "BLT-"].some(
      (prefix) => sku.startsWith(prefix),
    )
    || [
      "tuna pesto pasta",
      "bacon mac",
      "smoked salmon",
      "pesto club",
      "pesto chicken",
      "bacon, lettuce",
      "(blt)",
    ].some((token) => name.includes(token))
  );
}

function calculatePromotionDiscountCentavos(
  promotionCode: MarketEventPromotionCode | null,
  items: PendingMarketSaleItemV1[],
): number {
  if (!promotionCode) return 0;

  const classicUnits: number[] = [];
  const signatureUnits: number[] = [];
  const allUnits: number[] = [];
  items.forEach((item) => {
    const units = Array.from(
      { length: item.quantity },
      () => item.price_snapshot_centavos,
    );
    allUnits.push(...units);
    if (isClassicPromotionItem(item)) classicUnits.push(...units);
    if (isSignaturePromotionItem(item)) signatureUnits.push(...units);
  });

  let discount = 0;
  const descending = (left: number, right: number) => right - left;
  if (promotionCode === "CLASSIC_DUO" || promotionCode === "SIGNATURE_DUO") {
    const units = promotionCode === "CLASSIC_DUO" ? classicUnits : signatureUnits;
    const target = promotionCode === "CLASSIC_DUO" ? 16_500 : 24_500;
    units.sort(descending);
    for (let index = 0; index + 1 < units.length; index += 2) {
      discount += Math.max(0, units[index] + units[index + 1] - target);
    }
  } else if (promotionCode === "COMBO_DUO") {
    classicUnits.sort(descending);
    signatureUnits.sort(descending);
    const pairCount = Math.min(classicUnits.length, signatureUnits.length);
    for (let index = 0; index < pairCount; index += 1) {
      discount += Math.max(
        0,
        classicUnits[index] + signatureUnits[index] - 21_000,
      );
    }
  } else {
    allUnits.sort(descending);
    for (let index = 0; index + 1 < allUnits.length; index += 2) {
      discount += allUnits[index + 1];
    }
  }

  if (!Number.isSafeInteger(discount)) {
    throw new MarketEventOfflineValidationError(
      "Calculated promotion discount is too large.",
    );
  }
  return discount;
}

export function createMarketEventSaleClientReference(eventIdInput: number): string {
  const eventId = normalizePositiveId(eventIdInput, "event_id");
  return normalizeClientReference(`market:${eventId}:${secureRandomUuid()}`);
}

function normalizeSaleItems(
  items: OfflineMarketSaleItemInputV1[],
): OfflineMarketSaleItemInputV1[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new MarketEventOfflineValidationError("At least one sale item is required.");
  }

  const seen = new Set<string>();
  const normalized = items.map((item, index) => {
    const sku = normalizeString(item.sku, `items[${index}].sku`, {
      required: true,
      max_length: 100,
    }) as string;
    if (seen.has(sku)) {
      throw new MarketEventOfflineValidationError(`Duplicate sale item SKU: ${sku}.`);
    }
    seen.add(sku);
    return {
      sku,
      quantity: normalizePositiveInteger(
        item.quantity,
        `items[${index}].quantity`,
      ),
    };
  });

  return normalized.sort((left, right) => left.sku.localeCompare(right.sku));
}

function normalizeSyncedSaleReceiptItems(
  items: SyncedMarketSaleReceiptV1["items"],
): Array<OfflineMarketSaleItemInputV1 & { price_snapshot_centavos: number }> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new MarketEventOfflineValidationError("At least one server sale item is required.");
  }

  const seen = new Set<string>();
  return items.map((item, index) => {
    const sku = normalizeString(item.sku, `server items[${index}].sku`, {
      required: true,
      max_length: 100,
    }) as string;
    if (seen.has(sku)) {
      throw new MarketEventOfflineValidationError(`Duplicate server sale item SKU: ${sku}.`);
    }
    seen.add(sku);
    return {
      sku,
      quantity: normalizePositiveInteger(
        item.quantity,
        `server items[${index}].quantity`,
      ),
      price_snapshot_centavos: amountToCentavos(
        item.price_snapshot,
        `server items[${index}].price_snapshot`,
      ),
    };
  }).sort((left, right) => left.sku.localeCompare(right.sku));
}

function normalizeOptionalError(value: string | null | undefined): string | null {
  return normalizeString(value, "error message", { max_length: 500 });
}

function compareSales(left: PendingMarketSaleV1, right: PendingMarketSaleV1): number {
  const timestampOrder = left.created_at.localeCompare(right.created_at);
  return timestampOrder || left.client_reference.localeCompare(right.client_reference);
}

function summarizeEventSales(
  sales: PendingMarketSaleV1[],
  noPendingState: "ready" | "synced",
): {
  sync_state: MarketEventOfflineSyncState;
  pending_sale_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
} {
  const unresolved = sales
    .filter(isUnresolvedSale)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  const highestPriority = unresolved.find((sale) => sale.status === "requires_review")
    ?? unresolved.find((sale) => sale.status === "failed")
    ?? unresolved.find((sale) => sale.status === "syncing")
    ?? unresolved[0];

  let syncState: MarketEventOfflineSyncState = noPendingState;
  if (highestPriority?.status === "requires_review") syncState = "manual_review";
  else if (highestPriority?.status === "failed") syncState = "error";
  else if (highestPriority?.status === "syncing") syncState = "syncing";
  else if (highestPriority) syncState = "pending";

  return {
    sync_state: syncState,
    pending_sale_count: unresolved.length,
    last_error_code: highestPriority?.last_error_code ?? null,
    last_error_message: highestPriority?.last_error_message ?? null,
  };
}

export function pendingMarketSaleToApiPayload(
  sale: PendingMarketSaleV1,
): MarketEventSaleApiPayload {
  const subtotalCentavos = Number.isSafeInteger(sale.subtotal_amount_centavos)
    ? sale.subtotal_amount_centavos
    : sale.items.reduce((sum, item) => sum + item.line_total_centavos, 0);
  const isComplimentary = sale.payment_method === "Complimentary / Gift";
  const storedPromotionCode = sale.promotion_code === "COMPLIMENTARY"
    ? null
    : sale.promotion_code ?? null;
  const reconstructedDiscountCentavos = Math.max(
    0,
    subtotalCentavos - sale.total_amount_centavos,
  );
  const discountType = isComplimentary
    ? null
    : sale.discount_type
      ?? (storedPromotionCode == null && reconstructedDiscountCentavos > 0
        ? "FIXED"
        : null);
  const discountValue = discountType == null
    ? null
    : sale.discount_value
      ?? centavosToAmount(reconstructedDiscountCentavos);

  return {
    payment_method: sale.payment_method,
    items: sale.items.map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
    })),
    client_reference: sale.client_reference,
    expected_subtotal: centavosToAmount(subtotalCentavos),
    promotion_code: isComplimentary ? null : storedPromotionCode,
    discount_type: discountType,
    discount_value: discountValue,
    tip_amount: centavosToAmount(sale.tip_amount_centavos ?? 0),
    cash_received: sale.cash_received_centavos == null
      ? null
      : centavosToAmount(sale.cash_received_centavos),
    payment_reference: sale.payment_reference,
    customer_name: sale.customer_name ?? null,
    is_preorder: sale.is_preorder,
    preorder_customer_name: sale.preorder_customer_name,
    preorder_payment_status: sale.preorder_payment_status,
    preorder_fulfillment_status: sale.preorder_fulfillment_status,
  };
}

export function createMarketEventOfflineDb(
  options: MarketEventOfflineDbOptions = {},
) {
  const databaseName = options.database_name ?? DEFAULT_DATABASE_NAME;
  const now = options.now ?? (() => new Date());
  let databasePromise: Promise<IDBDatabase> | null = null;

  function getIndexedDbFactory(): IDBFactory {
    const factory = options.indexed_db
      ?? (typeof globalThis !== "undefined" ? globalThis.indexedDB : undefined);
    if (!factory) {
      throw new MarketEventOfflineDbError(
        "indexeddb_unavailable",
        "IndexedDB is not supported in this environment.",
      );
    }
    return factory;
  }

  function nowIso(): string {
    const current = now();
    if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
      throw new MarketEventOfflineDbError(
        "invalid_clock",
        "The offline database clock returned an invalid date.",
      );
    }
    return current.toISOString();
  }

  function openDatabase(): Promise<IDBDatabase> {
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let abandoned = false;
      try {
        request = getIndexedDbFactory().open(databaseName, DATABASE_VERSION);
      } catch (error) {
        reject(error);
        return;
      }

      request.onerror = () => {
        if (!abandoned) databasePromise = null;
        reject(request.error ?? new Error("Unable to open the offline event database"));
      };
      request.onblocked = () => {
        abandoned = true;
        databasePromise = null;
        reject(new MarketEventOfflineDbError(
          "database_upgrade_blocked",
          "Close other H+H Hub tabs so the offline event database can be upgraded.",
        ));
      };
      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(EVENT_PACKAGES_STORE)) {
          database.createObjectStore(EVENT_PACKAGES_STORE, { keyPath: "event_id" });
        }

        if (!database.objectStoreNames.contains(PENDING_SALES_STORE)) {
          const sales = database.createObjectStore(PENDING_SALES_STORE, {
            keyPath: "client_reference",
          });
          sales.createIndex("event_id", "event_id", { unique: false });
          sales.createIndex("status", "status", { unique: false });
          sales.createIndex("created_at", "created_at", { unique: false });
        }

        if (!database.objectStoreNames.contains(CACHED_STOCK_STORE)) {
          const stock = database.createObjectStore(CACHED_STOCK_STORE, {
            keyPath: ["event_id", "sku"],
          });
          stock.createIndex("event_id", "event_id", { unique: false });
        }

        if (!database.objectStoreNames.contains(SYNC_METADATA_STORE)) {
          database.createObjectStore(SYNC_METADATA_STORE, { keyPath: "event_id" });
        }

        if (!database.objectStoreNames.contains(DEVICE_IDENTITY_STORE)) {
          database.createObjectStore(DEVICE_IDENTITY_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (abandoned) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
    });

    return databasePromise;
  }

  async function runTransaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    operation: (transaction: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const database = await openDatabase();
    const transaction = database.transaction(stores, mode);
    const completion = transactionToPromise(transaction);
    const stopKeepingAlive = keepTransactionAlive(transaction, stores[0]);

    try {
      const result = await operation(transaction);
      stopKeepingAlive();
      await completion;
      return result;
    } catch (error) {
      stopKeepingAlive();
      try {
        transaction.abort();
      } catch {
        // The transaction may already have failed or committed.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async function getOrCreateDeviceIdentity(
    label?: string | null,
  ): Promise<MarketEventOfflineDeviceIdentityV1> {
    const normalizedLabel = label === undefined
      ? undefined
      : normalizeString(label, "device label", { max_length: 100 });
    return runTransaction([DEVICE_IDENTITY_STORE], "readwrite", async (transaction) => {
      const store = transaction.objectStore(DEVICE_IDENTITY_STORE);
      const existing = await requestToPromise(
        store.get(PRIMARY_DEVICE_IDENTITY_KEY),
      ) as MarketEventOfflineDeviceIdentityV1 | undefined;
      if (existing) {
        if (existing.schema_version !== MARKET_EVENT_OFFLINE_SCHEMA_VERSION) {
          throw new MarketEventOfflineDbError(
            "device_schema_mismatch",
            "The saved cashier device identity uses an unsupported schema.",
          );
        }
        normalizeDeviceId(existing.device_id);
        if (normalizedLabel !== undefined && normalizedLabel !== existing.label) {
          const updated = { ...existing, label: normalizedLabel };
          store.put(updated);
          return updated;
        }
        return existing;
      }

      const identity: MarketEventOfflineDeviceIdentityV1 = {
        schema_version: MARKET_EVENT_OFFLINE_SCHEMA_VERSION,
        key: PRIMARY_DEVICE_IDENTITY_KEY,
        device_id: normalizeDeviceId(`device:${secureRandomUuid()}`),
        label: normalizedLabel ?? null,
        created_at: nowIso(),
      };
      store.add(identity);
      return identity;
    });
  }

  function normalizePackage(input: MarketEventOfflinePackageV1): {
    packageRecord: StoredMarketEventPackageV1;
    stockRecords: CachedMarketEventStockV1[];
  } {
    if (input.schema_version !== MARKET_EVENT_OFFLINE_SCHEMA_VERSION) {
      throw new MarketEventOfflineValidationError(
        `Unsupported event package schema version: ${input.schema_version}.`,
      );
    }

    const eventId = normalizePositiveId(input.event.id, "event.id");
    const deviceId = normalizeDeviceId(input.device_id);
    const sourceRevision = normalizeString(input.source_revision, "source_revision", {
      required: true,
      max_length: 200,
    }) as string;
    const generatedAt = normalizeIsoTimestamp(input.generated_at, "generated_at");
    const expiresAt = normalizeIsoTimestamp(input.expires_at, "expires_at");
    if (expiresAt <= generatedAt) {
      throw new MarketEventOfflineValidationError(
        "expires_at must be later than generated_at.",
      );
    }
    if (
      new Date(expiresAt).getTime() - new Date(generatedAt).getTime()
      > MAX_EVENT_PACKAGE_LIFETIME_MS
    ) {
      throw new MarketEventOfflineValidationError(
        "An offline event package cannot remain valid for more than 24 hours.",
      );
    }

    const productMap = new Map<string, OfflineMarketProductV1>();
    const products = input.products.map((product, index) => {
      const sku = normalizeString(product.sku, `products[${index}].sku`, {
        required: true,
        max_length: 100,
      }) as string;
      if (productMap.has(sku)) {
        throw new MarketEventOfflineValidationError(`Duplicate package product SKU: ${sku}.`);
      }
      const normalizedProduct: OfflineMarketProductV1 = {
        sku,
        product_name: normalizeString(
          product.product_name,
          `products[${index}].product_name`,
          { required: true, max_length: 255 },
        ) as string,
        category: normalizeString(product.category, `products[${index}].category`, {
          max_length: 100,
        }),
        size: normalizeString(product.size, `products[${index}].size`, {
          max_length: 100,
        }),
        retail_price: centavosToAmount(
          amountToCentavos(product.retail_price, `products[${index}].retail_price`),
        ),
      };
      productMap.set(sku, normalizedProduct);
      return normalizedProduct;
    });

    const stockSeen = new Set<string>();
    const cachedAt = nowIso();
    const stockRecords = input.stock.map((stock, index) => {
      const sku = normalizeString(stock.sku, `stock[${index}].sku`, {
        required: true,
        max_length: 100,
      }) as string;
      if (stockSeen.has(sku)) {
        throw new MarketEventOfflineValidationError(`Duplicate package stock SKU: ${sku}.`);
      }
      stockSeen.add(sku);
      const product = productMap.get(sku);
      if (!product) {
        throw new MarketEventOfflineValidationError(
          `Stock SKU ${sku} does not have matching package product metadata.`,
        );
      }
      const quantity = normalizeNonNegativeInteger(
        stock.quantity,
        `stock[${index}].quantity`,
      );
      return {
        schema_version: MARKET_EVENT_OFFLINE_SCHEMA_VERSION,
        event_id: eventId,
        sku,
        product_name: product.product_name,
        category: product.category ?? null,
        size: product.size ?? null,
        unit_price_centavos: amountToCentavos(
          product.retail_price,
          `products[${index}].retail_price`,
        ),
        server_quantity: quantity,
        pending_quantity: 0,
        available_quantity: quantity,
        source_revision: sourceRevision,
        updated_at: cachedAt,
      } satisfies CachedMarketEventStockV1;
    });

    const packageRecord: StoredMarketEventPackageV1 = {
      schema_version: MARKET_EVENT_OFFLINE_SCHEMA_VERSION,
      event_id: eventId,
      source_revision: sourceRevision,
      generated_at: generatedAt,
      expires_at: expiresAt,
      device_id: deviceId,
      cashier: {
        username: normalizeString(input.cashier.username, "cashier.username", {
          required: true,
          max_length: 100,
        }) as string,
        role: normalizeEnum(input.cashier.role, ["owner", "staff"] as const, "cashier.role"),
      },
      event: {
        id: eventId,
        name: normalizeString(input.event.name, "event.name", {
          required: true,
          max_length: 255,
        }) as string,
        event_date: normalizeString(input.event.event_date, "event.event_date", {
          required: true,
          max_length: 40,
        }) as string,
        location: normalizeString(input.event.location, "event.location", {
          required: true,
          max_length: 255,
        }) as string,
        status: normalizeString(input.event.status, "event.status", {
          required: true,
          max_length: 50,
        }) as string,
        staff_assigned: normalizeString(
          input.event.staff_assigned,
          "event.staff_assigned",
          { max_length: 255 },
        ),
        notes: normalizeString(input.event.notes, "event.notes", { max_length: 2_000 }),
      },
      products,
      stock_skus: stockRecords.map((stock) => stock.sku).sort(),
      cached_at: cachedAt,
    };

    return { packageRecord, stockRecords };
  }

  async function cacheEventPackage(
    input: MarketEventOfflinePackageV1,
    sync: { last_synced_at?: string; server_cursor?: string | null } = {},
  ): Promise<void> {
    const { packageRecord, stockRecords } = normalizePackage(input);
    const eventId = packageRecord.event_id;

    await runTransaction(
      [
        EVENT_PACKAGES_STORE,
        PENDING_SALES_STORE,
        CACHED_STOCK_STORE,
        SYNC_METADATA_STORE,
        DEVICE_IDENTITY_STORE,
      ],
      "readwrite",
      async (transaction) => {
        const salesStore = transaction.objectStore(PENDING_SALES_STORE);
        const stockStore = transaction.objectStore(CACHED_STOCK_STORE);
        const deviceStore = transaction.objectStore(DEVICE_IDENTITY_STORE);
        const existingSalesRequest = salesStore.index("event_id").getAll(eventId);
        const existingStockKeysRequest = stockStore.index("event_id").getAllKeys(eventId);
        const deviceIdentityRequest = deviceStore.get(PRIMARY_DEVICE_IDENTITY_KEY);
        const [existingSales, existingStockKeys, deviceIdentity] = await Promise.all([
          requestToPromise(existingSalesRequest) as Promise<PendingMarketSaleV1[]>,
          requestToPromise(existingStockKeysRequest),
          requestToPromise(deviceIdentityRequest),
        ]) as [
          PendingMarketSaleV1[],
          IDBValidKey[],
          MarketEventOfflineDeviceIdentityV1 | undefined,
        ];

        if (
          !deviceIdentity
          || deviceIdentity.schema_version !== MARKET_EVENT_OFFLINE_SCHEMA_VERSION
          || normalizeDeviceId(deviceIdentity.device_id) !== packageRecord.device_id
        ) {
          throw new MarketEventOfflineDbError(
            "device_identity_mismatch",
            "Create this device identity before caching an event package for it.",
          );
        }

        if (existingSales.some(isUnresolvedSale)) {
          throw new MarketEventOfflineDbError(
            "pending_sales_exist",
            "Synchronize or safely void pending event sales before replacing its offline package.",
          );
        }

        existingStockKeys.forEach((key) => stockStore.delete(key));
        stockRecords.forEach((stock) => stockStore.put(stock));
        transaction.objectStore(EVENT_PACKAGES_STORE).put(packageRecord);

        const lastSyncedAt = sync.last_synced_at
          ? normalizeIsoTimestamp(sync.last_synced_at, "last_synced_at")
          : packageRecord.cached_at;
        const serverCursor = normalizeString(sync.server_cursor, "server_cursor", {
          max_length: 500,
        });
        transaction.objectStore(SYNC_METADATA_STORE).put({
          schema_version: MARKET_EVENT_OFFLINE_SCHEMA_VERSION,
          event_id: eventId,
          source_revision: packageRecord.source_revision,
          package_cached_at: packageRecord.cached_at,
          last_synced_at: lastSyncedAt,
          last_sync_attempt_at: null,
          sync_state: "synced",
          pending_sale_count: 0,
          server_cursor: serverCursor,
          last_error_code: null,
          last_error_message: null,
        } satisfies MarketEventSyncMetadataV1);
      },
    );
  }

  async function getEventPackage(
    eventIdInput: number,
  ): Promise<MarketEventOfflinePackageV1 | null> {
    const eventId = normalizePositiveId(eventIdInput, "event_id");
    return runTransaction(
      [EVENT_PACKAGES_STORE, CACHED_STOCK_STORE],
      "readonly",
      async (transaction) => {
        const packageRequest = transaction.objectStore(EVENT_PACKAGES_STORE).get(eventId);
        const stockRequest = transaction
          .objectStore(CACHED_STOCK_STORE)
          .index("event_id")
          .getAll(eventId);
        const [packageRecord, stock] = await Promise.all([
          requestToPromise(packageRequest) as Promise<StoredMarketEventPackageV1 | undefined>,
          requestToPromise(stockRequest) as Promise<CachedMarketEventStockV1[]>,
        ]);
        if (!packageRecord) return null;
        return {
          schema_version: packageRecord.schema_version,
          source_revision: packageRecord.source_revision,
          generated_at: packageRecord.generated_at,
          expires_at: packageRecord.expires_at,
          device_id: packageRecord.device_id,
          cashier: packageRecord.cashier,
          event: packageRecord.event,
          products: packageRecord.products,
          stock: stock
            .sort((left, right) => left.sku.localeCompare(right.sku))
            .map((item) => ({
              sku: item.sku,
              quantity: item.available_quantity,
            })),
        };
      },
    );
  }

  async function listEventPackages(): Promise<MarketEventOfflinePackageV1[]> {
    return runTransaction(
      [EVENT_PACKAGES_STORE, CACHED_STOCK_STORE],
      "readonly",
      async (transaction) => {
        const packagesRequest = transaction.objectStore(EVENT_PACKAGES_STORE).getAll();
        const stockRequest = transaction.objectStore(CACHED_STOCK_STORE).getAll();
        const [packages, stock] = await Promise.all([
          requestToPromise(packagesRequest) as Promise<StoredMarketEventPackageV1[]>,
          requestToPromise(stockRequest) as Promise<CachedMarketEventStockV1[]>,
        ]);
        const stockByEvent = new Map<number, CachedMarketEventStockV1[]>();
        stock.forEach((item) => {
          const rows = stockByEvent.get(item.event_id) ?? [];
          rows.push(item);
          stockByEvent.set(item.event_id, rows);
        });

        return packages
          .sort((left, right) => (
            left.event.event_date.localeCompare(right.event.event_date)
            || left.event_id - right.event_id
          ))
          .map((packageRecord) => ({
            schema_version: packageRecord.schema_version,
            source_revision: packageRecord.source_revision,
            generated_at: packageRecord.generated_at,
            expires_at: packageRecord.expires_at,
            device_id: packageRecord.device_id,
            cashier: packageRecord.cashier,
            event: packageRecord.event,
            products: packageRecord.products,
            stock: (stockByEvent.get(packageRecord.event_id) ?? [])
              .sort((left, right) => left.sku.localeCompare(right.sku))
              .map((item) => ({
                sku: item.sku,
                quantity: item.available_quantity,
              })),
          }));
      },
    );
  }

  async function getCachedStock(
    eventIdInput: number,
  ): Promise<CachedMarketEventStockV1[]> {
    const eventId = normalizePositiveId(eventIdInput, "event_id");
    return runTransaction([CACHED_STOCK_STORE], "readonly", async (transaction) => {
      const rows = await requestToPromise(
        transaction.objectStore(CACHED_STOCK_STORE).index("event_id").getAll(eventId),
      ) as CachedMarketEventStockV1[];
      return rows.sort((left, right) => left.sku.localeCompare(right.sku));
    });
  }

  async function getSyncMetadata(
    eventIdInput: number,
  ): Promise<MarketEventSyncMetadataV1 | null> {
    const eventId = normalizePositiveId(eventIdInput, "event_id");
    return runTransaction([SYNC_METADATA_STORE], "readonly", async (transaction) => {
      const metadata = await requestToPromise(
        transaction.objectStore(SYNC_METADATA_STORE).get(eventId),
      ) as MarketEventSyncMetadataV1 | undefined;
      return metadata ?? null;
    });
  }

  function saleFingerprint(input: {
    event_id: number;
    client_reference: string;
    payment_method: MarketEventPaymentMethod;
    items: OfflineMarketSaleItemInputV1[];
    expected_subtotal_centavos: number;
    promotion_code: MarketEventPromotionCode | null;
    discount_type: MarketEventDiscountType | null;
    discount_value: number | null;
    tip_amount_centavos: number;
    cash_received_centavos: number | null;
    payment_reference: string | null;
    customer_name: string | null;
    cashier_username: string | null;
    device_id: string | null;
    is_preorder: boolean;
    preorder_customer_name: string | null;
    preorder_payment_status: "Paid" | "Unpaid" | null;
    preorder_fulfillment_status: "Pending" | "Picked Up" | null;
  }): string {
    return JSON.stringify(input);
  }

  async function recordLocalSale(
    input: OfflineMarketSaleInputV1,
  ): Promise<OfflineSaleMutationResult> {
    const eventId = normalizePositiveId(input.event_id, "event_id");
    const clientReference = normalizeClientReference(input.client_reference);
    const paymentMethod = normalizeEnum(
      input.payment_method,
      MARKET_EVENT_PAYMENT_METHODS,
      "payment_method",
    );
    const items = normalizeSaleItems(input.items);
    const paymentReference = normalizeString(
      input.payment_reference,
      "payment_reference",
      { max_length: 100 },
    );
    const expectedSubtotalCentavos = amountToCentavos(
      input.expected_subtotal,
      "expected_subtotal",
    );
    const promotionCode = input.promotion_code == null
      ? null
      : normalizeEnum(
        input.promotion_code,
        MARKET_EVENT_PROMOTION_CODES,
        "promotion_code",
      );
    const discountType = input.discount_type == null
      ? null
      : normalizeEnum(
        input.discount_type,
        ["PERCENTAGE", "FIXED"] as const,
        "discount_type",
      );
    if ((discountType == null) !== (input.discount_value == null)) {
      throw new MarketEventOfflineValidationError(
        "discount_type and discount_value must be supplied together.",
      );
    }
    const discountValue = input.discount_value == null
      ? null
      : centavosToAmount(amountToCentavos(input.discount_value, "discount_value"));
    if (discountType === "PERCENTAGE" && Number(discountValue) > 100) {
      throw new MarketEventOfflineValidationError(
        "Percentage discount_value cannot exceed 100.",
      );
    }
    const tipAmountCentavos = input.tip_amount == null
      ? 0
      : amountToCentavos(input.tip_amount, "tip_amount");
    const explicitCustomerName = normalizeString(
      input.customer_name,
      "customer_name",
      { max_length: 255 },
    );
    const isPreorder = Boolean(input.is_preorder);
    const preorderCustomerName = isPreorder
      ? normalizeString(input.preorder_customer_name, "preorder_customer_name", {
        required: true,
        max_length: 255,
      })
      : null;
    const preorderPaymentStatus = isPreorder
      ? normalizeEnum(
        input.preorder_payment_status ?? "Unpaid",
        ["Paid", "Unpaid"] as const,
        "preorder_payment_status",
      )
      : null;
    const preorderFulfillmentStatus = isPreorder
      ? normalizeEnum(
        input.preorder_fulfillment_status ?? "Pending",
        ["Pending", "Picked Up"] as const,
        "preorder_fulfillment_status",
      )
      : null;
    const cashReceivedCentavos = input.cash_received == null
      ? null
      : amountToCentavos(input.cash_received, "cash_received");
    const customerName = explicitCustomerName ?? preorderCustomerName;
    if (paymentMethod === "Pautang" && !customerName) {
      throw new MarketEventOfflineValidationError(
        "customer_name is required for Pautang sales.",
      );
    }
    if (
      paymentMethod === "Complimentary / Gift"
      && (
        promotionCode != null
        || discountType != null
        || cashReceivedCentavos != null
        || tipAmountCentavos > 0
      )
    ) {
      throw new MarketEventOfflineValidationError(
        "Complimentary sales cannot combine promotions, manual discounts, cash tender, or tips.",
      );
    }
    if (
      paymentMethod === "Pautang"
      && (cashReceivedCentavos != null || tipAmountCentavos > 0)
    ) {
      throw new MarketEventOfflineValidationError(
        "Pautang cannot record collected cash or tips.",
      );
    }
    const isCollected = (
      paymentMethod !== "Complimentary / Gift"
      && paymentMethod !== "Pautang"
      && (!isPreorder || preorderPaymentStatus === "Paid")
    );
    if (!isCollected && tipAmountCentavos > 0) {
      throw new MarketEventOfflineValidationError(
        "Tips cannot be recorded on an uncollected sale.",
      );
    }
    if (paymentMethod !== "Cash" && cashReceivedCentavos != null) {
      throw new MarketEventOfflineValidationError(
        "cash_received is only valid for collected Cash sales.",
      );
    }
    if (!isCollected && cashReceivedCentavos != null) {
      throw new MarketEventOfflineValidationError(
        "Uncollected sales cannot record cash_received.",
      );
    }
    return runTransaction(
      [
        EVENT_PACKAGES_STORE,
        PENDING_SALES_STORE,
        CACHED_STOCK_STORE,
        SYNC_METADATA_STORE,
        DEVICE_IDENTITY_STORE,
      ],
      "readwrite",
      async (transaction) => {
        const packagesStore = transaction.objectStore(EVENT_PACKAGES_STORE);
        const salesStore = transaction.objectStore(PENDING_SALES_STORE);
        const stockStore = transaction.objectStore(CACHED_STOCK_STORE);
        const metadataStore = transaction.objectStore(SYNC_METADATA_STORE);
        const deviceStore = transaction.objectStore(DEVICE_IDENTITY_STORE);

        const existingRequest = salesStore.get(clientReference);
        const packageRequest = packagesStore.get(eventId);
        const metadataRequest = metadataStore.get(eventId);
        const unresolvedCountRequest = salesStore.index("event_id").getAll(eventId);
        const deviceIdentityRequest = deviceStore.get(PRIMARY_DEVICE_IDENTITY_KEY);
        const stockRequests = items.map((item) => stockStore.get([eventId, item.sku]));

        const [
          existing,
          packageRecord,
          metadata,
          existingEventSales,
          deviceIdentity,
          ...stockRows
        ] = await Promise.all([
          requestToPromise(existingRequest),
          requestToPromise(packageRequest),
          requestToPromise(metadataRequest),
          requestToPromise(unresolvedCountRequest),
          requestToPromise(deviceIdentityRequest),
          ...stockRequests.map(requestToPromise),
        ]) as [
          PendingMarketSaleV1 | undefined,
          StoredMarketEventPackageV1 | undefined,
          MarketEventSyncMetadataV1 | undefined,
          PendingMarketSaleV1[],
          MarketEventOfflineDeviceIdentityV1 | undefined,
          ...Array<CachedMarketEventStockV1 | undefined>,
        ];

        if (
          !deviceIdentity
          || deviceIdentity.schema_version !== MARKET_EVENT_OFFLINE_SCHEMA_VERSION
        ) {
          throw new MarketEventOfflineDbError(
            "device_identity_missing",
            "Create this cashier device identity before recording an offline sale.",
          );
        }
        const persistedDeviceId = normalizeDeviceId(deviceIdentity.device_id);
        if (
          (existing && normalizeDeviceId(existing.device_id) !== persistedDeviceId)
          || (packageRecord && normalizeDeviceId(packageRecord.device_id) !== persistedDeviceId)
        ) {
          throw new MarketEventOfflineDbError(
            "device_identity_mismatch",
            "This event package or sale belongs to another cashier device.",
          );
        }

        const cashierUsername = packageRecord?.cashier.username
          ?? existing?.cashier_username
          ?? null;
        const deviceId = packageRecord?.device_id ?? existing?.device_id ?? null;
        const fingerprint = saleFingerprint({
          event_id: eventId,
          client_reference: clientReference,
          payment_method: paymentMethod,
          items,
          expected_subtotal_centavos: expectedSubtotalCentavos,
          promotion_code: promotionCode,
          discount_type: discountType,
          discount_value: discountValue,
          tip_amount_centavos: tipAmountCentavos,
          cash_received_centavos: cashReceivedCentavos,
          payment_reference: paymentReference,
          customer_name: customerName,
          cashier_username: cashierUsername,
          device_id: deviceId,
          is_preorder: isPreorder,
          preorder_customer_name: preorderCustomerName,
          preorder_payment_status: preorderPaymentStatus,
          preorder_fulfillment_status: preorderFulfillmentStatus,
        });

        if (existing) {
          if (existing.request_fingerprint !== fingerprint) {
            throw new MarketEventOfflineDbError(
              "client_reference_conflict",
              "This client reference already belongs to a different local sale.",
            );
          }
          return {
            sale: existing,
            stock: stockRows.filter(
              (row): row is CachedMarketEventStockV1 => Boolean(row),
            ),
            created: false,
          };
        }

        if (!packageRecord) {
          throw new MarketEventOfflineDbError(
            "event_package_missing",
            "Download this active event before recording offline sales.",
          );
        }
        if (packageRecord.event.status.trim().toLowerCase() !== "active") {
          throw new MarketEventOfflineDbError(
            "event_not_active",
            "Offline sales can only be recorded against an active event package.",
          );
        }
        if (
          new Date(packageRecord.expires_at).getTime() <= now().getTime()
        ) {
          throw new MarketEventOfflineDbError(
            "event_package_expired",
            "This event package has expired. Reconnect and refresh it before selling.",
          );
        }

        const currentTimestamp = nowIso();
        const updatedStock: CachedMarketEventStockV1[] = [];
        const saleItems: PendingMarketSaleItemV1[] = [];
        let subtotalAmountCentavos = 0;

        items.forEach((item, index) => {
          const stock = stockRows[index];
          if (!stock) {
            throw new MarketEventOfflineDbError(
              "cached_stock_missing",
              `No cached event stock exists for ${item.sku}.`,
            );
          }
          if (stock.available_quantity < item.quantity) {
            throw new MarketEventOfflineStockError(
              item.sku,
              item.quantity,
              stock.available_quantity,
            );
          }

          const lineTotalCentavos = stock.unit_price_centavos * item.quantity;
          if (!Number.isSafeInteger(lineTotalCentavos)) {
            throw new MarketEventOfflineValidationError(
              `Calculated line total for ${item.sku} is too large.`,
            );
          }
          subtotalAmountCentavos += lineTotalCentavos;
          if (!Number.isSafeInteger(subtotalAmountCentavos)) {
            throw new MarketEventOfflineValidationError("Calculated sale total is too large.");
          }

          saleItems.push({
            sku: item.sku,
            quantity: item.quantity,
            product_name: stock.product_name,
            category: stock.category,
            size: stock.size,
            price_snapshot_centavos: stock.unit_price_centavos,
            line_total_centavos: lineTotalCentavos,
          });
          updatedStock.push({
            ...stock,
            available_quantity: stock.available_quantity - item.quantity,
            pending_quantity: stock.pending_quantity + item.quantity,
            updated_at: currentTimestamp,
          });
        });

        if (subtotalAmountCentavos !== expectedSubtotalCentavos) {
          throw new MarketEventOfflineDbError(
            "sale_subtotal_mismatch",
            `The cached catalog subtotal changed from ${centavosToAmount(expectedSubtotalCentavos).toFixed(2)} to ${centavosToAmount(subtotalAmountCentavos).toFixed(2)}. Refresh the event package before checkout.`,
          );
        }

        let persistedPromotionCode: MarketEventPromotionCode | "COMPLIMENTARY" | null = promotionCode;
        let promotionDiscountCentavos = calculatePromotionDiscountCentavos(
          promotionCode,
          saleItems,
        );
        const remainingAfterPromotion = Math.max(
          0,
          subtotalAmountCentavos - promotionDiscountCentavos,
        );
        let manualDiscountCentavos = 0;
        if (discountType === "PERCENTAGE" && Number(discountValue) > 0) {
          manualDiscountCentavos = Math.round(
            (remainingAfterPromotion * Number(discountValue)) / 100,
          );
        } else if (discountType === "FIXED" && Number(discountValue) > 0) {
          manualDiscountCentavos = Math.min(
            remainingAfterPromotion,
            amountToCentavos(Number(discountValue), "discount_value"),
          );
        }
        let discountAmountCentavos = Math.min(
          subtotalAmountCentavos,
          promotionDiscountCentavos + manualDiscountCentavos,
        );
        let netTotalAmountCentavos = Math.max(
          0,
          subtotalAmountCentavos - discountAmountCentavos,
        );
        if (paymentMethod === "Complimentary / Gift") {
          persistedPromotionCode = "COMPLIMENTARY";
          promotionDiscountCentavos = subtotalAmountCentavos;
          manualDiscountCentavos = 0;
          discountAmountCentavos = subtotalAmountCentavos;
          netTotalAmountCentavos = 0;
        }

        const collectsCash = paymentMethod === "Cash" && isCollected;
        const requiredCashCentavos = netTotalAmountCentavos + tipAmountCentavos;
        if (
          collectsCash
          && (cashReceivedCentavos == null || cashReceivedCentavos < requiredCashCentavos)
        ) {
          throw new MarketEventOfflineValidationError(
            "Cash received must cover the locally calculated sale total and tip.",
          );
        }

        const deliveryUncertain = Boolean(input.delivery_uncertain);
        const sale: PendingMarketSaleV1 = {
          schema_version: MARKET_EVENT_OFFLINE_SCHEMA_VERSION,
          client_reference: clientReference,
          event_id: eventId,
          status: "pending",
          payment_method: paymentMethod,
          items: saleItems,
          subtotal_amount_centavos: subtotalAmountCentavos,
          promotion_code: persistedPromotionCode,
          promotion_discount_amount_centavos: promotionDiscountCentavos,
          discount_type: discountType,
          discount_value: discountValue,
          manual_discount_amount_centavos: manualDiscountCentavos,
          discount_amount_centavos: discountAmountCentavos,
          total_amount_centavos: netTotalAmountCentavos,
          tip_amount_centavos: tipAmountCentavos,
          cash_received_centavos: collectsCash ? cashReceivedCentavos : null,
          change_given_centavos: collectsCash && cashReceivedCentavos != null
            ? cashReceivedCentavos - requiredCashCentavos
            : 0,
          payment_reference: paymentReference,
          customer_name: customerName,
          is_collected: isCollected,
          cashier_username: packageRecord.cashier.username,
          device_id: packageRecord.device_id,
          is_preorder: isPreorder,
          preorder_customer_name: preorderCustomerName,
          preorder_payment_status: preorderPaymentStatus,
          preorder_fulfillment_status: preorderFulfillmentStatus,
          delivery_uncertain: deliveryUncertain,
          sync_attempt_count: deliveryUncertain ? 1 : 0,
          last_sync_attempt_at: deliveryUncertain ? currentTimestamp : null,
          last_error_code: deliveryUncertain ? "unconfirmed_online_attempt" : null,
          last_error_message: deliveryUncertain
            ? "The initial online request did not return a definitive response."
            : null,
          server_sale_id: null,
          created_at: currentTimestamp,
          updated_at: currentTimestamp,
          synced_at: null,
          voided_at: null,
          request_fingerprint: fingerprint,
        };

        updatedStock.forEach((stock) => stockStore.put(stock));
        salesStore.add(sale);
        const summary = summarizeEventSales(
          [...existingEventSales, sale],
          metadata?.last_synced_at ? "synced" : "ready",
        );
        metadataStore.put({
          schema_version: MARKET_EVENT_OFFLINE_SCHEMA_VERSION,
          event_id: eventId,
          source_revision: packageRecord.source_revision,
          package_cached_at: metadata?.package_cached_at ?? packageRecord.cached_at,
          last_synced_at: metadata?.last_synced_at ?? null,
          last_sync_attempt_at: deliveryUncertain
            ? currentTimestamp
            : metadata?.last_sync_attempt_at ?? null,
          sync_state: summary.sync_state,
          pending_sale_count: summary.pending_sale_count,
          server_cursor: metadata?.server_cursor ?? null,
          last_error_code: summary.last_error_code,
          last_error_message: summary.last_error_message,
        } satisfies MarketEventSyncMetadataV1);

        return { sale, stock: updatedStock, created: true };
      },
    );
  }

  async function getSale(
    clientReferenceInput: string,
  ): Promise<PendingMarketSaleV1 | null> {
    const clientReference = normalizeClientReference(clientReferenceInput);
    return runTransaction([PENDING_SALES_STORE], "readonly", async (transaction) => {
      const sale = await requestToPromise(
        transaction.objectStore(PENDING_SALES_STORE).get(clientReference),
      ) as PendingMarketSaleV1 | undefined;
      return sale ?? null;
    });
  }

  async function listUnresolvedSales(eventIdInput?: number): Promise<PendingMarketSaleV1[]> {
    const eventId = eventIdInput == null
      ? null
      : normalizePositiveId(eventIdInput, "event_id");
    return runTransaction([PENDING_SALES_STORE], "readonly", async (transaction) => {
      const store = transaction.objectStore(PENDING_SALES_STORE);
      const request = eventId == null ? store.getAll() : store.index("event_id").getAll(eventId);
      const sales = await requestToPromise(request) as PendingMarketSaleV1[];
      return sales.filter(isUnresolvedSale).sort(compareSales);
    });
  }

  async function listReplayableSales(eventIdInput?: number): Promise<PendingMarketSaleV1[]> {
    const sales = await listUnresolvedSales(eventIdInput);
    return sales.filter((sale) => (
      REPLAYABLE_SALE_STATUSES.has(sale.status) && !sale.delivery_uncertain
    ));
  }

  async function updateSaleSyncStatus(
    clientReferenceInput: string,
    nextStatus: "syncing" | "failed" | "requires_review",
    error?: { code?: string | null; message?: string | null },
    authenticatedCashierUsername?: string,
    authenticatedDeviceId?: string,
  ): Promise<PendingMarketSaleV1> {
    const clientReference = normalizeClientReference(clientReferenceInput);
    const errorCode = normalizeString(error?.code, "error code", { max_length: 100 });
    const errorMessage = normalizeOptionalError(error?.message);

    return runTransaction(
      [PENDING_SALES_STORE, SYNC_METADATA_STORE, DEVICE_IDENTITY_STORE],
      "readwrite",
      async (transaction) => {
        const salesStore = transaction.objectStore(PENDING_SALES_STORE);
        const metadataStore = transaction.objectStore(SYNC_METADATA_STORE);
        const deviceStore = transaction.objectStore(DEVICE_IDENTITY_STORE);
        const saleRequest = salesStore.get(clientReference);
        const deviceIdentityRequest = deviceStore.get(PRIMARY_DEVICE_IDENTITY_KEY);
        const [sale, deviceIdentity] = await Promise.all([
          requestToPromise(saleRequest),
          requestToPromise(deviceIdentityRequest),
        ]) as [
          PendingMarketSaleV1 | undefined,
          MarketEventOfflineDeviceIdentityV1 | undefined,
        ];
        if (!sale) {
          throw new MarketEventOfflineDbError("sale_not_found", "Pending local sale not found.");
        }
        if (!isUnresolvedSale(sale)) {
          throw new MarketEventOfflineDbError(
            "sale_already_finalized",
            `Cannot move a ${sale.status} sale back into the sync queue.`,
          );
        }
        const transitionAllowed = nextStatus === "syncing"
          ? REPLAYABLE_SALE_STATUSES.has(sale.status)
          : nextStatus === "failed"
            ? sale.status === "syncing" || sale.status === "failed"
            : true;
        if (!transitionAllowed) {
          throw new MarketEventOfflineDbError(
            "invalid_sync_transition",
            `A ${sale.status} sale cannot transition to ${nextStatus}.`,
          );
        }
        if (nextStatus === "syncing") {
          const authenticatedCashier = normalizeString(
            authenticatedCashierUsername,
            "authenticated cashier username",
            { required: true, max_length: 100 },
          ) as string;
          if (authenticatedCashier !== sale.cashier_username) {
            throw new MarketEventOfflineDbError(
              "cashier_session_mismatch",
              "Sign in as the cashier who captured this sale before synchronizing it.",
            );
          }
          const authenticatedDevice = normalizeDeviceId(authenticatedDeviceId);
          if (
            !deviceIdentity
            || deviceIdentity.schema_version !== MARKET_EVENT_OFFLINE_SCHEMA_VERSION
            || normalizeDeviceId(deviceIdentity.device_id) !== authenticatedDevice
            || normalizeDeviceId(sale.device_id) !== authenticatedDevice
          ) {
            throw new MarketEventOfflineDbError(
              "device_identity_mismatch",
              "Synchronize this sale from the cashier device that captured it.",
            );
          }
        }

        const metadataRequest = metadataStore.get(sale.event_id);
        const eventSalesRequest = salesStore.index("event_id").getAll(sale.event_id);
        const [metadata, eventSales] = await Promise.all([
          requestToPromise(metadataRequest),
          requestToPromise(eventSalesRequest),
        ]) as [MarketEventSyncMetadataV1 | undefined, PendingMarketSaleV1[]];
        const currentTimestamp = nowIso();
        const isAttempt = nextStatus === "syncing";
        const responseIsUncertain = (
          errorCode === "unconfirmed_delivery"
          || errorCode === "server_receipt_mismatch"
        );
        const updatedSale: PendingMarketSaleV1 = {
          ...sale,
          status: nextStatus,
          delivery_uncertain: sale.delivery_uncertain || responseIsUncertain,
          sync_attempt_count: sale.sync_attempt_count + (isAttempt ? 1 : 0),
          last_sync_attempt_at: isAttempt ? currentTimestamp : sale.last_sync_attempt_at,
          last_error_code: nextStatus === "syncing" ? null : errorCode,
          last_error_message: nextStatus === "syncing" ? null : errorMessage,
          updated_at: currentTimestamp,
        };
        salesStore.put(updatedSale);

        const summary = summarizeEventSales(
          eventSales.map((eventSale) => (
            eventSale.client_reference === updatedSale.client_reference
              ? updatedSale
              : eventSale
          )),
          metadata?.last_synced_at ? "synced" : "ready",
        );

        metadataStore.put({
          schema_version: MARKET_EVENT_OFFLINE_SCHEMA_VERSION,
          event_id: sale.event_id,
          source_revision: metadata?.source_revision ?? "unknown",
          package_cached_at: metadata?.package_cached_at ?? currentTimestamp,
          last_synced_at: metadata?.last_synced_at ?? null,
          last_sync_attempt_at: isAttempt
            ? currentTimestamp
            : metadata?.last_sync_attempt_at ?? sale.last_sync_attempt_at,
          sync_state: summary.sync_state,
          pending_sale_count: summary.pending_sale_count,
          server_cursor: metadata?.server_cursor ?? null,
          last_error_code: summary.last_error_code,
          last_error_message: summary.last_error_message,
        } satisfies MarketEventSyncMetadataV1);

        return updatedSale;
      },
    );
  }

  async function voidLocalSale(
    clientReferenceInput: string,
    options: {
      definitive_server_rejection?: boolean;
      error_code?: string | null;
      error_message?: string | null;
    } = {},
  ): Promise<OfflineSaleMutationResult> {
    const clientReference = normalizeClientReference(clientReferenceInput);
    const rejectionErrorCode = normalizeString(
      options.error_code,
      "error_code",
      { max_length: 100 },
    );
    const rejectionErrorMessage = normalizeOptionalError(options.error_message);

    return runTransaction(
      [
        PENDING_SALES_STORE,
        CACHED_STOCK_STORE,
        SYNC_METADATA_STORE,
        DEVICE_IDENTITY_STORE,
      ],
      "readwrite",
      async (transaction) => {
        const salesStore = transaction.objectStore(PENDING_SALES_STORE);
        const stockStore = transaction.objectStore(CACHED_STOCK_STORE);
        const metadataStore = transaction.objectStore(SYNC_METADATA_STORE);
        const deviceStore = transaction.objectStore(DEVICE_IDENTITY_STORE);
        const saleRequest = salesStore.get(clientReference);
        const deviceIdentityRequest = deviceStore.get(PRIMARY_DEVICE_IDENTITY_KEY);
        const [sale, deviceIdentity] = await Promise.all([
          requestToPromise(saleRequest),
          requestToPromise(deviceIdentityRequest),
        ]) as [
          PendingMarketSaleV1 | undefined,
          MarketEventOfflineDeviceIdentityV1 | undefined,
        ];
        if (!sale) {
          throw new MarketEventOfflineDbError("sale_not_found", "Pending local sale not found.");
        }
        if (
          !deviceIdentity
          || deviceIdentity.schema_version !== MARKET_EVENT_OFFLINE_SCHEMA_VERSION
          || normalizeDeviceId(deviceIdentity.device_id) !== normalizeDeviceId(sale.device_id)
        ) {
          throw new MarketEventOfflineDbError(
            "device_identity_mismatch",
            "Void this sale from the cashier device that captured it.",
          );
        }
        if (sale.status === "voided") {
          return { sale, stock: [], created: false };
        }
        if (sale.status === "synced") {
          throw new MarketEventOfflineDbError(
            "online_void_required",
            "This sale is already synced and must be voided through the server.",
          );
        }
        const safeUnsyncedVoid = (
          sale.status === "pending"
          && sale.sync_attempt_count === 0
          && !sale.delivery_uncertain
        );
        const safeRejectedVoid = (
          options.definitive_server_rejection === true
          && sale.status === "syncing"
          && sale.sync_attempt_count > 0
          && !sale.delivery_uncertain
        );
        if (!safeUnsyncedVoid && !safeRejectedVoid) {
          throw new MarketEventOfflineDbError(
            "unsafe_local_void",
            "This sale may have reached the server. Reconnect and reconcile it before voiding.",
          );
        }

        const metadataRequest = metadataStore.get(sale.event_id);
        const eventSalesRequest = salesStore.index("event_id").getAll(sale.event_id);
        const stockRequests = sale.items.map((item) => (
          stockStore.get([sale.event_id, item.sku])
        ));
        const [metadata, eventSales, ...stockRows] = await Promise.all([
          requestToPromise(metadataRequest),
          requestToPromise(eventSalesRequest),
          ...stockRequests.map(requestToPromise),
        ]) as [
          MarketEventSyncMetadataV1 | undefined,
          PendingMarketSaleV1[],
          ...Array<CachedMarketEventStockV1 | undefined>,
        ];

        const currentTimestamp = nowIso();
        const restoredStock = sale.items.map((item, index) => {
          const stock = stockRows[index];
          if (!stock || stock.pending_quantity < item.quantity) {
            throw new MarketEventOfflineDbError(
              "offline_stock_invariant_failed",
              `Cached stock for ${item.sku} cannot safely restore this sale.`,
            );
          }
          const availableQuantity = stock.available_quantity + item.quantity;
          const pendingQuantity = stock.pending_quantity - item.quantity;
          if (availableQuantity + pendingQuantity !== stock.server_quantity) {
            throw new MarketEventOfflineDbError(
              "offline_stock_invariant_failed",
              `Cached stock totals for ${item.sku} are inconsistent.`,
            );
          }
          return {
            ...stock,
            available_quantity: availableQuantity,
            pending_quantity: pendingQuantity,
            updated_at: currentTimestamp,
          };
        });

        const updatedSale: PendingMarketSaleV1 = {
          ...sale,
          status: "voided",
          delivery_uncertain: false,
          voided_at: currentTimestamp,
          updated_at: currentTimestamp,
          last_error_code: safeRejectedVoid
            ? rejectionErrorCode ?? "server_rejected_sale"
            : null,
          last_error_message: safeRejectedVoid ? rejectionErrorMessage : null,
        };
        restoredStock.forEach((stock) => stockStore.put(stock));
        salesStore.put(updatedSale);

        const summary = summarizeEventSales(
          eventSales.map((eventSale) => (
            eventSale.client_reference === updatedSale.client_reference
              ? updatedSale
              : eventSale
          )),
          metadata?.last_synced_at ? "synced" : "ready",
        );
        metadataStore.put({
          schema_version: MARKET_EVENT_OFFLINE_SCHEMA_VERSION,
          event_id: sale.event_id,
          source_revision: metadata?.source_revision ?? "unknown",
          package_cached_at: metadata?.package_cached_at ?? currentTimestamp,
          last_synced_at: metadata?.last_synced_at ?? null,
          last_sync_attempt_at: metadata?.last_sync_attempt_at ?? null,
          sync_state: summary.sync_state,
          pending_sale_count: summary.pending_sale_count,
          server_cursor: metadata?.server_cursor ?? null,
          last_error_code: summary.last_error_code,
          last_error_message: summary.last_error_message,
        } satisfies MarketEventSyncMetadataV1);

        return { sale: updatedSale, stock: restoredStock, created: false };
      },
    );
  }

  async function acknowledgeSyncedSale(
    clientReferenceInput: string,
    result: SyncedMarketSaleReceiptV1,
  ): Promise<OfflineSaleMutationResult> {
    const clientReference = normalizeClientReference(clientReferenceInput);
    const serverSaleId = normalizePositiveId(result.server_sale_id, "server_sale_id");
    const serverEventId = normalizePositiveId(result.event_id, "server event_id");
    const serverCashierUsername = normalizeString(
      result.cashier_username,
      "server cashier_username",
      { required: true, max_length: 100 },
    ) as string;
    const serverPaymentMethod = normalizeEnum(
      result.payment_method,
      MARKET_EVENT_PAYMENT_METHODS,
      "server payment_method",
    );
    const serverItems = normalizeSyncedSaleReceiptItems(result.items);
    const serverSubtotalCentavos = amountToCentavos(
      result.subtotal_amount,
      "server subtotal_amount",
    );
    const serverPromotionCode = result.promotion_code == null
      ? null
      : normalizeEnum(
        result.promotion_code,
        [...MARKET_EVENT_PROMOTION_CODES, "COMPLIMENTARY"] as const,
        "server promotion_code",
      );
    const serverPromotionDiscountCentavos = amountToCentavos(
      result.promotion_discount_amount,
      "server promotion_discount_amount",
    );
    const serverDiscountType = result.discount_type == null
      ? null
      : normalizeEnum(
        result.discount_type,
        ["PERCENTAGE", "FIXED"] as const,
        "server discount_type",
      );
    const serverDiscountValue = result.discount_value == null
      ? null
      : centavosToAmount(
        amountToCentavos(result.discount_value, "server discount_value"),
      );
    const serverManualDiscountCentavos = amountToCentavos(
      result.manual_discount_amount,
      "server manual_discount_amount",
    );
    const serverDiscountCentavos = amountToCentavos(
      result.discount_amount,
      "server discount_amount",
    );
    const serverTotalCentavos = amountToCentavos(result.total_amount, "server total_amount");
    const serverTipCentavos = amountToCentavos(result.tip_amount, "server tip_amount");
    const serverCashReceivedCentavos = result.cash_received == null
      ? null
      : amountToCentavos(result.cash_received, "server cash_received");
    const serverChangeGivenCentavos = amountToCentavos(
      result.change_given,
      "server change_given",
    );
    const serverPaymentReference = normalizeString(
      result.payment_reference,
      "server payment_reference",
      { max_length: 100 },
    );
    const serverCustomerName = normalizeString(
      result.customer_name,
      "server customer_name",
      { max_length: 255 },
    );
    if (typeof result.is_collected !== "boolean") {
      throw new MarketEventOfflineValidationError(
        "server is_collected must be a boolean.",
      );
    }
    if (typeof result.is_preorder !== "boolean") {
      throw new MarketEventOfflineValidationError("server is_preorder must be a boolean.");
    }
    const serverPreorderCustomerName = result.is_preorder
      ? normalizeString(
        result.preorder_customer_name,
        "server preorder_customer_name",
        { required: true, max_length: 255 },
      )
      : null;
    const serverPreorderPaymentStatus = result.is_preorder
      ? normalizeEnum(
        result.preorder_payment_status,
        ["Paid", "Unpaid"] as const,
        "server preorder_payment_status",
      )
      : null;
    const serverPreorderFulfillmentStatus = result.is_preorder
      ? normalizeEnum(
        result.preorder_fulfillment_status,
        ["Pending", "Picked Up"] as const,
        "server preorder_fulfillment_status",
      )
      : null;
    const syncedAt = normalizeIsoTimestamp(result.server_timestamp, "server_timestamp");

    return runTransaction(
      [PENDING_SALES_STORE, CACHED_STOCK_STORE, SYNC_METADATA_STORE],
      "readwrite",
      async (transaction) => {
        const salesStore = transaction.objectStore(PENDING_SALES_STORE);
        const stockStore = transaction.objectStore(CACHED_STOCK_STORE);
        const metadataStore = transaction.objectStore(SYNC_METADATA_STORE);
        const saleRequest = salesStore.get(clientReference);
        const sale = await requestToPromise(saleRequest) as PendingMarketSaleV1 | undefined;
        if (!sale) {
          throw new MarketEventOfflineDbError("sale_not_found", "Pending local sale not found.");
        }
        const localItems = sale.items
          .map((item) => ({
            sku: item.sku,
            quantity: item.quantity,
            price_snapshot_centavos: item.price_snapshot_centavos,
          }))
          .sort((left, right) => left.sku.localeCompare(right.sku));
        const localSubtotalCentavos = Number.isSafeInteger(
          sale.subtotal_amount_centavos,
        )
          ? sale.subtotal_amount_centavos
          : sale.items.reduce((sum, item) => sum + item.line_total_centavos, 0);
        const localDiscountCentavos = Number.isSafeInteger(
          sale.discount_amount_centavos,
        )
          ? sale.discount_amount_centavos
          : Math.max(0, localSubtotalCentavos - sale.total_amount_centavos);
        const localPromotionCode = sale.promotion_code
          ?? (sale.payment_method === "Complimentary / Gift"
            ? "COMPLIMENTARY"
            : null);
        const localPromotionDiscountCentavos = Number.isSafeInteger(
          sale.promotion_discount_amount_centavos,
        )
          ? sale.promotion_discount_amount_centavos
          : localPromotionCode === "COMPLIMENTARY"
            ? localSubtotalCentavos
            : 0;
        const localDiscountType = sale.discount_type
          ?? (
            localPromotionCode == null && localDiscountCentavos > 0
              ? "FIXED"
              : null
          );
        const localDiscountValue = sale.discount_value
          ?? (
            localDiscountType === "FIXED"
              ? centavosToAmount(localDiscountCentavos)
              : null
          );
        const localManualDiscountCentavos = Number.isSafeInteger(
          sale.manual_discount_amount_centavos,
        )
          ? sale.manual_discount_amount_centavos
          : Math.max(0, localDiscountCentavos - localPromotionDiscountCentavos);
        const localTipCentavos = sale.tip_amount_centavos ?? 0;
        const localCustomerName = sale.customer_name ?? sale.preorder_customer_name ?? null;
        const localIsCollected = typeof sale.is_collected === "boolean"
          ? sale.is_collected
          : (
            sale.payment_method !== "Complimentary / Gift"
            && sale.payment_method !== "Pautang"
            && (!sale.is_preorder || sale.preorder_payment_status === "Paid")
          );
        const receiptMatches = (
          serverEventId === sale.event_id
          && serverCashierUsername === sale.cashier_username
          && serverPaymentMethod === sale.payment_method
          && serverSubtotalCentavos === localSubtotalCentavos
          && serverPromotionCode === localPromotionCode
          && serverPromotionDiscountCentavos === localPromotionDiscountCentavos
          && serverDiscountType === localDiscountType
          && serverDiscountValue === localDiscountValue
          && serverManualDiscountCentavos === localManualDiscountCentavos
          && serverDiscountCentavos === localDiscountCentavos
          && serverTotalCentavos === sale.total_amount_centavos
          && serverTipCentavos === localTipCentavos
          && serverCashReceivedCentavos === sale.cash_received_centavos
          && serverChangeGivenCentavos === sale.change_given_centavos
          && serverPaymentReference === sale.payment_reference
          && serverCustomerName === localCustomerName
          && result.is_collected === localIsCollected
          && result.is_preorder === sale.is_preorder
          && serverPreorderCustomerName === sale.preorder_customer_name
          && serverPreorderPaymentStatus === sale.preorder_payment_status
          && serverPreorderFulfillmentStatus === sale.preorder_fulfillment_status
          && JSON.stringify(serverItems) === JSON.stringify(localItems)
        );
        if (sale.status === "synced") {
          if (sale.server_sale_id !== serverSaleId || !receiptMatches) {
            throw new MarketEventOfflineDbError(
              "server_sale_conflict",
              "This client reference was acknowledged with another server sale.",
            );
          }
          return { sale, stock: [], created: false };
        }
        if (sale.status === "voided") {
          throw new MarketEventOfflineDbError(
            "voided_sale_acknowledged",
            "A locally voided sale cannot be marked as synced.",
          );
        }
        if (sale.status !== "syncing") {
          throw new MarketEventOfflineDbError(
            "sale_not_claimed_for_sync",
            "Mark the sale as syncing before sending it to the server.",
          );
        }
        if (!receiptMatches) {
          throw new MarketEventOfflineDbError(
            "server_sale_mismatch",
            "The server receipt does not match the queued sale; manual review is required.",
          );
        }

        const metadataRequest = metadataStore.get(sale.event_id);
        const eventSalesRequest = salesStore.index("event_id").getAll(sale.event_id);
        const stockRequests = sale.items.map((item) => (
          stockStore.get([sale.event_id, item.sku])
        ));
        const [metadata, eventSales, ...stockRows] = await Promise.all([
          requestToPromise(metadataRequest),
          requestToPromise(eventSalesRequest),
          ...stockRequests.map(requestToPromise),
        ]) as [
          MarketEventSyncMetadataV1 | undefined,
          PendingMarketSaleV1[],
          ...Array<CachedMarketEventStockV1 | undefined>,
        ];

        const updatedStock = sale.items.map((item, index) => {
          const stock = stockRows[index];
          if (
            !stock
            || stock.pending_quantity < item.quantity
            || stock.server_quantity < item.quantity
          ) {
            throw new MarketEventOfflineDbError(
              "offline_stock_invariant_failed",
              `Cached stock for ${item.sku} cannot acknowledge this sale safely.`,
            );
          }
          const updated: CachedMarketEventStockV1 = {
            ...stock,
            server_quantity: stock.server_quantity - item.quantity,
            pending_quantity: stock.pending_quantity - item.quantity,
            updated_at: syncedAt,
          };
          if (
            updated.available_quantity + updated.pending_quantity
            !== updated.server_quantity
          ) {
            throw new MarketEventOfflineDbError(
              "offline_stock_invariant_failed",
              `Cached stock totals for ${item.sku} are inconsistent after sync.`,
            );
          }
          return updated;
        });

        const updatedSale: PendingMarketSaleV1 = {
          ...sale,
          status: "synced",
          delivery_uncertain: false,
          server_sale_id: serverSaleId,
          synced_at: syncedAt,
          updated_at: syncedAt,
          last_error_code: null,
          last_error_message: null,
        };
        updatedStock.forEach((stock) => stockStore.put(stock));
        salesStore.put(updatedSale);

        const summary = summarizeEventSales(
          eventSales.map((eventSale) => (
            eventSale.client_reference === updatedSale.client_reference
              ? updatedSale
              : eventSale
          )),
          "synced",
        );
        metadataStore.put({
          schema_version: MARKET_EVENT_OFFLINE_SCHEMA_VERSION,
          event_id: sale.event_id,
          source_revision: metadata?.source_revision ?? "unknown",
          package_cached_at: metadata?.package_cached_at ?? syncedAt,
          last_synced_at: syncedAt,
          last_sync_attempt_at: metadata?.last_sync_attempt_at ?? sale.last_sync_attempt_at,
          sync_state: summary.sync_state,
          pending_sale_count: summary.pending_sale_count,
          server_cursor: metadata?.server_cursor ?? null,
          last_error_code: summary.last_error_code,
          last_error_message: summary.last_error_message,
        } satisfies MarketEventSyncMetadataV1);

        return { sale: updatedSale, stock: updatedStock, created: false };
      },
    );
  }

  async function markSaleSyncing(
    clientReference: string,
    authenticatedCashierUsername: string,
    authenticatedDeviceId: string,
  ): Promise<PendingMarketSaleV1> {
    return updateSaleSyncStatus(
      clientReference,
      "syncing",
      undefined,
      authenticatedCashierUsername,
      authenticatedDeviceId,
    );
  }

  async function markSaleFailed(
    clientReference: string,
    error?: { code?: string | null; message?: string | null },
  ): Promise<PendingMarketSaleV1> {
    return updateSaleSyncStatus(clientReference, "failed", error);
  }

  async function markSaleRequiresReview(
    clientReference: string,
    error?: { code?: string | null; message?: string | null },
  ): Promise<PendingMarketSaleV1> {
    return updateSaleSyncStatus(clientReference, "requires_review", error);
  }

  function close(): void {
    if (!databasePromise) return;
    void databasePromise.then((database) => database.close()).catch(() => undefined);
    databasePromise = null;
  }

  return {
    getOrCreateDeviceIdentity,
    cacheEventPackage,
    getEventPackage,
    listEventPackages,
    getCachedStock,
    getSyncMetadata,
    recordLocalSale,
    getSale,
    listUnresolvedSales,
    listReplayableSales,
    markSaleSyncing,
    markSaleFailed,
    markSaleRequiresReview,
    acknowledgeSyncedSale,
    voidLocalSale,
    close,
  };
}

export const marketEventOfflineDb = createMarketEventOfflineDb();
