# Accounting Page Improvements - Implementation Guide

**Purpose**: Make the accounting page more credible and compelling for accounting practice directors  
**Target**: Development Team  
**Priority**: High  
**Estimated Time**: 8-12 hours  
**Date**: December 12, 2025

---

## Overview of Changes

This guide provides specific improvements to `/accounting.html` to address director-level concerns and remove non-accounting industry references. Since this is a new, untested business without accounting-specific case studies, we focus on:

1. Removing all references to other industries (except in demo context)
2. Adding accounting-specific FAQ section
3. Adding "Common Director Objections" section
4. Qualifying generic statements with honest caveats
5. Making examples accounting-specific
6. Clarifying refund conditions
7. Strengthening Australian accounting credibility

---

## Section 1: Update Hero Section - Clarify Refund Conditions

### Current Code (Lines 10-15)

```html
<section class="hero">
  <div class="container">
    <h1>Break the Revenue Ceiling Without Breaking Your Culture</h1>
    <p class="subtitle">
      Mid-sized firms hit a wall at $5-10M: compliance work consumes senior capacity, 
      advisory margins compress, and talent leaves for better opportunities. We automate 
      the judgment-based complexity that standard tools can't handle—freeing your best 
      people for the work that commands premium fees.
    </p>
    <div class="cta-buttons">
      <a href="contact.html" class="btn-gold">Book Feasibility Sprint ($1,500)</a>
      <a href="roi.html?industry=accounting" class="btn-secondary">Calculate ROI</a>
    </div>
  </div>
</section>
```

### Updated Code

```html
<section class="hero">
  <div class="container">
    <h1>Break the Revenue Ceiling Without Breaking Your Culture</h1>
    <p class="subtitle">
      Mid-sized firms hit a wall at $5-10M: compliance work consumes senior capacity, 
      advisory margins compress, and talent leaves for better opportunities. We automate 
      the judgment-based complexity that standard tools can't handle—freeing your best 
      people for the work that commands premium fees.
    </p>
    <div class="cta-buttons">
      <a href="contact.html" class="btn-gold">Book Feasibility Sprint ($1,500)</a>
      <a href="roi.html?industry=accounting" class="btn-secondary">Calculate ROI</a>
    </div>
    
    <!-- ADD REFUND CLARIFICATION -->
    <div class="hero-guarantee">
      <p class="guarantee-text">
        <strong>Risk-Free Testing:</strong> $1,500 is fully refundable if we can't 
        achieve 90%+ accuracy on your documents—provided you supply the documents and 
        respond to clarification questions promptly.
      </p>
    </div>
  </div>
</section>
```

**CSS to Add** (in `styles.css` around line 500):

```css
.hero-guarantee {
  max-width: 700px;
  margin: 30px auto 0;
  padding: 20px 30px;
  background-color: rgba(212, 175, 55, 0.1);
  border: 1px solid rgba(212, 175, 55, 0.3);
  border-radius: 8px;
}

.guarantee-text {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
  text-align: center;
  line-height: 1.6;
}

.guarantee-text strong {
  color: var(--color-gold);
  font-size: 15px;
}
```

---

## Section 2: Replace "Beyond Basic OCR" Examples - Make Accounting-Specific

### Current Code (Lines 80-130)

Currently shows three examples:
1. Three-Way Match (for Construction & Logistics)
2. Automated GL Coding (generic legal invoice)
3. Fraud Shield (vendor payment)

### Updated Code - Replace Entire Section

**Remove** lines 80-130 (current examples)

**Insert** this complete replacement:

```html
<section class="logic-automation">
  <div class="container">
    <h2>Beyond Basic OCR. We Automate Accounting Logic.</h2>
    <p class="section-intro">
      Generic tools capture data from invoices. We automate the <strong>judgment calls 
      and business rules</strong> that normally require a qualified accountant's review.
    </p>

    <div class="examples-grid">

      <!-- Example 1: Trust Account Reconciliation -->
      <div class="example-card">
        <div class="example-number">1</div>
        <h3>Trust Account Reconciliation</h3>
        <p class="example-context">
          For firms managing client trust accounts (legal, real estate, financial advisory)
        </p>

        <div class="example-content">
          <div class="example-scenario">
            <h4>The Challenge:</h4>
            <p>Trust deposit received from <strong>"Smith Family Trust"</strong> 
            but matter file shows <strong>"John Smith"</strong>.</p>
            
            <div class="ai-decision">
              <div class="decision-label">🤖 AI Decision:</div>
              <p><strong>HOLD FOR REVIEW</strong> - Name mismatch detected.</p>
              <p class="decision-rationale">
                Reason: Trust transactions require exact name matching per ASIC 
                trust account regulations. Possible scenarios: (1) Legitimate trust 
                entity deposit, (2) Payment from wrong client, (3) Data entry error 
                in matter file.
              </p>
              <p class="decision-action">
                <strong>Action:</strong> Flag for manual review by senior accountant 
                with suggested matter file matches (85% confidence: John Smith trust matter).
              </p>
            </div>
          </div>

          <div class="example-result">
            <strong>Result:</strong> Eliminates auto-posting errors that trigger trust 
            account audit findings. Senior reviews only flagged items (15% of transactions) 
            instead of manually checking all transactions.
          </div>
        </div>
      </div>

      <!-- Example 2: Inter-Entity Reconciliation -->
      <div class="example-card">
        <div class="example-number">2</div>
        <h3>Inter-Entity Transaction Matching</h3>
        <p class="example-context">
          For firms managing corporate groups with multiple entities
        </p>

        <div class="example-content">
          <div class="example-scenario">
            <h4>The Challenge:</h4>
            <p>Corporate group has 5 entities. Each month, accountants manually match 
            inter-company transactions across 5 separate ledgers in Xero/MYOB.</p>
            
            <div class="ai-decision">
              <div class="decision-label">🤖 AI Decision:</div>
              <p><strong>Entity A Ledger:</strong> Invoice #8821 to Entity B ($12,500 + GST)</p>
              <p><strong>Entity B Ledger:</strong> Bill received from Entity A ($12,500 + GST)</p>
              <p class="decision-rationale">
                AI matches: Same amount, same date, GST treatment consistent, entities 
                match invoice/bill relationship → <strong>AUTO-MATCHED</strong> with 98% confidence.
              </p>
              <p><strong>Entity C Ledger:</strong> Payment to Entity A ($11,200)</p>
              <p class="decision-rationale">
                <strong>VARIANCE FLAGGED:</strong> Amount mismatch ($12,500 expected vs 
                $11,200 received). Possible short payment, discount applied, or data entry error.
              </p>
              <p class="decision-action">
                <strong>Action:</strong> Auto-match confirmed transactions. Flag variance 
                for accountant review with context (expected vs actual amounts, transaction dates).
              </p>
            </div>
          </div>

          <div class="example-result">
            <strong>Result:</strong> Reduces monthly inter-entity reconciliation from 
            6-8 hours to 1-2 hours. Only variances require review, not every transaction.
          </div>
        </div>
      </div>

      <!-- Example 3: Mixed-GL Invoice Coding -->
      <div class="example-card">
        <div class="example-number">3</div>
        <h3>Multi-Line GL Coding with Business Rules</h3>
        <p class="example-context">
          For firms processing supplier invoices with multiple expense categories
        </p>

        <div class="example-content">
          <div class="example-scenario">
            <h4>The Challenge:</h4>
            <p>Single invoice from law firm with multiple line items requiring different 
            GL codes and tax treatments:</p>
            
            <div class="invoice-preview">
              <strong>Invoice: Smith & Partners Legal</strong><br>
              Line 1: "M&A Advisory Services" - $8,500 (GST-free professional services)<br>
              Line 2: "Filing Fees - ASIC" - $1,200 (GST-free government charges)<br>
              Line 3: "Courier & Disbursements" - $340 (GST applicable)<br>
              <strong>Total: $10,040</strong>
            </div>
            
            <div class="ai-decision">
              <div class="decision-label">🤖 AI Decision:</div>
              <ul class="coding-decisions">
                <li>
                  <strong>Line 1:</strong> GL 6-2000 (Professional Fees - Consulting) | 
                  Tax Code: GST-Free | Amount: $8,500<br>
                  <span class="rationale">Reason: "Advisory Services" matches firm's 
                  coding rules for consultant fees</span>
                </li>
                <li>
                  <strong>Line 2:</strong> GL 6-4100 (Govt Fees & Charges) | 
                  Tax Code: GST-Free | Amount: $1,200<br>
                  <span class="rationale">Reason: "ASIC" + "Filing Fees" = government charge</span>
                </li>
                <li>
                  <strong>Line 3:</strong> GL 6-5200 (Postage & Courier) | 
                  Tax Code: GST (10%) | Amount: $340<br>
                  <span class="rationale">Reason: "Courier" + "Disbursements" = 
                  reimbursable expense with GST</span>
                </li>
              </ul>
            </div>
          </div>

          <div class="example-result">
            <strong>Result:</strong> Eliminates 90% of manual GL coding decisions. Senior 
            accountants review only flagged items where AI confidence is below 85% (typically 
            10-15% of invoices with ambiguous descriptions).
          </div>
        </div>
      </div>

    </div>

    <!-- Important Caveat -->
    <div class="example-caveat">
      <h4>⚠️ Important Note on Examples:</h4>
      <p>
        These examples demonstrate the <strong>types of logic</strong> our AI can learn—they 
        are not pre-built templates. In your Phase 1 Feasibility Sprint, we will test 
        <strong>your actual documents</strong> using <strong>your firm's specific coding 
        rules and business logic</strong>. The 90% accuracy guarantee applies to your 
        documents, not generic scenarios.
      </p>
      <p>
        <strong>What We Need From You:</strong> 30 representative documents (invoices, 
        statements, reports) that currently require manual processing, plus access to 
        one senior accountant for 2 hours to explain your firm's coding rules and exceptions.
      </p>
    </div>

  </div>
</section>
```

