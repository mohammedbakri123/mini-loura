/**
 * Product identity. The operational model (Stage 2) owns the live representation
 * of products; this file only defines the domain shape.
 */
export interface Product {
  id: string;
  sku: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
