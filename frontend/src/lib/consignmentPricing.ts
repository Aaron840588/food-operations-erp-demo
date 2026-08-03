export function calculateConsignmentUnitPrice(retailPrice: number, discountRate: number): number {
  return Math.round(retailPrice * (1 - discountRate));
}