**CSS to Add** (in `styles.css` around line 900):

```css
/* ========================================
   ACCOUNTING LOGIC EXAMPLES
   ======================================== */

.logic-automation {
  padding: 80px 20px;
  background-color: var(--navy-deep);
}

.logic-automation h2 {
  text-align: center;
  font-size: 42px;
  margin-bottom: 20px;
  color: var(--text-primary);
}

.section-intro {
  text-align: center;
  font-size: 20px;
  color: var(--text-secondary);
  max-width: 800px;
  margin: 0 auto 60px;
  line-height: 1.6;
}

.examples-grid {
  display: grid;
  gap: 40px;
  max-width: 1200px;
  margin: 0 auto 60px;
}

/* Example Cards */
.example-card {
  background-color: rgba(255, 255, 255, 0.03);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 40px;
  transition: all 0.3s ease;
}

.example-card:hover {
  border-color: var(--color-gold);
  box-shadow: 0 10px 40px rgba(212, 175, 55, 0.15);
}

.example-number {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background-color: var(--color-gold);
  color: var(--color-navy);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 20px;
}

.example-card h3 {
  font-size: 28px;
  margin-bottom: 10px;
  color: var(--text-primary);
}

.example-context {
  font-size: 14px;
  color: var(--text-secondary);
  font-style: italic;
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

/* Scenario */
.example-scenario h4 {
  font-size: 18px;
  color: var(--color-gold);
  margin-bottom: 15px;
}

.example-scenario > p {
  font-size: 16px;
  color: var(--text-secondary);
  margin-bottom: 20px;
  line-height: 1.6;
}

/* AI Decision Box */
.ai-decision {
  background-color: rgba(212, 175, 55, 0.08);
  border-left: 4px solid var(--color-gold);
  padding: 25px;
  margin: 20px 0;
  border-radius: 8px;
}

.decision-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-gold);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 15px;
}

.ai-decision p {
  font-size: 15px;
  color: var(--text-secondary);
  margin-bottom: 12px;
  line-height: 1.6;
}

.ai-decision strong {
  color: var(--text-primary);
}

.decision-rationale {
  font-size: 14px !important;
  font-style: italic;
  color: rgba(255, 255, 255, 0.6) !important;
}

.decision-action {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid rgba(212, 175, 55, 0.3);
}

/* Invoice Preview */
.invoice-preview {
  background-color: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 20px;
  border-radius: 8px;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.8;
  margin: 20px 0;
  color: var(--text-secondary);
}

/* Coding Decisions List */
.coding-decisions {
  list-style: none;
  padding: 0;
  margin: 15px 0;
}

.coding-decisions li {
  padding: 15px;
  margin-bottom: 12px;
  background-color: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border-left: 3px solid var(--color-gold);
}

.coding-decisions strong {
  color: var(--text-primary);
  display: block;
  margin-bottom: 5px;
}

.coding-decisions .rationale {
  display: block;
  font-size: 13px;
  font-style: italic;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 8px;
}

/* Result */
.example-result {
  background-color: rgba(76, 175, 80, 0.1);
  border-left: 4px solid #4CAF50;
  padding: 20px;
  margin-top: 25px;
  border-radius: 8px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.example-result strong {
  color: #4CAF50;
}

/* Caveat Box */
.example-caveat {
  max-width: 1000px;
  margin: 0 auto;
  background-color: rgba(255, 165, 0, 0.1);
  border: 2px solid rgba(255, 165, 0, 0.4);
  border-radius: 12px;
  padding: 30px;
}

.example-caveat h4 {
  font-size: 20px;
  color: #FFA500;
  margin-bottom: 15px;
}

.example-caveat p {
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 15px;
}

.example-caveat strong {
  color: var(--text-primary);
}

/* Responsive */
@media (max-width: 768px) {
  .example-card {
    padding: 25px;
  }
  
  .logic-automation h2 {
    font-size: 32px;
  }
}
```

---

## Section 3: Update "Phase 1 Proof → Year 1 Revenue" Section

### Current Code (Lines 200-220)

```html
<section class="results-metrics">
  <h2>Phase 1 Proof → Year 1 Revenue</h2>
  <p>Real results from $1,500 Feasibility Sprints (scales firm-wide)</p>
  
  <!-- Four stat cards -->
  <div class="stat">40+ Hours saved per month</div>
  <div class="stat">95% Extraction accuracy</div>
  <div class="stat">6-12 Month payback period</div>
  <div class="stat">$500k+ Year 1 Revenue (15-staff firms)</div>
  
  <p><strong>Phase 1 ($1,500):</strong> $80k trust recon proof → 
  <strong>Phases 2-4:</strong> $420k+ from GL coding, inter-entity matching</p>
</section>
```

### Updated Code - Add Honesty and Context

