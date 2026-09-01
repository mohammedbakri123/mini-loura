/**
 * Inventory level for a single product. The operational model (Stage 2) keeps
 * this up to date from `inventory.*` events.
 */
export interface InventoryLevel {
  productId: string;
  currentStock: number;
  minimumStock: number;
  updatedAt: string;
}

export function isBelowMinimum(level: InventoryLevel): boolean {
  return level.currentStock < level.minimumStock;
}
