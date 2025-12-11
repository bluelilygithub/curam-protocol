# Legal Services ROI Calculator Configuration

## Add to `roi_calculator_flask.py`

Add this entry to the `INDUSTRIES` dictionary:

```python
"Legal Services": {
    "context": "Australian legal firms (15-50 fee earners)",
    "q1_label": "What's your biggest administrative bottleneck?",
    "q1_options": [
        "Manual contract review and term extraction",
        "New matter intake and client onboarding",
        "Legal research duplication across matters",
        "Document management and precedent retrieval",
        "Court document preparation and filing"
    ],
    "q2_label": "Number of Fee Earners (Partners + Associates + Paralegals)",
    "q2_type": "slider",
    "q2_range": [5, 100, 30],  # Min, Max, Default
    "q3_label": "Average Billable Rate ($/hour)",
    "q3_type": "slider",
    "q3_range": [200, 650, 350],  # Min, Max, Default
    "q4_label": "Hours per week lost to manual admin (per fee earner)",
    "q4_type": "slider",
    "q4_range": [2, 20, 8],  # Min, Max, Default - conservative for legal
    "tech_stack_question": "Primary Practice Management System",
    "tech_stack_options": [
        "ActionStep",
        "LEAP",
        "Smokeball",
        "Practical",
        "LawMaster",
        "Other/Multiple Systems"
    ]
},
```

## Add to `AI_OPPORTUNITIES` dictionary:

```python
"Legal Services": {
    "tasks": [
        "Contract term extraction and obligation tracking",
        "Client intake form processing and ID verification",
        "Matter folder creation with correct taxonomy",
        "Precedent search across past matters",
        "Engagement letter auto-population"
    ],
    "potential": 0.35,  # 35% capacity recovery (conservative for legal)
    "hours_per_week": 8,  # Average admin hours saved per fee earner
    "description": "Automated document intelligence for legal workflows"
},
```

## Legal-Specific ROI Calculation Notes

### Key Metrics:
- **Admin burden:** 15-20% of fee earner time (8-12 hrs/week on average)
- **Billable rate range:** $200-$650/hr (average $350/hr)
- **Typical firm size:** 15-50 fee earners
- **Recovery potential:** 35% of admin time (conservative, allows for human review)

### Calculation Example (30 fee earners, $350/hr, 8 hrs/week waste):

```
Annual Revenue Leakage:
30 fee earners × 8 hrs/week × $350/hr × 48 weeks = $4,032,000

Tier 1 Opportunity (35% reduction):
$4,032,000 × 0.35 = $1,411,200

Capacity Hours Unlocked:
30 × 8 × 48 × 0.35 = 4,032 hours

Potential Revenue (if resold at 70% utilization):
4,032 hours × $350/hr × 0.70 = $987,696
```

## Legal Industry Landing Page Features

### Pain Points Highlighted:
1. **Contract Review Bottleneck** (4-6 hrs/week per paralegal)
2. **Matter Intake Chaos** (45-60 min per new matter)
3. **Legal Research Duplication** (3-5 hrs/week per associate)

### Solutions Offered:
1. **Automated Contract Intelligence**
   - Extract terms, dates, parties, obligations
   - Auto-populate practice management systems
   - Flag non-standard clauses
   - Generate obligation calendars

2. **Instant Matter Setup**
   - Extract client data from intake forms
   - Auto-create SharePoint matter folders
   - Pre-fill engagement letters
   - Generate conflict check summaries

3. **Searchable Precedent Library**
   - AI search across all past matters
   - Automatic case law tagging
   - "Similar matters" functionality
   - Instant precedent retrieval

### Legal-Specific Considerations:

**Compliance & Ethics:**
- Legal professional privilege protection
- Australian data residency (M365 tenant)
- No third-party AI providers (OpenAI, etc.)
- Ethics committee documentation

**Practice Management Integration:**
- ActionStep
- LEAP
- Smokeball
- Practical
- LawMaster

**Security:**
- Encryption at rest and in transit
- Azure AI services only
- Full data flow documentation
- Law Society compliance

## ROI Calculator URL Parameters

Pre-fill legal industry:
```
/roi.html?industry=legal
/roi.html?industry=Legal%20Services
```

From legal services page:
```html
<a href="/roi.html?industry=legal">Calculate My Firm's ROI</a>
```

## Example Results Display (Legal-Specific)

For a 30-person legal firm:

```
Annual Revenue Leakage: $4,032,000
↓
Tier 1 Opportunity: $1,411,200 (35% reduction)
↓
Capacity Hours Unlocked: 4,032 hours
↓
Potential Revenue: $987,696 (at 70% utilization)
```

### Key Messaging:
- "Most legal firms see payback in **6-8 weeks**"
- "No client data sent to third-party AI providers"
- "Integrates with ActionStep/LEAP/Smokeball"
- "95% confidence threshold for human review"

## Testing

1. Add configuration to `roi_calculator_flask.py`
2. Test URL: `/roi.html?industry=legal`
3. Verify:
   - Industry pre-selection works
   - Questions are legal-specific
   - Calculations use correct formulas
   - PDF report generates with legal context

## Implementation Priority

1. ✅ Update `INDUSTRIES` dictionary (5 min)
2. ✅ Update `AI_OPPORTUNITIES` dictionary (5 min)
3. ✅ Test calculator with legal parameters (5 min)
4. ✅ Deploy `legal-services.html` page (immediate)
5. ✅ Add route to `main.py` (2 min)

---

**Note:** The legal industry has higher average rates ($350/hr vs $255/hr for accounting) but more conservative automation potential (35% vs 40%) due to the need for lawyer oversight and professional judgment. The calculator reflects this in the default parameters.