```html
<section class="results-metrics">
  <div class="container">
    <h2>What to Expect from Phase 1 Testing</h2>
    <p class="section-intro">
      <strong>Full Transparency:</strong> We're a new business with no accounting-specific 
      case studies yet. However, our technology has been validated on complex document 
      processing for engineering firms (structural schedules, technical specifications). 
      Phase 1 tests whether it works for <strong>your</strong> accounting workflows.
    </p>

    <!-- Metrics Grid -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-icon">⏱️</div>
        <div class="metric-value">40+</div>
        <div class="metric-label">Hours saved per month</div>
        <div class="metric-note">
          Projected savings based on automating routine data entry and reconciliation 
          tasks for a 15-person firm
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon">🎯</div>
        <div class="metric-value">95%</div>
        <div class="metric-label">Extraction accuracy target</div>
        <div class="metric-note">
          Validated benchmark achieved in engineering document testing. Your Phase 1 
          tests this with your accounting documents.
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon">📅</div>
        <div class="metric-value">6-12</div>
        <div class="metric-label">Month payback period</div>
        <div class="metric-note">
          Typical ROI timeline for full implementation based on $50K total investment 
          and projected time savings
        </div>
      </div>

      <div class="metric-card featured">
        <div class="metric-icon">💰</div>
        <div class="metric-value">$200K+</div>
        <div class="metric-label">Revenue opportunity (15-staff firms)</div>
        <div class="metric-note">
          Potential revenue when freed senior capacity is redeployed to advisory work 
          (48 hrs/week × $250/hr × 48 weeks = $576K)
        </div>
      </div>
    </div>

    <!-- What Phase 1 Actually Tests -->
    <div class="phase1-reality">
      <h3>What Phase 1 Actually Tests (48 hours, $1,500):</h3>
      <div class="reality-grid">
        <div class="reality-item">
          <div class="reality-icon">✅</div>
          <div class="reality-content">
            <h4>Document Extraction Accuracy</h4>
            <p>We test 30 of your actual documents (invoices, statements, reconciliations). 
            If we achieve 90%+ accuracy on data extraction, you proceed. If not, full refund.</p>
          </div>
        </div>

        <div class="reality-item">
          <div class="reality-icon">✅</div>
          <div class="reality-content">
            <h4>Business Rule Validation</h4>
            <p>We interview a senior accountant for 2 hours to understand your firm's coding 
            rules, GL structure, and exception handling. We then test if AI can apply these 
            rules correctly.</p>
          </div>
        </div>

        <div class="reality-item">
          <div class="reality-icon">✅</div>
          <div class="reality-content">
            <h4>Time Savings Projection</h4>
            <p>Based on actual document processing times (baseline vs AI-assisted), we 
            calculate realistic monthly time savings for your firm. This becomes the 
            foundation for the full ROI model in Phase 2.</p>
          </div>
        </div>

        <div class="reality-item">
          <div class="reality-icon">✅</div>
          <div class="reality-content">
            <h4>Integration Feasibility</h4>
            <p>We assess whether your current systems (Xero, MYOB, Class, SharePoint) can 
            integrate with our automation. No point proceeding if technical barriers exist.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Honest Caveat -->
    <div class="honest-caveat">
      <h4>Why We Can't Promise Specific Dollar Amounts Yet:</h4>
      <ul>
        <li><strong>Every firm is different:</strong> Your baseline efficiency, staff 
        costs, and automation potential vary significantly from other firms.</li>
        <li><strong>We're validating, not installing:</strong> Phase 1 tests <em>if</em> 
        automation will work for you. The actual dollar savings are calculated in Phase 2 
        based on your specific workflows.</li>
        <li><strong>Technology transfer from engineering:</strong> Our AI has processed 
        complex technical documents (structural drawings, engineering schedules). Accounting 
        documents have different logic, but similar complexity. Phase 1 proves the 
        cross-industry applicability.</li>
      </ul>
      <p class="caveat-cta">
        <strong>Bottom Line:</strong> $1,500 buys you proof that automation works for 
        <em>your</em> documents with <em>your</em> business rules. If it doesn't work, 
        you get a full refund. No case studies needed—your documents are the case study.
      </p>
    </div>

  </div>
</section>
```

**CSS to Add** (in `styles.css` around line 1300):

```css
/* ========================================
   RESULTS METRICS SECTION
   ======================================== */

.results-metrics {
  padding: 100px 20px;
  background: linear-gradient(135deg, 
    rgba(15, 23, 42, 1) 0%, 
    rgba(10, 22, 40, 1) 100%
  );
}

.results-metrics h2 {
  text-align: center;
  font-size: 42px;
  margin-bottom: 20px;
  color: var(--text-primary);
}

.results-metrics .section-intro {
  text-align: center;
  max-width: 900px;
  margin: 0 auto 60px;
  font-size: 18px;
  line-height: 1.8;
  color: var(--text-secondary);
  background-color: rgba(255, 165, 0, 0.1);
  border: 1px solid rgba(255, 165, 0, 0.3);
  padding: 25px 30px;
  border-radius: 12px;
}

/* Metrics Grid */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 30px;
  max-width: 1200px;
  margin: 0 auto 80px;
}

.metric-card {
  background-color: rgba(255, 255, 255, 0.03);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 35px 25px;
  text-align: center;
  transition: all 0.3s ease;
}

.metric-card:hover {
  transform: translateY(-5px);
  border-color: var(--color-gold);
  box-shadow: 0 10px 30px rgba(212, 175, 55, 0.2);
}

.metric-card.featured {
  border-color: var(--color-gold);
  background-color: rgba(212, 175, 55, 0.05);
}

.metric-icon {
  font-size: 48px;
  margin-bottom: 20px;
}

.metric-value {
  font-size: 56px;
  font-weight: 700;
  color: var(--color-gold);
  margin-bottom: 10px;
  line-height: 1;
}

.metric-label {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 15px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.metric-note {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  font-style: italic;
}

/* Phase 1 Reality Section */
.phase1-reality {
  max-width: 1000px;
  margin: 0 auto 60px;
}

.phase1-reality h3 {
  text-align: center;
  font-size: 32px;
  color: var(--color-gold);
  margin-bottom: 40px;
}

.reality-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 25px;
}

.reality-item {
  display: flex;
  gap: 20px;
  background-color: rgba(255, 255, 255, 0.03);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 25px;
}

.reality-icon {
  font-size: 32px;
  flex-shrink: 0;
}

.reality-content h4 {
  font-size: 18px;
  color: var(--text-primary);
  margin-bottom: 10px;
}

.reality-content p {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
}

/* Honest Caveat */
.honest-caveat {
  max-width: 900px;
  margin: 0 auto;
  background-color: rgba(255, 255, 255, 0.05);
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  padding: 40px;
}

.honest-caveat h4 {
  font-size: 24px;
  color: var(--color-gold);
  margin-bottom: 25px;
}

.honest-caveat ul {
  list-style: none;
  padding: 0;
  margin: 0 0 25px 0;
}

.honest-caveat li {
  padding: 15px 0;
  padding-left: 30px;
  position: relative;
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.7;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.honest-caveat li:last-child {
  border-bottom: none;
}

.honest-caveat li::before {
  content: '→';
  position: absolute;
  left: 0;
  color: var(--color-gold);
  font-size: 18px;
}

.honest-caveat strong {
  color: var(--text-primary);
}

.honest-caveat em {
  color: var(--color-gold);
  font-style: italic;
}

.caveat-cta {
  background-color: rgba(212, 175, 55, 0.1);
  border-left: 4px solid var(--color-gold);
  padding: 20px;
  margin-top: 25px;
  border-radius: 8px;
  font-size: 16px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.caveat-cta strong {
  color: var(--color-gold);
  font-size: 18px;
}

/* Responsive */
@media (max-width: 768px) {
  .metrics-grid {
    grid-template-columns: 1fr;
  }
  
  .reality-grid {
    grid-template-columns: 1fr;
  }
  
  .reality-item {
    flex-direction: column;
    text-align: center;
  }
}
```

---

## Section 4: Add Accounting-Specific FAQ Section

### Location
Add **before** the "How The Protocol Works" section (around line 250)

### New Section - Insert

