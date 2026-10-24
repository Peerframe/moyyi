// Member discount: VIP members pay 80% of the price.
export function discount(price, tier) {
  if (tier === "VIP") return price * 0.85;
  return price;
}
