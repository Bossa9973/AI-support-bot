# Reseller Portal & Crypto Payment Links Guide

## 1. What is the Reseller Hub?
The Reseller Hub (`/reseller`) allows authorized partners to sell VPS hosting plans directly to their own customers without managing hardware, billing infrastructure, or daemon software.

---

## 2. Reseller Business Models

### 💡 1. Zero-Cost Model (`zero_cost`)
- **For**: Resellers who want to sell without paying upfront for hardware inventory.
- **Pricing Rule**: The reseller applies a markup percentage on top of the base plan price.
- **Markup Limit**: Strictly capped at **30.00%** to ensure fair pricing.
- **Formula**: `Selling Price = Base Price * (1 + Markup Percent / 100)`
- **Earnings Split**: The system retains the `base_price` for infrastructure and credits the net `markup_amount` directly to the reseller's crypto balance upon client payment.

### 🏢 2. Own Inventory Model (`own_inventory`)
- **For**: Resellers who own dedicated node capacity or wholesale hardware allocations.
- **Pricing Rule**: The reseller defines custom selling prices with no percentage cap.
- **Earnings Split**: **100%** of the checkout price is credited directly to the reseller's crypto balance.

---

## 3. Creating & Sharing Payment Links

1. Navigate to **Reseller Hub → Payment Links → Create Link**.
2. Select:
   - **VPS Plan** (CPU, RAM, Disk specifications).
   - **Target Node** (Location / Region).
   - **OS Template** (Ubuntu 22.04, Debian 12, etc.).
   - **Server Name** (e.g. `Client-VPS-01`).
   - **Cryptocurrency** (`USDT`, `SOL`, `BTC`, `LTC`, `ETH`).
3. The system generates a public checkout URL: `https://yourdomain.com/pay/{uuid}`.
4. Share the URL with your client.

---

## 4. End-Client Checkout Experience
- When the client opens `/pay/{uuid}`, they see a branded checkout page showing hardware specifications and pricing.
- **Payment Gateways**:
  - **NOWPayments / Maxelpay**: Displays a deposit QR code and crypto wallet address.
  - **Local Checkout**: Direct checkout where the client inputs a custom root password.
- **Instant Automated Delivery**: Once payment is verified on the blockchain:
  - The VPS is provisioned automatically within seconds.
  - Server is assigned to the client with a 30-day active term.
  - Reseller's profit is credited immediately to their crypto balance.

---

## 5. Wallet, Balances & Withdrawals

### Balance Structure
- **Total Balance**: Total lifetime earnings.
- **Locked Balance**: Funds currently locked in a pending withdrawal request.
- **Available Balance**: Spendable and withdrawable liquidity pool (`Total - Locked`).

### Requesting a Payout
1. Go to **Reseller Hub → Withdraw**.
2. Enter your crypto wallet address and withdrawal amount.
3. **Minimum Threshold**: Equivalent to **$10 USD** (`USDT`: 10.00, `SOL`: 0.05, `BTC`: 0.0002, `LTC`: 0.15, `ETH`: 0.003).
4. Payout status transitions to `Pending` and is approved by administrators with a blockchain Transaction Hash (`tx_hash`).