```html
<!-- ACCOUNTING-SPECIFIC FAQ SECTION -->
<section class="accounting-faq">
  <div class="container">
    <h2>Common Questions from Accounting Practice Directors</h2>
    <p class="section-intro">
      Honest answers to the questions you're probably thinking right now.
    </p>

    <div class="faq-grid">

      <!-- FAQ 1: Professional Liability -->
      <div class="faq-item">
        <div class="faq-question">
          <h3>What happens if the AI makes a mistake on a trust account or client ledger?</h3>
          <span class="faq-toggle">+</span>
        </div>
        <div class="faq-answer">
          <p><strong>Short Answer:</strong> You are always liable (we can't change professional 
          indemnity rules), but we design the system to minimize risk through human oversight.</p>
          
          <p><strong>How It Works:</strong></p>
          <ul>
            <li><strong>Nothing auto-posts:</strong> All AI extractions are queued for review 
            before being committed to your accounting system. A qualified accountant must approve 
            each batch.</li>
            <li><strong>Confidence scoring:</strong> Every extraction has a confidence score. 
            Items below 85% confidence are automatically flagged for senior review.</li>
            <li><strong>Audit trails:</strong> Every AI decision is logged with reasoning. If 
            an error occurs, you can trace exactly what the AI interpreted and why.</li>
            <li><strong>Your rules, not ours:</strong> Phase 2 documents your firm's specific 
            coding rules and exception handling. The AI learns <em>your</em> standards, not 
            generic rules.</li>
          </ul>

          <p><strong>What We DON'T Do:</strong></p>
          <ul>
            <li>We don't provide audit opinions or sign off on financial statements</li>
            <li>We don't take on professional liability for accounting judgments</li>
            <li>We don't auto-post transactions without qualified accountant approval</li>
          </ul>

          <p><strong>Our Responsibility:</strong> If our software has a bug or technical error 
          (e.g., miscalculates a total, fails to extract a field), we fix it at no cost. If the 
          AI makes an incorrect business rule decision (e.g., codes an expense to the wrong GL), 
          we analyze why it failed and retrain the model. But ultimately, the qualified accountant 
          who approves the batch is the responsible party—just like they would be if they personally 
          keyed in the data.</p>
        </div>
      </div>

      <!-- FAQ 2: Staff Resistance -->
      <div class="faq-item">
        <div class="faq-question">
          <h3>My team will resist this. How do I handle "You're automating us out of jobs"?</h3>
          <span class="faq-toggle">+</span>
        </div>
        <div class="faq-answer">
          <p><strong>Honest Take:</strong> This is your biggest implementation risk—not the technology.</p>
          
          <p><strong>What Usually Happens:</strong></p>
          <ol>
            <li><strong>Junior staff worry</strong> they'll lose their jobs if data entry is automated</li>
            <li><strong>Senior staff worry</strong> the AI will make errors they'll be held accountable for</li>
            <li><strong>Mid-level staff worry</strong> they'll be forced to learn "complicated" new systems</li>
          </ol>

          <p><strong>How to Frame It (What Works):</strong></p>
          <ul>
            <li><strong>For Juniors:</strong> "We're not eliminating positions—we're eliminating 
            the boring work. You'll spend less time on data entry and more time learning advisory 
            skills that make you more valuable."</li>
            <li><strong>For Seniors:</strong> "You'll still review everything—the AI just does the 
            first-pass grunt work. You'll spend 80% less time on routine reconciliations and more 
            time on complex client issues."</li>
            <li><strong>For Everyone:</strong> "Clients are already pushing us to lower compliance 
            fees. Either we automate and stay competitive, or we lose clients to firms that do. 
            This protects everyone's jobs long-term."</li>
          </ul>

          <p><strong>What We Include in Phase 2:</strong></p>
          <ul>
            <li>Staff change management workshop (2 hours, included in Phase 2 fee)</li>
            <li>Hands-on training for key users (not just "here's the manual")</li>
            <li>Gradual rollout plan—pilot with one workflow first, not everything at once</li>
            <li>"AI assistant" framing, not "AI replacement" framing</li>
          </ul>

          <p><strong>Real Talk:</strong> If you have staff who absolutely refuse to adapt, that's 
          a performance management issue, not a technology issue. But in our experience, once staff 
          see that the AI eliminates the tedious work they hate, most become advocates.</p>
        </div>
      </div>

      <!-- FAQ 3: Australian Compliance -->
      <div class="faq-item">
        <div class="faq-question">
          <h3>I've tried "AI solutions" before. They failed on Australian GST/BAS/ASIC requirements. How is this different?</h3>
          <span class="faq-toggle">+</span>
        </div>
        <div class="faq-answer">
          <p><strong>Valid Concern.</strong> Most AI tools are built for US/UK markets and don't 
          understand Australian tax codes, trust account rules, or ASIC reporting requirements.</p>
          
          <p><strong>How We Handle Australian-Specific Requirements:</strong></p>
          <ul>
            <li><strong>Custom training on your rules:</strong> We don't use a generic "global" 
            AI model. Phase 2 trains the AI on <em>your firm's</em> specific interpretations of 
            Australian standards. If your firm codes PAYG differently than another firm, the AI 
            learns your approach.</li>
            <li><strong>GST treatment logic:</strong> We can train the AI to recognize GST-free vs 
            input-taxed vs GST-applicable transactions based on keywords and rules you provide. 
            Example: "ASIC filing fees" = GST-free government charge.</li>
            <li><strong>BAS reconciliation support:</strong> AI can extract data needed for BAS 
            reporting, but it doesn't auto-lodge BAS (that still requires qualified accountant review 
            and lodgment through ATO portals).</li>
            <li><strong>Trust account compliance:</strong> For firms managing trust accounts (legal, 
            real estate, advisory), we can train the AI to flag transactions that require special 
            handling per ASIC/Law Society requirements.</li>
          </ul>

          <p><strong>What We DON'T Claim:</strong></p>
          <ul>
            <li>We're not tax advisors—we don't interpret whether something should be GST-free</li>
            <li>We don't guarantee compliance with every possible edge case in AASB standards</li>
            <li>We don't auto-generate statutory financial statements or audit reports</li>
          </ul>

          <p><strong>The Difference:</strong> Other tools try to be "plug and play" with pre-built 
          rules. We assume every firm has nuances and exceptions. Phase 2 is specifically designed 
          to capture <em>your</em> firm's interpretation of Australian requirements, not a generic 
          ruleset.</p>
        </div>
      </div>

      <!-- FAQ 4: Board Approval -->
      <div class="faq-item">
        <div class="faq-question">
          <h3>How do I get board/partner approval for $50K when we're still recovering from COVID cost-cutting?</h3>
          <span class="faq-toggle">+</span>
        </div>
        <div class="faq-answer">
          <p><strong>This is THE objection</strong> that kills most automation projects—not the 
          technology, but internal politics and risk aversion.</p>
          
          <p><strong>What Works (Based on Engineering Firm Experience):</strong></p>
          
          <h4>1. Start with Phase 1 ($1,500)—No Board Approval Needed</h4>
          <p>Most practices can expense $1,500 without partner vote. Get proof it works first, 
          <em>then</em> ask for bigger investment. Don't lead with $50K.</p>

          <h4>2. Frame as "Revenue Protection" Not "Cost Reduction"</h4>
          <p>Partners respond to revenue risk more than cost savings:</p>
          <ul>
            <li><strong>Bad framing:</strong> "This will save us $200K in labor costs"<br>
            <em>Response:</em> "So you want to fire people?"</li>
            <li><strong>Good framing:</strong> "We're turning away $400K in advisory work because 
            seniors are stuck doing compliance. This frees them to accept that work."<br>
            <em>Response:</em> "That's revenue we're leaving on the table. Show me the numbers."</li>
          </ul>

          <h4>3. Show Competitive Threat</h4>
          <p>"Big 4 are already using AI to undercut our compliance pricing. Mid-tier firms that 
          don't automate will lose commodity work and can't compete for advisory work. This isn't 
          optional—it's a defensive move."</p>

          <h4>4. Use Phase 2 Report as Internal Business Case</h4>
          <p>Phase 2 ($7,500) produces a board-ready report with:</p>
          <ul>
            <li>Validated time savings based on <em>your</em> actual workflows</li>
            <li>Conservative ROI model with sensitivity analysis</li>
            <li>Risk mitigation plan (what if adoption is slower than expected?)</li>
            <li>Phased rollout approach (pilot one workflow first, scale after proof)</li>
          </ul>
          <p>Partners can't argue with data from <em>their own firm's</em> processes.</p>

          <h4>5. Offer Risk-Sharing Structure</h4>
          <p>If partners are still hesitant: "Let's pilot one workflow (e.g., inter-entity recons). 
          If it doesn't deliver the projected savings in 6 months, we don't scale further. Total 
          downside risk: $15-20K for pilot. Upside: $200K+ annually if it works."</p>

          <p><strong>Template Language for Partner Meeting:</strong></p>
          <blockquote>
            "We're at capacity. We turned away three advisory mandates this quarter because seniors 
            are doing compliance work that could be automated. The Phase 1 test ($1,500) proved we 
            can automate our inter-entity reconciliations with 95% accuracy. Phase 2 quantified the 
            savings: 48 hours per week freed up, which is $576K in potential advisory revenue. Total 
            investment is $50K with 6-month payback. If we don't do this, we're leaving half a million 
            in revenue on the table annually. The Big 4 are already doing this—we're playing catch-up."
          </blockquote>
        </div>
      </div>

      <!-- FAQ 5: Integration with Existing Systems -->
      <div class="faq-item">
        <div class="faq-question">
          <h3>We use [Xero/MYOB/Class]. Will this integrate with our existing systems or do we have to change everything?</h3>
          <span class="faq-toggle">+</span>
        </div>
        <div class="faq-answer">
          <p><strong>Short Answer:</strong> We work with your existing systems. No "rip and replace."</p>
          
          <p><strong>How Integration Works:</strong></p>
          <ul>
            <li><strong>Xero:</strong> Direct API integration. AI-extracted data can be pushed 
            directly to Xero invoices, bills, or journals (subject to your approval workflow).</li>
            <li><strong>MYOB:</strong> API integration for MYOB AccountRight and MYOB Essentials. 
            Similar to Xero—data flows directly into MYOB after accountant approval.</li>
            <li><strong>Class Super:</strong> Export files in Class-compatible format. Not direct 
            API (Class has limited API access), but we generate properly formatted import files.</li>
            <li><strong>SharePoint/M365:</strong> Most firms store documents in SharePoint. We can 
            set up automated flows: Document uploaded to SharePoint folder → AI extracts data → 
            Queues for review in Teams → Approved items post to accounting system.</li>
            <li><strong>Other systems:</strong> If you use niche practice management software, Phase 1 
            assesses integration feasibility. Most systems with APIs or CSV import can work.</li>
          </ul>

          <p><strong>What You Keep Using:</strong></p>
          <ul>
            <li>Your accounting software (Xero/MYOB/etc) remains the source of truth</li>
            <li>Your chart of accounts and GL structure stays unchanged</li>
            <li>Your existing workflows (invoice approval, reconciliation review) stay the same—just faster</li>
          </ul>

          <p><strong>What Changes:</strong></p>
          <ul>
            <li>Instead of manually typing invoice data, your staff review AI-extracted data and approve/edit</li>
            <li>Instead of manually matching inter-entity transactions, they review AI-suggested matches</li>
            <li>Instead of manually coding GL accounts, they review AI-suggested coding</li>
          </ul>

          <p><strong>Phase 1 Deliverable:</strong> Integration feasibility report. We'll tell you 
          honestly if your systems can't integrate (e.g., if you're on legacy software with no API 
          and no CSV export). Better to find out in Phase 1 than Phase 4.</p>
        </div>
      </div>

      <!-- FAQ 6: Ongoing Costs -->
      <div class="faq-item">
        <div class="faq-question">
          <h3>What are the ongoing costs after implementation? Hidden subscription fees?</h3>
          <span class="faq-toggle">+</span>
        </div>
        <div class="faq-answer">
          <p><strong>No hidden fees. Here's exactly what you pay:</strong></p>
          
          <p><strong>One-Time Implementation Costs:</strong></p>
          <ul>
            <li>Phase 1: $1,500 (refundable if we don't hit 90% accuracy)</li>
            <li>Phase 2: $7,500 (business case and roadmap)</li>
            <li>Phase 3: $8-12K (compliance shield / pre-audit pack)</li>
            <li>Phase 4: $20-30K (implementation and deployment)</li>
            <li><strong>Total: $37,000 - $51,000 (one-time)</strong></li>
          </ul>

          <p><strong>Ongoing Costs (Post-Implementation):</strong></p>
          <ul>
            <li><strong>Azure/Cloud Usage:</strong> ~$50-200/month depending on document volume. 
            This is the cost of running the AI models in your Azure tenant. You pay Microsoft directly 
            (not us).</li>
            <li><strong>Software licensing:</strong> $0. You own the source code after Phase 4. 
            No monthly software fees to us.</li>
            <li><strong>API costs (Xero/MYOB):</strong> Most API calls are free under standard 
            subscription plans. If you exceed limits, Xero/MYOB may charge (typically $0-50/month).</li>
            <li><strong>Maintenance/updates:</strong> Optional support contract ($2-3K/year) for 
            bug fixes and model retraining if your workflows change significantly. Not mandatory—you 
            can maintain it yourself if you have internal IT resources.</li>
          </ul>

          <p><strong>Total Ongoing: ~$50-300/month in cloud costs.**</strong> Compare that to 
          $200K+ in annual labor savings.</p>

          <p><strong>Why No Subscription Model?</strong></p>
          <p>We build custom solutions for mid-market firms. Subscription SaaS models only work 
          for generic, one-size-fits-all products. Since we're training the AI on <em>your</em> 
          specific business rules, you get a custom solution that you own—not rent.</p>

          <p><strong>What You Own After Phase 4:</strong></p>
          <ul>
            <li>100% of source code (Python, Power Automate flows, AI model training scripts)</li>
            <li>All trained AI models (they run in <em>your</em> Azure/AWS tenant, not ours)</li>
            <li>Complete documentation of business rules and logic</li>
            <li>Training materials for your staff</li>
          </ul>

          <p><strong>No Vendor Lock-In:</strong> If you decide you don't want to work with us 
          after implementation, you keep everything. You're not held hostage by a subscription you 
          can't escape.</p>
        </div>
      </div>

    </div>

  </div>
</section>
```

