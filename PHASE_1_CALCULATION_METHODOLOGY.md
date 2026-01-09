# Phase 1 (P1) Calculation Methodology

## Overview

The Phase 1 calculation determines the **Annual Production Value** (ROI) by quantifying the recoverable labor costs from automating manual document processing tasks. This methodology is used across all industries to provide defensible, conservative ROI estimates.

---

## Core Calculation Algorithm

### Step 1: Identify Documentation Staff Count

**Formula:**
```
Documentation Staff = Total Staff × Documentation Staff Percentage
```

**Firm Size Scaling:**
- **Small firms (<20 staff):** Base % + 10% (capped at 90%)
  - Rationale: Flat structure, most people do documentation
- **Medium firms (20-50 staff):** Base percentage (typically 75%)
  - Rationale: Typical structure, baseline percentage
- **Large firms (50-100 staff):** Base % - 5% (floored at 65%)
  - Rationale: More management layers, fewer doing documentation
- **Very large firms (100+ staff):** Base % - 10% (floored at 60%)
  - Rationale: Significant hierarchy, much less documentation staff

**Example (50-person firm):**
```
Total Staff: 50
Base Documentation %: 75%
Documentation Staff: 50 × 0.75 = 37.5 → 38 staff
```

---

### Step 2: Calculate Total Weekly Hours

**Formula:**
```
Total Weekly Hours = Documentation Staff Count × Hours per Staff per Week
```

**Industry-Specific Defaults:**
- **Hours per staff per week:** Typically 5.0 hours (conservative estimate)
- **Hourly rate:** Industry-specific loaded cost (salary + super + overhead)

**Example (Accounting, 38 documentation staff):**
```
Hours per Staff: 5 hours/week
Total Weekly Hours: 38 × 5 = 190 hours/week
```

---

### Step 3: Calculate Annual Labor Cost (Annual Burn)

**Formula:**
```
Annual Burn = Total Weekly Hours × Hourly Rate × 48 weeks
```

**Note:** Uses 48 weeks (not 52) to account for:
- Public holidays
- Annual leave
- Sick leave
- Training/meetings

**Example (Accounting, $100/hr loaded cost):**
```
Annual Burn = 190 hours/week × $100/hr × 48 weeks = $912,000
```

---

### Step 4: Break Down by Staff Tier (Two-Tier Model)

For more detailed calculations, the system uses a **two-tier model**:

#### Tier 1: Mid/Junior Staff (Production Floor)
- **Percentage of documentation staff:** ~65-70%
- **Hours per week:** 5 hours (conservative)
- **Loaded cost:** Higher rate (e.g., $100-$110/hr)

**Example (25 Mid/Junior staff):**
```
Weekly Hours: 25 × 5 = 125 hours/week
Annual Hours: 125 × 48 = 6,000 hours
Cost Value: 6,000 × $100 = $600,000
```

#### Tier 2: Admin Staff (Support Tier)
- **Percentage of documentation staff:** ~25-30%
- **Hours per week:** 8 hours (1 full day)
- **Loaded cost:** Lower rate (e.g., $50-$55/hr)

**Example (10 Admin staff):**
```
Weekly Hours: 10 × 8 = 80 hours/week
Annual Hours: 80 × 48 = 3,840 hours
Cost Value: 3,840 × $50 = $192,000
```

**Combined Total:**
```
$600,000 + $192,000 = $792,000
```

**After Industry Variance Multiplier (Accounting = 0.90):**
```
$792,000 × 0.90 = $712,800 → $700,000 (rounded)
```

---

### Step 5: Apply Task-Specific Automation Potential

For detailed task breakdowns, the system calculates per-task savings:

**Formula:**
```
Task Hours = Total Weekly Hours × Task Percentage
Recoverable Hours = Task Hours × Automation Potential × Proven Success Rate
Annual Savings = Recoverable Hours × Hourly Rate × 48 weeks
```

**Key Variables:**
- **Task Percentage:** % of total hours spent on this task (from `proven_tasks` config)
- **Automation Potential:** Theoretical automation % (e.g., 0.85 = 85%)
- **Proven Success Rate:** Conservative adjustment (typically 0.85 = 85%)
- **Conservative Potential:** `Automation Potential × Proven Success Rate`

**Example (Invoice Processing task):**
```
Total Weekly Hours: 190
Task Percentage: 40% (from industry config)
Task Hours: 190 × 0.40 = 76 hours/week
Automation Potential: 0.90 (90%)
Proven Success Rate: 0.85 (85%)
Conservative Potential: 0.90 × 0.85 = 0.765 (76.5%)
Recoverable Hours: 76 × 0.765 = 58.14 hours/week
Annual Savings: 58.14 × $100 × 48 = $279,072
```

---

### Step 6: Apply Industry Variance Multiplier

The Industry Variance Multiplier accounts for how well the P1 model fits different industries based on document standardization and data structure.

**Three Reliability Tiers:**

