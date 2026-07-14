# H+H Food System: Business Rules Catalog

This catalog documents the mathematical calculations, billing algorithms, and inventory validation guardrails implemented in the system codebase.

---

## 🍳 1. Recipe Costing & Margin Calculations
The costing engine computes finished product costs dynamically using recursive recipe models:

$$\text{Unit Cost} = \text{Unit Food Cost} + \text{Unit Packaging Cost} + \text{Allocated Overhead} + \text{Unit Labor Cost}$$

### Calculations Breakdown:
1. **Unit Food Cost**: Recursive DFS resolution. If an ingredient is a sub-recipe SKU (e.g. Yema Spread used in sandwiches), the engine computes that sub-recipe's **raw edible cost per gram** first (excluding its jar/label packaging), preventing packaging cost propagation inside parent recipes.
2. **Packaging Cost**: Compounds standard packing configurations (e.g. jars + labels + seals) dynamically at the final product level.
3. **Overhead & Labor Allocation**: 
   * Product-specific utility and labor overheads are loaded directly from database columns (`labor_cost` and `utility_cost`) configured per-SKU. This allows exact spreadsheet figures (e.g. ₱22.50 labor for Yema 240g Spread vs ₱0.00 labor for Sandwiches/Pastries, with a flat ₱3.28 utility overhead) to persist natively.
   * If empty, they fall back to the monthly allocated overhead divided by target monthly portions count for each product category:
     $$\text{Overhead Per Portion} = \frac{\text{Monthly Overhead}}{\text{Target Portion Count}}$$
4. **Labor Cost**: Derived from batch labor cost divided by portions produced.
5. **Margins**:
   * **Gross Margin %**: $\frac{\text{Reseller Price} - \text{Unit Food Cost} - \text{Unit Packaging Cost}}{\text{Reseller Price}} \times 100\%$
   * **Net Margin %**: $\frac{\text{Retail Price} - \text{Unit Cost}}{\text{Retail Price}} \times 100\%$

---

## 💵 2. Reseller Tiered Discounts & Tax Billing
Tiered volume discount percentages are dynamically applied to reseller order subtotals:

| Subtotal Threshold | Discount Percentage |
| :--- | :--- |
| $\text{Subtotal} < ₱1,300.00$ | $10\%$ |
| $₱1,300.00 \le \text{Subtotal} < ₱2,000.00$ | $12\%$ |
| $₱2,000.00 \le \text{Subtotal} < ₱3,500.00$ | $15\%$ |
| $₱3,500.00 \le \text{Subtotal} < ₱7,000.00$ | $18\%$ |
| $\text{Subtotal} \ge ₱7,000.00$ | $22\%$ |

### Manual Overrides
* Owners may explicitly apply a validated manual discount from `0%` to `100%`. Notes are descriptive only and never alter invoice pricing.

### Tax Calculations
* Order taxation calculates VAT (default `12.0%`, validated from `0%` to `100%`) on the discounted subtotal:
  $$\text{Tax Amount} = (\text{Subtotal} - \text{Discount Amount}) \times 0.12$$
  $$\text{Grand Total} = \text{Subtotal} - \text{Discount Amount} + \text{Tax Amount}$$

---

## 📦 3. Warehouse Stock & Production Guards
1. **Production Completion checks**:
   * Before marking a production plan as completed, the backend explodes SKU recipes into aggregate raw ingredients requirements.
   * If any ingredient's available stock is less than the required amount:
     $$\text{Deficit} = \text{Amount Needed} - \text{Available Stock}$$
     The system blocks plan completion and raises `HTTP 400 Bad Request` listing all deficient items.
2. **Consignment Waste Write-offs**:
   * When expired consignment items are pulled back from B2B partners, the delta change is written off to `inventory_transactions` under type `"waste"`.

---

This rules catalog documents all mathematical equations and operational guardrails to prevent pricing errors.