**CSS for FAQ Section** (add to `styles.css` around line 1800):

```css
/* ========================================
   ACCOUNTING-SPECIFIC FAQ
   ======================================== */

.accounting-faq {
  padding: 100px 20px;
  background-color: var(--color-navy);
}

.accounting-faq h2 {
  text-align: center;
  font-size: 42px;
  margin-bottom: 20px;
  color: var(--text-primary);
}

.accounting-faq .section-intro {
  text-align: center;
  font-size: 20px;
  color: var(--text-secondary);
  max-width: 700px;
  margin: 0 auto 60px;
}

.faq-grid {
  max-width: 1000px;
  margin: 0 auto;
  display: grid;
  gap: 20px;
}

/* FAQ Item */
.faq-item {
  background-color: rgba(255, 255, 255, 0.03);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.3s ease;
}

.faq-item.active {
  border-color: var(--color-gold);
}

/* FAQ Question (Clickable) */
.faq-question {
  padding: 25px 30px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  transition: background-color 0.3s ease;
}

.faq-question:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.faq-question h3 {
  font-size: 20px;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.4;
}

.faq-toggle {
  font-size: 32px;
  color: var(--color-gold);
  font-weight: 300;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.3s ease;
}

.faq-item.active .faq-toggle {
  transform: rotate(45deg);
}

/* FAQ Answer (Collapsible) */
.faq-answer {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.5s ease, padding 0.5s ease;
}

.faq-item.active .faq-answer {
  max-height: 3000px;
  padding: 0 30px 30px 30px;
}

.faq-answer p {
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 20px;
}

.faq-answer strong {
  color: var(--text-primary);
}

.faq-answer em {
  color: var(--color-gold);
  font-style: italic;
}

.faq-answer h4 {
  font-size: 18px;
  color: var(--color-gold);
  margin: 25px 0 15px;
}

.faq-answer ul,
.faq-answer ol {
  margin: 15px 0 20px 0;
  padding-left: 25px;
}

.faq-answer li {
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 12px;
}

.faq-answer blockquote {
  background-color: rgba(212, 175, 55, 0.1);
  border-left: 4px solid var(--color-gold);
  padding: 20px;
  margin: 20px 0;
  font-style: italic;
  color: var(--text-secondary);
  border-radius: 8px;
}

/* Responsive */
@media (max-width: 768px) {
  .faq-question {
    padding: 20px;
  }
  
  .faq-question h3 {
    font-size: 18px;
  }
  
  .faq-item.active .faq-answer {
    padding: 0 20px 20px 20px;
  }
}
```