1. **High-Reliability Industries (Multiplier: 0.90)**
   - **Industries:** Accounting, Logistics, Insurance, Finance/Wealth Management
   - **Why:** Built on structured data. An invoice is an invoice; a bill of lading is a bill of lading. Highly templated roles make the 5-hour/week generalization very accurate.
   - **Success Rate:** ~80% of enquiries will fit the P1 model
   - **P1 Factor:** Can lean toward Optimistic and Conservative ROI tiers

2. **Medium-Reliability Industries (Multiplier: 0.75)**
   - **Industries:** Legal, Engineering, Architecture, Property Management, Mining, Healthcare Admin, Government Contractors
   - **Why:** Semi-structured documents. Contracts and specs have repeatable frameworks but require higher cognitive input. Firm size scaling is critical—small firms have high variance; large firms fit better.
   - **Success Rate:** ~55-60% of enquiries will fit
   - **P1 Factor:** Use Conservative ROI, emphasize firm size dependency

3. **Low-Reliability Industries (Multiplier: 0.60)**
   - **Industries:** Creative/Marketing, Bespoke Manufacturing, Specialized Consulting
   - **Why:** Unstructured documents. Documentation is often unique to every project. The "5-hour average" is dangerous—one week might be 20 hours, the next might be zero.
   - **Success Rate:** ~30-40% of enquiries will fit
   - **P1 Factor:** Almost always lead with Critical ROI to manage expectations

**Formula:**
```
Adjusted Annual Production Value = Calculated Total × Industry Variance Multiplier
```

**Example (Accounting - High-Reliability):**
```
Calculated Total: $792,000
Industry Multiplier: 0.90
Adjusted Value: $792,000 × 0.90 = $712,800
Final Value: $700,000 (rounded)
```

**Example (Legal - Medium-Reliability):**
```
Calculated Total: $792,000
Industry Multiplier: 0.75
Adjusted Value: $792,000 × 0.75 = $594,000
Final Value: $600,000 (rounded)
```

### Step 7: Apply "Skeptic's Adjustment" (Optional)

For additional conservatism, a final rounding adjustment may be applied:

**Formula:**
```
Final Annual Production Value = Adjusted Value × Rounding Factor
```

**Adjustment Factors:**
- **Implementation friction:** Accounts for training, change management
- **Utilization rate:** Staff don't always fill every recovered minute with billable work
- **Typical adjustment:** Round down to nearest $50k or $100k

**Note:** The Industry Variance Multiplier already accounts for most variance, so this step is often minimal or skipped.

---

## Complete Example: Accounting Firm (50 Staff)

### Inputs:
- **Total Staff:** 50
- **Industry:** Accounting
- **Base Documentation %:** 75%
- **Hours per Staff:** 5 hours/week
- **Mid/Junior Rate:** $100/hr
- **Admin Rate:** $50/hr

### Calculations:

**1. Documentation Staff:**
```
50 × 0.75 = 37.5 → 38 staff
```

**2. Staff Tier Breakdown:**
```
Mid/Junior: 38 × 0.66 = 25 staff
Admin: 38 × 0.26 = 10 staff
```

**3. Tier 1 (Mid/Junior) - Production Floor:**
```
Weekly Hours: 25 × 5 = 125 hours
Annual Hours: 125 × 48 = 6,000 hours
Cost Value: 6,000 × $100 = $600,000
```

**4. Tier 2 (Admin) - Support:**
```
Weekly Hours: 10 × 8 = 80 hours
Annual Hours: 80 × 48 = 3,840 hours
Cost Value: 3,840 × $50 = $192,000
```

**5. Combined Total:**
```
$600,000 + $192,000 = $792,000
```

**6. Industry Variance Multiplier (Accounting = High-Reliability):**
```
$792,000 × 0.90 = $712,800
```

**7. Final Rounding:**
```
$712,800 → Round down to $700,000
```

**Final Result: $700,000 Annual Production Value**

---

## Industry-Specific Variations

### Industry Variance Multipliers by Tier:

**High-Reliability (0.90):**
- Accounting & Advisory
- Logistics & Freight
- Insurance Underwriting
- Wealth Management

**Medium-Reliability (0.75):**
- Legal Services
- Construction (Engineering)
- Architecture & Building Services
- Property Management
- Mining Services
- Healthcare Admin
- Government Contractors

**Low-Reliability (0.60):**
- Creative/Marketing (if added)
- Bespoke Manufacturing (if added)
- Specialized Consulting (if added)

### Loaded Cost Rates (Examples):
- **Accounting:** $100/hr (Mid/Junior), $50/hr (Admin)
- **Legal:** $110/hr (Associates), $55/hr (Paralegals)
- **Engineering:** $110/hr (Engineers), $55/hr (Admin)
- **Insurance:** $105/hr (Underwriters), $40/hr (Admin)
- **Logistics:** $105/hr (Coordinators), $40/hr (Admin)

### Hours per Week (Conservative Estimates):
- **Mid/Junior Staff:** 5 hours/week (conservative; many firms see 15+ hours)
- **Admin Staff:** 8 hours/week (1 full day of manual admin)

---

## Key Principles

### 1. **Conservative by Design**
- Uses 48 weeks (not 52) to account for leave
- Applies proven success rate multiplier (typically 85%)
- Applies Industry Variance Multiplier based on document standardization
- Rounds down final figures

