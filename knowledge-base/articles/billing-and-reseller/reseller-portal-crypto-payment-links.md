# Category: billing-and-reseller
# Title: Reseller Portal & Crypto Payment Links
# Last Updated: 2026-08-24T18:31:03.740Z

# Reseller Hub & Payment Links

### Reseller Models
- **Zero-Cost Model (`zero_cost`)**: Reseller applies up to 30.00% markup over system base price without owning node inventory.
- **Own Inventory Model (`own_inventory`)**: Reseller owns dedicated node capacity and sets arbitrary custom pricing with 100% payout.

### Generating Payment Links
- Create public checkout links at `/pay/{uuid}` bound to plan specs and target crypto (`USDT`, `SOL`, `BTC`, `LTC`, `ETH`).
- Automated VM provisioning triggers immediately upon blockchain payment confirmation.