**JavaScript for FAQ Accordion** (add to `assets/js/main.js`):

```javascript
// ==========================================
// FAQ ACCORDION
// ==========================================

document.addEventListener('DOMContentLoaded', function() {
  const faqItems = document.querySelectorAll('.faq-item');
  
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    
    question.addEventListener('click', function() {
      // Close all other FAQs
      faqItems.forEach(otherItem => {
        if (otherItem !== item) {
          otherItem.classList.remove('active');
        }
      });
      
      // Toggle current FAQ
      item.classList.toggle('active');
    });
  });
});
```

---

## Section 5: Add "Common Director Objections" Section

### Location
Add **after** the FAQ section, **before** "How The Protocol Works"

### New Section - Insert

```html
<!-- DIRECTOR OBJECTIONS SECTION -->
<section class="director-objections">
  <div class="container">
    <h2>What's Stopping You from Booking Phase 1 Right Now?</h2>
    <p class="section-intro">
      Let's address the real objections directors have. Pick the one you're thinking:
    </p>

    <div class="objections-grid">

      <!-- Objection 1: Not Convinced -->
      <div class="objection-card">
        <div class="objection-icon">🤔</div>
        <h3>"I'm not convinced this will work for accounting"</h3>
        <div class="objection-response">
          <p><strong>Fair.</strong> We're new to accounting. But consider:</p>
          <ul>
            <li><strong>Technology is proven:</strong> Our AI has extracted data from structural 
            engineering drawings (beam schedules, load calculations)—documents with similar complexity 
            to accounting reconciliations.</li>
            <li><strong>Phase 1 is the proof:</strong> For $1,500, we test <em>your</em> documents. 
            If it doesn't work, you get a full refund. You're not betting $50K on a hunch—you're 
            betting $1,500 on a 48-hour test.</li>
            <li><strong>What's the alternative?</strong> Keep doing manual data entry and watch the 
            Big 4 undercut you? Or try something that might actually work?</li>
          </ul>
          <p class="objection-cta">
            <a href="contact.html" class="btn-secondary">Book $1,500 Test (Refundable) →</a>
          </p>
        </div>
      </div>

      <!-- Objection 2: Too Busy -->
      <div class="objection-card">
        <div class="objection-icon">⏰</div>
        <h3>"I don't have time to manage an AI implementation project"</h3>
        <div class="objection-response">
          <p><strong>Phase 1 requires 3 hours of your time (total):</strong></p>
          <ul>
            <li><strong>Hour 1:</strong> Kickoff call—you explain your biggest pain point workflow</li>
            <li><strong>Hour 2:</strong> You provide 30 sample documents (drag-and-drop to SharePoint folder)</li>
            <li><strong>Hour 3:</strong> Results review call—we show you the accuracy results</li>
          </ul>
          <p><strong>That's it.</strong> We do the technical work. You just provide documents and feedback.</p>
          <p><strong>If you proceed to Phase 2:</strong> We interview your senior staff (not you). 
          You only get involved at decision points (approve roadmap, approve Phase 3, approve Phase 4).</p>
          <p class="objection-cta">
            <a href="contact.html" class="btn-secondary">Start with 3-Hour Commitment →</a>
          </p>
        </div>
      </div>

      <!-- Objection 3: Budget -->
      <div class="objection-card">
        <div class="objection-icon">💸</div>
        <h3>"I don't have $50K in the budget right now"</h3>
        <div class="objection-response">
          <p><strong>You don't need it yet.</strong></p>
          <p><strong>Phase 1 is $1,500</strong>—you can expense that without board approval. Get 
          proof it works first.</p>
          <p><strong>Phase 2 is $7,500</strong>—still under most firms' discretionary spending limits. 
          This produces the business case you need to request the $30-40K for Phases 3-4.</p>
          <p><strong>Total upfront spend to get board-ready ROI model: $9,000.**</strong></p>
          <p>If the ROI model shows $200K+ annual savings, getting board approval for the remaining 
          $30-40K becomes much easier. You're not asking for money based on a hunch—you're asking 
          based on data from your own firm.</p>
          <p class="objection-cta">
            <a href="contact.html" class="btn-secondary">Start with $1,500 Test →</a>
          </p>
        </div>
      </div>

      <!-- Objection 4: Staff Resistance -->
      <div class="objection-card">
        <div class="objection-icon">👥</div>
        <h3>"My staff will hate this and resist change"</h3>
        <div class="objection-response">
          <p><strong>True—this is your biggest risk.</strong> Technology is easy. People are hard.</p>
          <p><strong>How we help:</strong></p>
          <ul>
            <li><strong>Phase 2 includes change management workshop:</strong> We don't just build 
            the tech—we help you sell it internally. 2-hour session with your team explaining benefits 
            and addressing fears.</li>
            <li><strong>Pilot approach:</strong> Start with one workflow (e.g., inter-entity recons). 
            Prove it works. Then scale. Staff see results before being forced to change everything.</li>
            <li><strong>"AI assistant" framing:</strong> We don't position this as "replacing you." 
            We position it as "eliminating the boring work you hate so you can do more interesting work."</li>
          </ul>
          <p><strong>Counterpoint:</strong> If your staff refuse to adapt to any efficiency improvements, 
          that's a performance issue, not a technology issue. But in our experience, once staff see 
          they're not getting fired and the boring work disappears, most become advocates.</p>
          <p class="objection-cta">
            <a href="contact.html" class="btn-secondary">Get Change Management Support →</a>
          </p>
        </div>
      </div>

      <!-- Objection 5: Tried Before -->
      <div class="objection-card">
        <div class="objection-icon">❌</div>
        <h3>"I've tried AI tools before. They didn't work."</h3>
        <div class="objection-response">
          <p><strong>Let me guess what happened:</strong></p>
          <ul>
            <li>Tool claimed to be "AI-powered" but was just basic OCR</li>
            <li>Worked great in the demo, terrible on your actual documents</li>
            <li>Couldn't handle Australian GST rules or trust account requirements</li>
            <li>Required massive manual cleanup—not actually faster than doing it manually</li>
            <li>Vendor ghosted you after the sale</li>
          </ul>
          <p><strong>Why we're different:</strong></p>
          <ul>
            <li><strong>We test YOUR documents:</strong> Phase 1 is literally a test on your actual 
            invoices/statements. No generic demo. If it doesn't work on your stuff, you don't pay.</li>
            <li><strong>Custom training:</strong> We're not selling you a plug-and-play SaaS product. 
            We train the AI on your firm's specific rules. If you have weird edge cases, we train the 
            AI to handle them.</li>
            <li><strong>Refundable:</strong> $1,500 refund if we don't hit 90% accuracy. Other vendors 
            don't offer refunds because they know their tools don't work.</li>
          </ul>
          <p class="objection-cta">
            <a href="contact.html" class="btn-secondary">Test with YOUR Documents →</a>
          </p>
        </div>
      </div>

      <!-- Objection 6: Security Concerns -->
      <div class="objection-card">
        <div class="objection-icon">🔒</div>
        <h3>"I'm worried about data security and client confidentiality"</h3>
        <div class="objection-response">
          <p><strong>Valid concern. Here's how we handle it:</strong></p>
          <ul>
            <li><strong>Your cloud tenant:</strong> All AI processing happens in <em>your</em> 
            Azure/AWS tenant, not ours. Your client data never leaves your infrastructure.</li>
            <li><strong>No external AI services:</strong> We don't send your documents to OpenAI, 
            Google AI, or any third-party service. The AI runs in your environment.</li>
            <li><strong>Encryption:</strong> All data encrypted at rest and in transit (AES-256 
            standard).</li>
            <li><strong>Audit trails:</strong> Every document processed, every AI decision made, 
            every user action—all logged immutably for compliance audits.</li>
            <li><strong>Phase 3 deliverable:</strong> Pre-audit pack for your PI insurer and 
            external auditors. We prove the system meets data security standards before you go live.</li>
          </ul>
          <p><strong>Who has access to your data?</strong></p>
          <ul>
            <li><strong>Your staff:</strong> Yes (obviously)</li>
            <li><strong>Curam-Ai during implementation:</strong> Yes, but under NDA and only for 
            training/configuration purposes</li>
            <li><strong>Curam-Ai post-implementation:</strong> No. You own the system. We don't 
            have backdoor access.</li>
            <li><strong>Cloud providers (Azure/AWS):</strong> Data stored in Australian datacenters. 
            Subject to Azure/AWS standard security policies (ISO 27001, SOC 2).</li>
          </ul>
          <p class="objection-cta">
            <a href="contact.html" class="btn-secondary">Get Security Assessment (Phase 3) →</a>
          </p>
        </div>
      </div>

    </div>

  </div>
</section>
```