### 2. **Industry Variance Recognition**
- Acknowledges that not all industries fit the P1 model equally
- High-Reliability industries (structured data) get 0.90 multiplier
- Medium-Reliability industries (semi-structured) get 0.75 multiplier
- Low-Reliability industries (unstructured) get 0.60 multiplier
- Makes the model more defensible and accurate

### 3. **Firm Size Scaling**
- Adjusts documentation staff percentage based on firm size
- Accounts for organizational hierarchy
- **Critical for Medium-Reliability industries:** Small firms have high variance; large firms fit better

### 4. **Two-Tier Model**
- Separates high-cost production staff from lower-cost admin
- Provides more granular and defensible calculations

### 5. **Task-Specific Breakdown**
- When available, breaks down by specific tasks (invoice processing, data entry, etc.)
- Uses industry-specific `proven_tasks` configuration
- Prioritizes "low-hanging fruit" tasks

---

## Implementation in Code

The calculation is implemented in `roi_calculator/calculations.py`:

**Main Function:**
```python
calculate_conservative_roi(total_staff, industry_config)
```

**Key Steps:**
1. Calculate documentation staff with firm size scaling (`get_doc_staff_percentage()`)
2. Calculate total weekly hours
3. For each task in `proven_tasks`:
   - Calculate task hours
   - Apply automation potential and proven success rate
   - Calculate annual savings
4. Sum all task savings
5. Apply Industry Variance Multiplier (from `industry_variance_multiplier` in industry config)
6. Return structured result with all intermediate values (including pre- and post-multiplier values)

**Alternative Function (Simpler):**
```python
calculate_simple_roi(staff_count, avg_rate, industry_config)
```
- Used when detailed task breakdown is not available
- Uses industry-specific `automation_potential` percentage
- Applies uniform rate across all staff

---

## Validation & Quality Checks

### Financial Validation:
- **Subtotal + Tax = Total** (within $0.01 tolerance)
- **Line totals sum to subtotal** (within $1.00 tolerance)
- **Unit price × Quantity = Line total** (per line)

### Business Rule Validation:
- Documentation staff % must be between 60% and 90%
- Hours per week must be realistic (typically 4-8 hours)
- Loaded cost rates must align with industry standards

---

## Why This Methodology Works

1. **Defensible:** Based on actual staff counts and industry-standard rates
2. **Conservative:** Uses proven success rates and rounds down
3. **Transparent:** Shows all intermediate calculations
4. **Scalable:** Adjusts for firm size automatically
5. **Industry-Specific:** Uses validated rates and hours per industry

---

## Common Questions

**Q: Why 48 weeks instead of 52?**
A: Accounts for public holidays, annual leave, sick leave, and non-billable time (training, meetings).

**Q: Why does my industry have a lower multiplier?**
A: The Industry Variance Multiplier reflects how well the "5 hours/week" generalization fits your industry. Industries with highly standardized documents (invoices, BOLs) fit better than those with bespoke, project-specific documents. This makes the model more accurate and defensible.

**Q: Why round down?**
A: Ensures conservative, defensible numbers. The Industry Variance Multiplier already accounts for most variance, so final rounding is often minimal.

**Q: How do you determine "loaded cost"?**
A: Industry-standard rates that include salary, superannuation, and overhead (office space, equipment, etc.).

**Q: What if my firm has different staff ratios?**
A: The calculation uses industry defaults but can be adjusted. The methodology remains the same. For Medium-Reliability industries, firm size is critical—small firms may not fit the model as well.

**Q: Can the multiplier be adjusted for my specific firm?**
A: Yes, the multiplier is stored in the industry configuration and can be adjusted based on your firm's specific document standardization level. However, the default values are based on industry-wide patterns.

---

## Industry Comparison Matrix

| Industry | Data Type | Primary ROI Driver | Reliability of P1 Generalization | Multiplier |
|----------|-----------|-------------------|-----------------------------------|------------|
| Accounting | Structured | High Volume / High Speed | Very High | 0.90 |
| Logistics | Structured | Throughput / Accuracy | Very High | 0.90 |
| Insurance | Structured | Volume / Compliance | Very High | 0.90 |
| Wealth Management | Structured | Volume / Compliance | Very High | 0.90 |
| Legal | Semi-Structured | Billable Hour Recovery | Medium | 0.75 |
| Engineering | Semi-Structured | Technical Compliance | Medium | 0.75 |
| Architecture | Semi-Structured | Technical Compliance | Medium | 0.75 |
| Property Management | Semi-Structured | Volume / Compliance | Medium | 0.75 |
| Mining | Semi-Structured | Safety / Compliance | Medium | 0.75 |
| Healthcare Admin | Semi-Structured | Volume / Compliance | Medium | 0.75 |
| Government Contractors | Semi-Structured | Compliance / Audit | Medium | 0.75 |
| Creative | Unstructured | Workflow Coordination | Low | 0.60 |

## References

- **Code:** `roi_calculator/calculations.py`
- **Industry Configs:** `roi_calculator/config/industries.py` (includes `industry_variance_multiplier` for each industry)
- **Documentation:** `templates/admin/documentation/roi.html`