**CSS for Objections Section** (add to `styles.css` around line 2300):

```css
/* ========================================
   DIRECTOR OBJECTIONS SECTION
   ======================================== */

.director-objections {
  padding: 100px 20px;
  background: linear-gradient(135deg, 
    rgba(10, 22, 40, 1) 0%, 
    rgba(15, 23, 42, 1) 100%
  );
}

.director-objections h2 {
  text-align: center;
  font-size: 42px;
  margin-bottom: 20px;
  color: var(--text-primary);
}

.director-objections .section-intro {
  text-align: center;
  font-size: 20px;
  color: var(--text-secondary);
  max-width: 800px;
  margin: 0 auto 60px;
}

.objections-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
  gap: 30px;
  max-width: 1400px;
  margin: 0 auto;
}

/* Objection Card */
.objection-card {
  background-color: rgba(255, 255, 255, 0.03);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 35px;
  transition: all 0.3s ease;
}

.objection-card:hover {
  border-color: var(--color-gold);
  transform: translateY(-5px);
  box-shadow: 0 15px 40px rgba(212, 175, 55, 0.2);
}

.objection-icon {
  font-size: 56px;
  margin-bottom: 20px;
}

.objection-card h3 {
  font-size: 24px;
  color: var(--text-primary);
  margin-bottom: 20px;
  line-height: 1.3;
}

.objection-response p {
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 15px;
}

.objection-response strong {
  color: var(--text-primary);
}

.objection-response em {
  color: var(--color-gold);
  font-style: italic;
}

.objection-response ul {
  list-style: none;
  padding: 0;
  margin: 15px 0;
}

.objection-response li {
  padding: 10px 0;
  padding-left: 30px;
  position: relative;
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.objection-response li::before {
  content: '✓';
  position: absolute;
  left: 0;
  color: var(--color-gold);
  font-weight: 700;
  font-size: 16px;
}

.objection-cta {
  margin-top: 25px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.objection-cta .btn-secondary {
  display: inline-block;
  padding: 12px 25px;
  background-color: transparent;
  border: 2px solid var(--color-gold);
  color: var(--color-gold);
  text-decoration: none;
  border-radius: 8px;
  font-weight: 600;
  transition: all 0.3s ease;
}

.objection-cta .btn-secondary:hover {
  background-color: var(--color-gold);
  color: var(--color-navy);
}

/* Responsive */
@media (max-width: 768px) {
  .objections-grid {
    grid-template-columns: 1fr;
  }
  
  .objection-card {
    padding: 25px;
  }
  
  .objection-card h3 {
    font-size: 20px;
  }
}
```

---

## Section 6: Modify "Audit-Grade Reliability" Section

### Current Code (Lines 140-180)

Currently says: *"For Risk Managers"* and *"For Shared Services"*

### Updated Code

```html
<section class="reliability">
  <div class="container">
    <h2>Built for Professional Responsibility</h2>
    <p class="section-intro">
      This isn't just about speed. It's about maintaining the professional standards 
      that protect your practicing certificate and your firm's reputation.
    </p>

    <div class="reliability-grid">

      <!-- For Practice Directors -->
      <div class="reliability-column">
        <h3>🛡️ For Practice Directors</h3>
        <p class="column-subtitle">Risk mitigation and compliance</p>
        
        <ul class="reliability-list">
          <li>
            <strong>Professional Indemnity Safe:</strong> Every AI extraction is queued for 
            qualified accountant review before posting. You maintain professional oversight, 
            as required by your PI policy.
          </li>
          <li>
            <strong>External Auditor Ready:</strong> Complete audit trails showing what the AI 
            extracted, what confidence score it assigned, and who approved it. Meets ASIC and 
            external audit requirements.
          </li>
          <li>
            <strong>TPB Compliant:</strong> Data sovereignty in Australian cloud datacenters. 
            No client data sent to offshore AI services. Meets Tax Practitioners Board data 
            security standards.
          </li>
          <li>
            <strong>Shadow IT Detection:</strong> Phase 3 identifies any "free" PDF tools or 
            unapproved AI services your staff might be using. Eliminates hidden compliance risks.
          </li>
        </ul>
      </div>

      <!-- For Operations/Shared Services -->
      <div class="reliability-column">
        <h3>⚙️ For Operations Managers</h3>
        <p class="column-subtitle">Efficiency and integration</p>
        
        <ul class="reliability-list">
          <li>
            <strong>Speed at Scale:</strong> Process 1,000+ invoices/month without adding 
            headcount. AI handles first-pass extraction; accountants focus on review and 
            exceptions.
          </li>
          <li>
            <strong>Direct ERP Integration:</strong> API integration with Xero, MYOB, Class. 
            No manual CSV uploads. Approved transactions flow directly into your accounting system.
          </li>
          <li>
            <strong>95%+ Extraction Accuracy:</strong> On structured documents (invoices, 
            statements), we target 95%+ accuracy. On unstructured documents (emails, contracts), 
            accuracy varies but confidence scoring flags uncertain extractions.
          </li>
          <li>
            <strong>Human-in-the-Loop:</strong> AI doesn't make final decisions. Qualified 
            accountants approve batches. Think "AI assistant" not "AI autopilot."
          </li>
        </ul>
      </div>

    </div>

    <!-- Important Clarification -->
    <div class="reliability-note">
      <h4>⚠️ What We DON'T Do:</h4>
      <ul>
        <li><strong>We don't provide audit opinions:</strong> We're not auditors. We automate 
        data extraction and processing. Your qualified accountants remain responsible for 
        professional judgments.</li>
        <li><strong>We don't sign off on financials:</strong> AI assists with data entry and 
        reconciliation. Qualified accountants still prepare and sign financial statements.</li>
        <li><strong>We don't take on professional liability:</strong> You remain liable for 
        work done under your practicing certificate. We provide tools to reduce errors, not 
        eliminate your professional responsibility.</li>
      </ul>
      <p class="reliability-cta">
        <strong>Our Responsibility:</strong> If our software has a bug (miscalculates a total, 
        fails to extract a field), we fix it at no cost. If the AI makes an incorrect business 
        rule interpretation, we retrain the model. But the accountant who approves the batch 
        is ultimately responsible—just like they would be if they manually keyed the data.
      </p>
    </div>

  </div>
</section>
```

**CSS Updates** (modify existing reliability styles around line 1100):

```css
/* Update existing .reliability styles */
.reliability-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  max-width: 1200px;
  margin: 0 auto 60px;
}

.reliability-column {
  background-color: rgba(255, 255, 255, 0.03);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 35px;
}

.reliability-column h3 {
  font-size: 28px;
  margin-bottom: 10px;
  color: var(--color-gold);
}

.column-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  font-style: italic;
  margin-bottom: 25px;
  padding-bottom: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.reliability-list {
  list-style: none;
  padding: 0;
}

.reliability-list li {
  padding: 15px 0;
  padding-left: 30px;
  position: relative;
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.7;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.reliability-list li:last-child {
  border-bottom: none;
}

.reliability-list li::before {
  content: '✓';
  position: absolute;
  left: 0;
  color: var(--color-gold);
  font-weight: 700;
}

.reliability-list strong {
  color: var(--text-primary);
  display: block;
  margin-bottom: 5px;
}

/* Reliability Note */
.reliability-note {
  max-width: 900px;
  margin: 0 auto;
  background-color: rgba(255, 165, 0, 0.1);
  border: 2px solid rgba(255, 165, 0, 0.4);
  border-radius: 12px;
  padding: 30px;
}

.reliability-note h4 {
  font-size: 22px;
  color: #FFA500;
  margin-bottom: 20px;
}

.reliability-note ul {
  list-style: none;
  padding: 0;
  margin: 0 0 20px 0;
}

.reliability-note li {
  padding: 12px 0;
  padding-left: 30px;
  position: relative;
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.reliability-note li::before {
  content: '→';
  position: absolute;
  left: 0;
  color: #FFA500;
  font-size: 18px;
}

.reliability-note strong {
  color: var(--text-primary);
}

.reliability-cta {
  background-color: rgba(255, 255, 255, 0.05);
  padding: 20px;
  border-radius: 8px;
  font-size: 15px;
  line-height: 1.7;
  color: var(--text-secondary);
  margin-top: 20px;
}

.reliability-cta strong {
  color: var(--color-gold);
}

/* Responsive */
@media (max-width: 968px) {
  .reliability-grid {
    grid-template-columns: 1fr;
  }
}
```

---

## Section 7: Remove All References to Other Industries

### Changes Required:

1. **In "The Three-Way Match" example** (currently mentions "Construction & Logistics")
   - **ALREADY REPLACED** in Section 2 above with accounting-specific examples

2. **In "Built for Australian Accounting Firms" section icons** (if any mention other industries)
   - **NO CHANGES NEEDED** - this section already focuses on accounting

3. **In demo/sample references:**
   - Keep mention of engineering only in context of: *"Technology proven on complex engineering documents, now applied to accounting"*
   - Remove any standalone references to logistics, healthcare, construction, etc.

**Example of Acceptable Reference:**

```html
<p class="tech-provenance">
  <strong>Technology Background:</strong> Our AI has been validated on complex technical 
  document processing (structural engineering schedules, load calculations). We're now 
  applying this proven technology to accounting workflows. Phase 1 tests whether it works 
  for your specific accounting documents.
</p>
```

**Find and Remove/Modify:**

Search the entire `accounting.html` file for:
- "logistics"
- "construction"
- "healthcare"
- "NDIS"
- "freight"
- "architecture"

If found outside of the context "technology was originally built for engineering but now applied to accounting", remove the reference.

---

## Section 8: Update Footer Links (Optional)

If the footer currently links to other industry pages, consider removing them from the accounting page footer or qualifying them.

### Current Footer (Lines 350-380)

```html
<footer>
  <div class="footer-links">
    <h4>Industries</h4>
    <ul>
      <li><a href="accounting.html">Accounting</a></li>
      <li><a href="legal.html">Legal</a></li>
      <li><a href="engineering.html">Engineering</a></li>
      <!-- etc -->
    </ul>
  </div>
</footer>
```

### Updated Footer (Optional - if you want to keep accounting-only focus)

```html
<footer>
  <div class="footer-links">
    <h4>For Accounting Firms</h4>
    <ul>
      <li><a href="accounting.html">Accounting Solutions</a></li>
      <li><a href="roi.html?industry=accounting">Calculate Your ROI</a></li>
      <li><a href="contact.html">Book Feasibility Sprint</a></li>
      <li><a href="faq.html">FAQ</a></li>
      <li><a href="case-study.html">Case Studies</a></li>
    </ul>
  </div>
  
  <div class="footer-links">
    <h4>Other Industries</h4>
    <p class="footer-note">
      This solution can be adapted for other professional services industries. 
      <a href="professional-services.html">View all industries →</a>
    </p>
  </div>
</footer>
```

---

## Testing Checklist

### Content Testing
- [ ] All three logic examples are accounting-specific (trust recon, inter-entity, GL coding)
- [ ] No references to "logistics," "construction," "healthcare" (except in tech provenance context)
- [ ] Refund conditions are clearly stated in hero section
- [ ] Phase 1 expectations are realistic and honest (no "$80K proof" claims)
- [ ] FAQ section answers director-level concerns
- [ ] Objections section addresses real hesitations

### Functional Testing
- [ ] FAQ accordion expands/collapses correctly
- [ ] FAQ items close when another is opened
- [ ] Mobile FAQ is fully readable and tappable
- [ ] All CTAs link to correct pages (`contact.html`, `roi.html?industry=accounting`)
- [ ] CSS doesn't break existing page layout
- [ ] New sections are responsive on mobile (≤768px)

### Copy Testing (Read Aloud)
- [ ] Tone is professional but honest (not salesy)
- [ ] No jargon or buzzwords that accounting directors wouldn't use
- [ ] Australian spelling used throughout (e.g., "recognise" not "recognize")
- [ ] Numbers are specific and believable (not "10x your revenue" hyperbole)

### Director Perspective Testing
- [ ] Show page to 2-3 accounting practice directors (if possible)
- [ ] Ask: "What's stopping you from booking the $1,500 test?"
- [ ] Refine objections section based on real feedback

---

## Deployment Steps

1. **Backup current `accounting.html`**
   ```bash
   cp accounting.html accounting.html.backup
   ```

2. **Make changes in order:**
   - Section 1: Hero guarantee text
   - Section 2: Replace examples (DELETE old examples, INSERT new ones)
   - Section 3: Update Phase 1 metrics section
   - Section 4: Add FAQ section (INSERT before "How Protocol Works")
   - Section 5: Add Objections section (INSERT after FAQ)
   - Section 6: Update Reliability section
   - Section 7: Remove other industry references
   - Section 8: Update footer (optional)

3. **Add CSS to `styles.css`** (append at end or in appropriate sections)

4. **Add JavaScript to `main.js`** (FAQ accordion functionality)

5. **Test locally:**
   ```bash
   python main.py
   # Visit http://localhost:5000/accounting
   ```

6. **Test mobile:**
   - Chrome DevTools → Toggle device toolbar
   - Test at 375px width (iPhone SE)
   - Test at 768px width (iPad)

7. **Deploy to Railway:**
   ```bash
   git add accounting.html assets/css/styles.css assets/js/main.js
   git commit -m "feat: Update accounting page with director-focused content, FAQ, and objections"
   git push origin main
   ```

8. **Verify production:**
   - Visit `https://curam-protocol.curam-ai.com.au/accounting`
   - Test all FAQ accordion items
   - Test all CTA links
   - Test mobile responsive

---

## Summary of Changes

| Section | Change Type | Lines Added | Impact |
|---------|-------------|-------------|--------|
| Hero Guarantee | Modify | +15 | Clarifies refund conditions |
| Logic Examples | Replace | +250 | Accounting-specific use cases |
| Phase 1 Metrics | Rewrite | +180 | Honest expectations, no false promises |
| FAQ Section | New | +400 | Addresses director concerns |
| Objections Section | New | +350 | Handles buying objections |
| Reliability Section | Rewrite | +80 | Director/ops focus, not IT focus |
| Industry References | Remove | -50 | Accounting-only focus |
| **TOTAL** | | **~1,325 lines** | **Significantly more credible** |

---

## Post-Implementation: Measure Results

### Track These Metrics (Pre vs Post):

1. **Engagement**:
   - Time on page (should increase with more content)
   - Scroll depth (% of visitors reaching FAQ/Objections sections)
   - Bounce rate (should decrease if content is compelling)

2. **Conversions**:
   - Click rate on "Book Feasibility Sprint" CTA
   - Form submissions from accounting page
   - Questions asked via contact form referencing specific FAQ items

3. **Qualitative Feedback**:
   - Ask callers: "What questions do you still have that aren't answered on the page?"
   - Note objections raised in sales calls (if not covered in Objections section, add them)

---

**END OF IMPLEMENTATION GUIDE**

Total Implementation Time: 8-12 hours  
Files Modified: 2 (accounting.html, styles.css, main.js)  
Lines Added: ~1,325  
Priority: High  
Risk Level: Low (mostly additive content, minimal breaking changes)
