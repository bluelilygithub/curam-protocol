# ROI Calculator - Universal Template Implementation Guide

**Purpose**: Update ROI calculator to be more credible and reusable across all industries  
**Target**: Development Team  
**Priority**: High  
**Estimated Time**: 3-4 hours (do once, benefits all industries)  
**Date**: December 12, 2025

---

## Overview

This guide shows you how to:

1. **Update Engineering calculator** (immediate fix)
2. **Create universal results page template** (works for all industries)
3. **Set up Accounting calculator** (example of replication)
4. **Add future industries in 15 minutes** (repeatable process)

**Key Principle**: Fix it once, use it everywhere.

---

## Table of Contents

1. [Current State Assessment](#current-state-assessment)
2. [Universal Template Structure](#universal-template-structure)
3. [Part 1: Update Engineering Calculator](#part-1-update-engineering-calculator)
4. [Part 2: Create Universal Results Page](#part-2-create-universal-results-page)
5. [Part 3: Set Up Accounting Calculator](#part-3-set-up-accounting-calculator)
6. [Part 4: Add New Industries (15-Min Process)](#part-4-add-new-industries)
7. [Testing Checklist](#testing-checklist)
8. [Deployment Steps](#deployment-steps)

---

## Current State Assessment

### What's Already Good ✅

- **Universal inputs work for all industries**: Staff count, average rate, hours per week
- **4-step flow is simple**: Not overwhelming, takes 2 minutes
- **Calculation logic is sound**: Annual burn rate formula works universally
- **Big number creates urgency**: "$XXX,XXX wasted annually" is compelling

### What Needs Fixing ❌

1. **Results page lacks credibility** - No caveat that "this is an estimate"
2. **Phase 1 CTA is weak** - Not emphasized as the primary next step
3. **No guarantee emphasis** - "$1,500 refundable" not clearly stated
4. **Industry-specific questions need refinement** - Especially accounting

---

## Universal Template Structure

### Files Modified

```
roi_calculator_flask.py          # Industry configs (Python)
templates/
  ├── roi_step2_input.html       # Input form (uses industry config)
  └── roi_step3_results.html     # Results page (universal template)
assets/
  └── css/roi_calculator.css     # Styles for new sections
```

### Data Flow

```
User selects industry (Step 1)
    ↓
Step 2: Input form loads with industry-specific questions
    ↓
User submits inputs
    ↓
Step 3: Results page shows:
    - Big scary number
    - Reality check ("This is an estimate")
    - Phase 1 explainer (universal)
    - Primary CTA: Book $1,500 test
    - Secondary CTAs: Demo, Learn More
```

---

# Part 1: Update Engineering Calculator

## Step 1.1: Improve Industry-Specific Question

### Current Question (Keep Structure, Improve Clarity)

**File**: `roi_calculator_flask.py` (around line 50)

**Current Code**:
```python
"Architecture & Building Services": {
    "context": "Architecture and engineering firms (15-100 staff)",
    "pain_point_question": "How do you currently compile Drawing Registers and Window/Door Schedules?",
    "pain_point_options": [
        {"value": 0, "label": "Automated BIM export (Low pain)"},
        {"value": 5, "label": "Export to Excel, then manual formatting (Medium pain)"},
        {"value": 10, "label": "Manual typing in CAD title blocks (High pain)"}
    ],
    "weekly_hours_question": "Hours per week, per engineer, spent on spec writing & manual data entry?",
    "weekly_hours_range": [0, 20, 6.0],
    "demo_documents": "drawing registers, schedules, transmittals"
}
```

**Updated Code** (More specific, relatable):

```python
"Architecture & Building Services": {
    "context": "Architecture and engineering firms (15-100 staff)",
    
    # IMPROVED: More specific pain point question
    "pain_point_question": "What's your biggest documentation bottleneck?",
    "pain_point_options": [
        {
            "value": 0, 
            "label": "Drawing Registers (Automated BIM export)", 
            "description": "Low pain - mostly automated"
        },
        {
            "value": 5, 
            "label": "Drawing Registers (Export to Excel, manual formatting)", 
            "description": "Medium pain - significant manual cleanup"
        },
        {
            "value": 7, 
            "label": "Specification Writing (Copy-paste from Masterspec/Natspec)", 
            "description": "Medium-high pain - repetitive but requires judgment"
        },
        {
            "value": 10, 
            "label": "Document Transmittals (Manual creation and tracking)", 
            "description": "High pain - fully manual, time-consuming"
        }
    ],
    
    # IMPROVED: Clearer weekly hours question
    "weekly_hours_question": "Total firm-wide hours per week on manual documentation (all staff combined)",
    "weekly_hours_range": [10, 200, 80],  # [min, max, default]
    "weekly_hours_help_text": "Example: 25 staff × 4 hours each = 100 hours/week",
    
    # What we'll test in Phase 1
    "demo_documents": "drawing registers, BIM schedules, or document transmittals",
    
    # Industry-specific ROI multiplier (optional, for future use)
    "automation_potential": 0.40  # 40% of manual work can be automated
}
```

**Why This Is Better**:
- ✅ Gives 4 specific pain points (not just one generic question)
- ✅ Each option has description for clarity
- ✅ Weekly hours question is clearer ("total firm-wide" not "per engineer")
- ✅ Includes help text with example calculation
- ✅ More realistic range (10-200 hours vs 0-20)

---

## Step 1.2: Update Input Form Template

**File**: `templates/roi_step2_input.html` (or wherever Step 2 HTML lives)

### Add Industry Context Banner (Top of Form)

**Insert BEFORE** the form starts:

```html
<!-- INDUSTRY CONTEXT BANNER -->
<div class="industry-context-banner">
    <div class="context-icon">🏗️</div>
    <div class="context-content">
        <h4>You're viewing: Architecture & Building Services</h4>
        <p>Questions are tailored to engineering and architecture workflows. 
        <a href="/roi-calculator/" style="color: #D4AF37; text-decoration: underline;">
            View other industries →
        </a></p>
    </div>
</div>

<style>
.industry-context-banner {
    background: linear-gradient(135deg, rgba(212, 175, 55, 0.1), rgba(212, 175, 55, 0.05));
    border: 2px solid rgba(212, 175, 55, 0.3);
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 2rem;
    display: flex;
    align-items: center;
    gap: 1rem;
}

.context-icon {
    font-size: 3rem;
    flex-shrink: 0;
}

.context-content h4 {
    color: #0B1221;
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
}

.context-content p {
    color: #4B5563;
    font-size: 0.9rem;
    margin: 0;
    line-height: 1.5;
}
</style>
```

---

### Update Industry-Specific Question (Use Config)

**Current Code** (hardcoded):
```html
<div class="form-group">
    <label>How do you currently compile Drawing Registers and Window/Door Schedules?</label>
    
    <div class="radio-group">
        <input type="radio" name="pain_point" value="0" id="pain_1" required>
        <label for="pain_1">Automated BIM export (Low pain)</label>
    </div>
    
    <div class="radio-group">
        <input type="radio" name="pain_point" value="5" id="pain_2" checked required>
        <label for="pain_2">Export to Excel, then manual formatting (Medium pain)</label>
    </div>
    
    <div class="radio-group">
        <input type="radio" name="pain_point" value="10" id="pain_3" required>
        <label for="pain_3">Manual typing in CAD title blocks (High pain)</label>
    </div>
</div>
```

**Updated Code** (uses industry config):

```html
<div class="form-group">
    <label>{{ industry_config.pain_point_question }}</label>
    
    {% for option in industry_config.pain_point_options %}
    <div class="radio-group-enhanced">
        <input type="radio" 
               name="pain_point" 
               value="{{ option.value }}" 
               id="pain_{{ loop.index }}" 
               {% if loop.index == 2 %}checked{% endif %}
               required>
        <label for="pain_{{ loop.index }}">
            <strong>{{ option.label }}</strong>
            {% if option.description %}
            <br><small style="color: #4B5563; font-weight: normal;">{{ option.description }}</small>
            {% endif %}
        </label>
    </div>
    {% endfor %}
</div>

<style>
.radio-group-enhanced {
    margin: 0.75rem 0;
    padding: 1rem;
    border: 2px solid #E5E7EB;
    border-radius: 8px;
    transition: all 0.3s ease;
    cursor: pointer;
}

.radio-group-enhanced:hover {
    border-color: #D4AF37;
    background-color: rgba(212, 175, 55, 0.05);
}

.radio-group-enhanced input[type="radio"]:checked + label {
    color: #0B1221;
    font-weight: 700;
}

.radio-group-enhanced input[type="radio"]:checked {
    accent-color: #D4AF37;
}

.radio-group-enhanced label {
    display: block;
    cursor: pointer;
    margin-left: 2rem;
}

.radio-group-enhanced label strong {
    font-size: 1rem;
    line-height: 1.4;
}

.radio-group-enhanced label small {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.85rem;
    line-height: 1.4;
}
</style>
```

---

### Update Weekly Hours Question

**Current Code**:
```html
<div class="form-group">
    <label>Hours per week, per engineer, spent on spec writing & manual data entry?</label>
    
    <div class="slider-container">
        <input type="range" name="weekly_waste_slider" id="weekly_waste_slider" 
               value="6.0" min="0" max="20" step="0.5" 
               oninput="document.getElementById('weekly_waste').value = this.value">
        <input type="number" name="weekly_waste" id="weekly_waste" 
               value="6.0" min="0" max="20" step="0.5" required
               oninput="document.getElementById('weekly_waste_slider').value = this.value">
        <span>hours</span>
    </div>
</div>
```

**Updated Code** (clearer, uses config):

```html
<div class="form-group">
    <label>{{ industry_config.weekly_hours_question }}</label>
    
    {% if industry_config.weekly_hours_help_text %}
    <p style="color: #4B5563; font-size: 0.9rem; margin-bottom: 1rem; font-style: italic;">
        {{ industry_config.weekly_hours_help_text }}
    </p>
    {% endif %}
    
    <div class="slider-container">
        <input type="range" 
               name="weekly_waste_slider" 
               id="weekly_waste_slider" 
               value="{{ industry_config.weekly_hours_range[2] }}" 
               min="{{ industry_config.weekly_hours_range[0] }}" 
               max="{{ industry_config.weekly_hours_range[1] }}" 
               step="5" 
               oninput="document.getElementById('weekly_waste').value = this.value">
        <input type="number" 
               name="weekly_waste" 
               id="weekly_waste" 
               value="{{ industry_config.weekly_hours_range[2] }}" 
               min="{{ industry_config.weekly_hours_range[0] }}" 
               max="{{ industry_config.weekly_hours_range[1] }}" 
               step="5" 
               required
               oninput="document.getElementById('weekly_waste_slider').value = this.value">
        <span>hours/week</span>
    </div>
</div>
```

---

### Add Disclaimer Before Submit

**Insert BEFORE** the button group:

```html
<div class="form-disclaimer">
    <h4>⚠️ Quick Estimate Only</h4>
    <p>
        This calculator provides a <strong>ballpark figure</strong> to help you decide 
        if a $1,500 feasibility test is worth your time. For accurate ROI based on YOUR 
        specific workflows, we need to test YOUR documents in Phase 1.
    </p>
</div>

<style>
.form-disclaimer {
    background: #FFF4E6;
    border-left: 4px solid #D4AF37;
    padding: 1.5rem;
    margin: 2rem 0;
    border-radius: 8px;
}

.form-disclaimer h4 {
    color: #0B1221;
    font-size: 1rem;
    font-weight: 700;
    margin: 0 0 0.75rem 0;
}

.form-disclaimer p {
    color: #4B5563;
    font-size: 0.9rem;
    line-height: 1.6;
    margin: 0;
}

.form-disclaimer strong {
    color: #0B1221;
}
</style>
```

---

# Part 2: Create Universal Results Page

**This section is 100% reusable across all industries.**

## Step 2.1: Results Page Structure

**File**: `templates/roi_step3_results.html` (or wherever results are displayed)

### Complete Results Page Template

**Replace entire results page with this universal template:**

```html
<!DOCTYPE html>
<html>
<head>
    <title>Your ROI Projection - Curam AI</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    
    <!-- Include your existing styles -->
    <link rel="stylesheet" href="/assets/css/roi_calculator.css">
    
    <style>
        /* Additional styles for new sections */
        .results-container {
            max-width: 900px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        /* BIG SCARY NUMBER */
        .annual-burn-section {
            background: linear-gradient(135deg, #0B1221, #1a2332);
            border-radius: 16px;
            padding: 3rem 2rem;
            text-align: center;
            margin: 2rem 0;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        }
        
        .burn-label {
            color: #D4AF37;
            font-size: 1rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 1rem;
        }
        
        .burn-amount {
            font-size: 4rem;
            font-weight: 800;
            background: linear-gradient(135deg, #D4AF37, #FFD700);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 1rem;
            line-height: 1;
        }
        
        .burn-sublabel {
            color: rgba(255, 255, 255, 0.7);
            font-size: 0.95rem;
            font-style: italic;
        }
        
        /* INTERPRETATION BOX */
        .interpretation-box {
            background: white;
            border: 2px solid #E5E7EB;
            border-radius: 12px;
            padding: 2rem;
            margin: 2rem 0;
        }
        
        .interpretation-box h3 {
            color: #0B1221;
            font-size: 1.5rem;
            margin-bottom: 1rem;
        }
        
        .interpretation-box ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        
        .interpretation-box li {
            padding: 0.75rem 0;
            padding-left: 2rem;
            position: relative;
            color: #4B5563;
            font-size: 1rem;
            line-height: 1.6;
            border-bottom: 1px solid #E5E7EB;
        }
        
        .interpretation-box li:last-child {
            border-bottom: none;
        }
        
        .interpretation-box li::before {
            content: '→';
            position: absolute;
            left: 0;
            color: #D4AF37;
            font-weight: 700;
            font-size: 1.2rem;
        }
        
        .interpretation-box strong {
            color: #0B1221;
            font-weight: 700;
        }
        
        /* REALITY CHECK BOX */
        .reality-check-box {
            background: linear-gradient(135deg, rgba(255, 165, 0, 0.1), rgba(255, 165, 0, 0.05));
            border: 2px solid rgba(255, 165, 0, 0.4);
            border-radius: 12px;
            padding: 2rem;
            margin: 2rem 0;
        }
        
        .reality-check-box h3 {
            color: #FF8C00;
            font-size: 1.5rem;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .reality-check-box p {
            color: #4B5563;
            font-size: 1rem;
            line-height: 1.7;
            margin-bottom: 1rem;
        }
        
        .reality-check-box ul {
            list-style: none;
            padding: 0;
            margin: 1rem 0;
        }
        
        .reality-check-box li {
            padding: 0.5rem 0;
            padding-left: 1.5rem;
            position: relative;
            color: #4B5563;
            line-height: 1.6;
        }
        
        .reality-check-box li::before {
            content: '✗';
            position: absolute;
            left: 0;
            color: #FF8C00;
            font-weight: 700;
        }
        
        .reality-check-box .caveat-emphasis {
            background: white;
            padding: 1rem;
            border-radius: 8px;
            border-left: 4px solid #FF8C00;
            margin-top: 1rem;
            font-weight: 600;
            color: #0B1221;
        }
        
        /* PHASE 1 EXPLAINER */
        .phase1-explainer {
            background: linear-gradient(135deg, rgba(212, 175, 55, 0.1), rgba(212, 175, 55, 0.05));
            border: 2px solid rgba(212, 175, 55, 0.3);
            border-radius: 12px;
            padding: 2.5rem;
            margin: 3rem 0;
        }
        
        .phase1-explainer h2 {
            color: #0B1221;
            font-size: 2rem;
            margin-bottom: 1.5rem;
            text-align: center;
        }
        
        .phase1-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
            margin: 2rem 0;
        }
        
        @media (max-width: 768px) {
            .phase1-grid {
                grid-template-columns: 1fr;
            }
        }
        
        .phase1-column {
            background: white;
            border-radius: 8px;
            padding: 1.5rem;
            border: 1px solid #E5E7EB;
        }
        
        .phase1-column h4 {
            color: #0B1221;
            font-size: 1.1rem;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .phase1-column ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        
        .phase1-column li {
            padding: 0.75rem 0;
            padding-left: 2rem;
            position: relative;
            color: #4B5563;
            font-size: 0.95rem;
            line-height: 1.6;
            border-bottom: 1px solid #F8F9FA;
        }
        
        .phase1-column li:last-child {
            border-bottom: none;
        }
        
        .phase1-column li::before {
            content: '✓';
            position: absolute;
            left: 0;
            color: #4CAF50;
            font-weight: 700;
        }
        
        /* GUARANTEE BOX */
        .guarantee-box {
            background: white;
            border: 2px solid #4CAF50;
            border-radius: 12px;
            padding: 2rem;
            margin: 2rem 0;
        }
        
        .guarantee-box h4 {
            color: #4CAF50;
            font-size: 1.3rem;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .guarantee-box p {
            color: #4B5563;
            font-size: 1rem;
            line-height: 1.7;
            margin-bottom: 1rem;
        }
        
        .guarantee-box strong {
            color: #0B1221;
        }
        
        .guarantee-condition {
            font-size: 0.9rem;
            color: #6B7280;
            background: #F8F9FA;
            padding: 1rem;
            border-radius: 8px;
            margin-top: 1rem;
        }
        
        /* PRIMARY CTA */
        .primary-cta-section {
            text-align: center;
            margin: 3rem 0;
            padding: 2rem;
            background: white;
            border-radius: 12px;
            border: 2px solid #D4AF37;
        }
        
        .btn-primary-huge {
            display: inline-block;
            background: linear-gradient(135deg, #D4AF37, #B8941F);
            color: #0B1221;
            font-size: 1.3rem;
            font-weight: 700;
            padding: 1.25rem 3rem;
            border-radius: 8px;
            text-decoration: none;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(212, 175, 55, 0.3);
        }
        
        .btn-primary-huge:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 25px rgba(212, 175, 55, 0.4);
            background: linear-gradient(135deg, #B8941F, #D4AF37);
        }
        
        .cta-subtext {
            margin-top: 1rem;
            color: #4B5563;
            font-size: 0.95rem;
            font-style: italic;
        }
        
        /* SECONDARY CTAs */
        .secondary-ctas {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
            margin: 2rem 0;
        }
        
        .btn-secondary {
            display: inline-block;
            background: transparent;
            color: #D4AF37;
            font-size: 1rem;
            font-weight: 600;
            padding: 0.75rem 2rem;
            border: 2px solid #D4AF37;
            border-radius: 8px;
            text-decoration: none;
            transition: all 0.3s ease;
        }
        
        .btn-secondary:hover {
            background: #D4AF37;
            color: #0B1221;
            transform: translateY(-2px);
        }
        
        /* PHASE 1 TIMELINE */
        .phase1-timeline {
            margin: 2rem 0;
        }
        
        .timeline-step {
            display: flex;
            gap: 1.5rem;
            margin-bottom: 1.5rem;
            padding-bottom: 1.5rem;
            border-bottom: 1px solid #E5E7EB;
        }
        
        .timeline-step:last-child {
            border-bottom: none;
        }
        
        .step-day {
            flex-shrink: 0;
            width: 80px;
            font-weight: 700;
            color: #D4AF37;
            font-size: 0.9rem;
        }
        
        .step-content {
            flex: 1;
        }
        
        .step-action {
            font-weight: 700;
            color: #0B1221;
            font-size: 1.05rem;
            margin-bottom: 0.5rem;
        }
        
        .step-detail {
            color: #4B5563;
            font-size: 0.95rem;
            line-height: 1.6;
        }
    </style>
</head>
<body>
    <div class="results-container">
        
        <!-- STEP INDICATOR -->
        <div class="step-indicator">
            <a href="/roi-calculator/?step=1" class="step completed">1</a>
            <a href="/roi-calculator/?step=2" class="step completed">2</a>
            <span class="step active">3</span>
            <span class="step">4</span>
        </div>
        
        <!-- INDUSTRY CONTEXT (from config) -->
        <h1 style="text-align: center; color: #0B1221; margin-bottom: 0.5rem;">
            Your ROI Projection: {{ industry_name }}
        </h1>
        <p style="text-align: center; color: #4B5563; margin-bottom: 2rem;">
            Based on your inputs
        </p>
        
        <hr>
        
        <!-- ========================================
             SECTION 1: BIG SCARY NUMBER
             ======================================== -->
        <div class="annual-burn-section">
            <div class="burn-label">Annual Waste on Manual Processing</div>
            <div class="burn-amount">${{ annual_burn | format_currency }}</div>
            <div class="burn-sublabel">Based on your inputs</div>
        </div>
        
        <!-- ========================================
             SECTION 2: WHAT THIS MEANS
             ======================================== -->
        <div class="interpretation-box">
            <h3>What This Means:</h3>
            <ul>
                <li>Your staff spend <strong>{{ total_weekly_hours }} hours/week</strong> on manual document processing</li>
                <li>That's <strong>{{ total_annual_hours | format_number }} hours/year</strong> of wasted capacity</li>
                <li>At an average rate of <strong>${{ avg_rate }}/hour</strong>, you're burning <strong>${{ annual_burn | format_currency }}/year</strong></li>
                <li>If you could automate 40% of this work, you'd save <strong>${{ tier1_savings | format_currency }}/year</strong></li>
            </ul>
        </div>
        
        <!-- ========================================
             SECTION 3: REALITY CHECK (CRITICAL)
             ======================================== -->
        <div class="reality-check-box">
            <h3>⚠️ Important: This is an ESTIMATE</h3>
            <p>
                This calculator uses <strong>industry averages</strong> and 
                <strong>generic assumptions</strong>. We don't actually know:
            </p>
            <ul>
                <li>How YOUR firm actually works (your unique workflows and processes)</li>
                <li>Which of YOUR tasks can realistically be automated (vs require human judgment)</li>
                <li>Whether YOUR documents are suitable for AI extraction (format, quality, complexity)</li>
                <li>If YOUR staff will adopt new workflows (change management is the #1 risk)</li>
                <li>What YOUR specific baseline efficiency is (you might already be more efficient than average)</li>
            </ul>
            <div class="caveat-emphasis">
                That's why Phase 1 exists: to replace these guesses with proof using YOUR actual documents.
            </div>
        </div>
        
        <!-- ========================================
             SECTION 4: PHASE 1 EXPLAINER (UNIVERSAL)
             ======================================== -->
        <div class="phase1-explainer">
            <h2>Replace This Estimate With Proof: $1,500 Feasibility Sprint</h2>
            
            <div class="phase1-grid">
                <!-- What We Test -->
                <div class="phase1-column">
                    <h4>📋 What We'll Test (48 hours):</h4>
                    <ul>
                        <li>30 of YOUR documents ({{ industry_config.demo_documents }})</li>
                        <li>AI extraction accuracy on YOUR specific document formats</li>
                        <li>Time savings based on YOUR baseline process (not industry averages)</li>
                        <li>Integration feasibility with YOUR systems</li>
                    </ul>
                </div>
                
                <!-- What You Get -->
                <div class="phase1-column">
                    <h4>✅ What You Get:</h4>
                    <ul>
                        <li>Accuracy report showing extraction results on your docs</li>
                        <li>ROI calculation using YOUR data (not generic estimates)</li>
                        <li>Feasibility assessment: "Will this work for us?"</li>
                        <li>Decision point: Proceed to Phase 2 or walk away with full refund</li>
                    </ul>
                </div>
            </div>
            
            <!-- Timeline -->
            <div class="phase1-timeline">
                <div class="timeline-step">
                    <div class="step-day">Day 1 AM</div>
                    <div class="step-content">
                        <div class="step-action">Kickoff Call (1 hour)</div>
                        <div class="step-detail">
                            You explain your biggest pain point. We explain what we'll test. 
                            You provide access to 30 sample documents.
                        </div>
                    </div>
                </div>
                
                <div class="timeline-step">
                    <div class="step-day">Day 1 PM</div>
                    <div class="step-content">
                        <div class="step-action">You Upload Documents</div>
                        <div class="step-detail">
                            {{ industry_config.demo_documents }} - whatever workflow hurts most. 
                            Drag-and-drop to SharePoint folder. Takes 30 minutes.
                        </div>
                    </div>
                </div>
                
                <div class="timeline-step">
                    <div class="step-day">Day 2</div>
                    <div class="step-content">
                        <div class="step-action">We Process & Test</div>
                        <div class="step-detail">
                            AI extracts data from your documents. We calculate accuracy against 
                            ground truth. No work required from you.
                        </div>
                    </div>
                </div>
                
                <div class="timeline-step">
                    <div class="step-day">Day 3</div>
                    <div class="step-content">
                        <div class="step-action">Results Review (30 minutes)</div>
                        <div class="step-detail">
                            We show you accuracy results. If ≥90%, you decide whether to proceed 
                            to Phase 2. If <90%, full refund. No questions asked.
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Guarantee -->
            <div class="guarantee-box">
                <h4>🛡️ Zero-Risk Guarantee:</h4>
                <p>
                    If we don't achieve <strong>90%+ accuracy</strong> on your documents, 
                    you get a <strong>full refund</strong>. No questions asked. No fine print.
                </p>
                <div class="guarantee-condition">
                    <strong>Only condition:</strong> You provide the 30 documents and respond 
                    to clarification questions promptly. We can't test if you don't participate.
                </div>
            </div>
        </div>
        
        <!-- ========================================
             SECTION 5: PRIMARY CTA
             ======================================== -->
        <div class="primary-cta-section">
            <a href="/contact" class="btn-primary-huge">
                Book $1,500 Feasibility Test →
            </a>
            <p class="cta-subtext">
                3 hours of your time. 48-hour turnaround. Full refund if accuracy <90%.
            </p>
        </div>
        
        <!-- ========================================
             SECTION 6: SECONDARY CTAs
             ======================================== -->
        <div class="secondary-ctas">
            <a href="/automater" class="btn-secondary">
                Try Assessment Demo First →
            </a>
            <a href="/{{ industry_slug }}" class="btn-secondary">
                Learn More About {{ industry_name }} Solutions →
            </a>
        </div>
        
        <hr style="margin: 3rem 0;">
        
        <!-- ========================================
             SECTION 7: DETAILED BREAKDOWN (Optional)
             ======================================== -->
        <details style="margin-top: 2rem;">
            <summary style="cursor: pointer; font-weight: 700; color: #0B1221; font-size: 1.1rem;">
                📊 View Detailed Calculation Breakdown
            </summary>
            
            <div style="margin-top: 1.5rem; padding: 1.5rem; background: #F8F9FA; border-radius: 8px;">
                <h3>Your Inputs:</h3>
                <ul style="list-style: none; padding: 0;">
                    <li style="padding: 0.5rem 0; border-bottom: 1px solid #E5E7EB;">
                        <strong>Industry:</strong> {{ industry_name }}
                    </li>
                    <li style="padding: 0.5rem 0; border-bottom: 1px solid #E5E7EB;">
                        <strong>Staff Count:</strong> {{ staff_count }}
                    </li>
                    <li style="padding: 0.5rem 0; border-bottom: 1px solid #E5E7EB;">
                        <strong>Average Rate:</strong> ${{ avg_rate }}/hour
                    </li>
                    <li style="padding: 0.5rem 0; border-bottom: 1px solid #E5E7EB;">
                        <strong>Weekly Hours on Manual Work:</strong> {{ total_weekly_hours }} hours
                    </li>
                    <li style="padding: 0.5rem 0;">
                        <strong>Pain Point:</strong> {{ pain_point_description }}
                    </li>
                </ul>
                
                <h3 style="margin-top: 2rem;">Calculation:</h3>
                <ul style="list-style: none; padding: 0;">
                    <li style="padding: 0.5rem 0; border-bottom: 1px solid #E5E7EB;">
                        <strong>Annual Hours Wasted:</strong> {{ total_weekly_hours }} hrs/week × 48 weeks = {{ total_annual_hours | format_number }} hours
                    </li>
                    <li style="padding: 0.5rem 0; border-bottom: 1px solid #E5E7EB;">
                        <strong>Annual Burn Rate:</strong> {{ total_annual_hours | format_number }} hrs × ${{ avg_rate }}/hr = ${{ annual_burn | format_currency }}
                    </li>
                    <li style="padding: 0.5rem 0; border-bottom: 1px solid #E5E7EB;">
                        <strong>Automation Potential:</strong> 40% (industry average)
                    </li>
                    <li style="padding: 0.5rem 0;">
                        <strong>Tier 1 Savings (40% reduction):</strong> ${{ annual_burn | format_currency }} × 0.40 = ${{ tier1_savings | format_currency }}
                    </li>
                </ul>
                
                <div style="background: #FFF4E6; padding: 1rem; margin-top: 1.5rem; border-radius: 8px; border-left: 4px solid #D4AF37;">
                    <strong>Note:</strong> These are projections based on industry averages. Your actual 
                    results will vary based on your specific workflows, staff efficiency, and automation 
                    adoption rates. Phase 1 calculates YOUR specific numbers.
                </div>
            </div>
        </details>
        
    </div>
</body>
</html>
```

---

## Step 2.2: Backend Variables to Pass to Template

**File**: `roi_calculator_flask.py` (calculation function)

Make sure your calculation function passes these variables to the template:

```python
@app.route('/roi-calculator/', methods=['POST'])
def calculate_roi():
    # Get form inputs
    industry_name = request.form.get('industry')
    staff_count = int(request.form.get('staff_count'))
    avg_rate = float(request.form.get('avg_rate'))
    total_weekly_hours = float(request.form.get('weekly_waste'))
    pain_point_value = int(request.form.get('pain_point'))
    
    # Get industry config
    industry_config = INDUSTRIES.get(industry_name)
    
    # Calculations
    total_annual_hours = total_weekly_hours * 48  # 48 working weeks
    annual_burn = total_annual_hours * avg_rate
    tier1_savings = annual_burn * 0.40  # 40% automation potential
    
    # Get pain point description
    pain_point_description = "Not specified"
    for option in industry_config['pain_point_options']:
        if option['value'] == pain_point_value:
            pain_point_description = option['label']
            break
    
    # Industry slug for URL
    industry_slug = industry_name.lower().replace(' & ', '-').replace(' ', '-')
    
    # Render results page
    return render_template('roi_step3_results.html',
        industry_name=industry_name,
        industry_slug=industry_slug,
        industry_config=industry_config,
        staff_count=staff_count,
        avg_rate=avg_rate,
        total_weekly_hours=total_weekly_hours,
        total_annual_hours=total_annual_hours,
        annual_burn=annual_burn,
        tier1_savings=tier1_savings,
        pain_point_description=pain_point_description
    )
```

---

# Part 3: Set Up Accounting Calculator

**This demonstrates how to replicate the template for a new industry.**

## Step 3.1: Add Accounting Industry Config

**File**: `roi_calculator_flask.py`

**Add this to your `INDUSTRIES` dictionary:**

```python
INDUSTRIES = {
    # ... existing Architecture & Building Services config ...
    
    "Accounting & Advisory": {
        "context": "Australian accounting firms (15-100 staff)",
        
        # Industry-specific pain point question
        "pain_point_question": "What's your biggest manual processing pain point?",
        "pain_point_options": [
            {
                "value": 3,
                "label": "Invoice Data Entry (Typing vendor invoices into Xero/MYOB)",
                "description": "Low-medium pain - repetitive but straightforward"
            },
            {
                "value": 6,
                "label": "Complex GL Coding (Multi-line invoices requiring judgment)",
                "description": "Medium pain - requires accounting knowledge"
            },
            {
                "value": 8,
                "label": "Trust Account Reconciliations (Matching deposits to matter files)",
                "description": "Medium-high pain - high-stakes, time-consuming"
            },
            {
                "value": 10,
                "label": "Inter-Entity Transaction Matching (Consolidation reconciliations)",
                "description": "High pain - complex, error-prone, senior staff time"
            }
        ],
        
        # Weekly hours question
        "weekly_hours_question": "Total firm-wide hours per week on manual processing (all staff combined)",
        "weekly_hours_range": [10, 200, 60],  # [min, max, default]
        "weekly_hours_help_text": "Example: 15 staff × 4 hours each = 60 hours/week. Include: data entry, reconciliations, GL coding, trust account matching.",
        
        # What we'll test in Phase 1
        "demo_documents": "invoices, bank statements, trust account transactions, or inter-entity reconciliations",
        
        # Industry-specific automation potential
        "automation_potential": 0.40  # 40% baseline
    }
}
```

---

## Step 3.2: Update Step 1 (Industry Selection)

**File**: `templates/roi_step1_industry.html`

**Add Accounting card to industry grid:**

```html
<div class="industry-grid">
    
    <!-- Existing: Architecture & Building Services -->
    <div class="industry-card" onclick="selectIndustry('Architecture & Building Services')">
        <div class="industry-icon">🏗️</div>
        <h3>Architecture & Building Services</h3>
        <p>Drawing registers, BIM schedules, transmittals</p>
    </div>
    
    <!-- NEW: Accounting & Advisory -->
    <div class="industry-card" onclick="selectIndustry('Accounting & Advisory')">
        <div class="industry-icon">🏢</div>
        <h3>Accounting & Advisory</h3>
        <p>Invoice processing, trust accounts, GL coding, reconciliations</p>
    </div>
    
    <!-- Add more industries as needed -->
    
</div>

<script>
function selectIndustry(industry) {
    window.location.href = '/roi-calculator/?step=2&industry=' + encodeURIComponent(industry);
}
</script>
```

---

## Step 3.3: Test Accounting Calculator

### Test Inputs:
- **Staff Count**: 15
- **Average Rate**: $250/hour
- **Weekly Hours**: 60 hours/week
- **Pain Point**: Inter-Entity Transaction Matching (value 10)

### Expected Results:
- **Total Annual Hours**: 60 × 48 = 2,880 hours
- **Annual Burn**: 2,880 × $250 = $720,000
- **Tier 1 Savings (40%)**: $720,000 × 0.40 = $288,000

### What Shows on Results Page:
```
┌────────────────────────────────────────┐
│ Annual Waste on Manual Processing     │
│         $720,000                       │
│      Based on your inputs              │
└────────────────────────────────────────┘

What This Means:
→ Your staff spend 60 hours/week on manual document processing
→ That's 2,880 hours/year of wasted capacity
→ At an average rate of $250/hour, you're burning $720,000/year
→ If you could automate 40% of this work, you'd save $288,000/year

⚠️ Important: This is an ESTIMATE
[Reality check box...]

Replace This Estimate With Proof: $1,500 Feasibility Sprint
What We'll Test (48 hours):
✓ 30 of YOUR documents (invoices, bank statements, trust account transactions, or inter-entity reconciliations)
✓ AI extraction accuracy on YOUR specific document formats
[etc...]

[Book $1,500 Feasibility Test →]
```

---

# Part 4: Add New Industries (15-Minute Process)

**This section shows you how to add any future industry quickly.**

## Step 4.1: Industry Config Template

**Copy this template and fill in the blanks:**

```python
"[INDUSTRY NAME]": {
    "context": "[Target market description]",
    
    "pain_point_question": "[What's your biggest pain point / bottleneck / challenge?]",
    "pain_point_options": [
        {
            "value": [0-3],  # Low pain
            "label": "[Pain Point 1 - Low Severity]",
            "description": "[Brief explanation]"
        },
        {
            "value": [4-6],  # Medium pain
            "label": "[Pain Point 2 - Medium Severity]",
            "description": "[Brief explanation]"
        },
        {
            "value": [7-9],  # Medium-high pain
            "label": "[Pain Point 3 - Medium-High Severity]",
            "description": "[Brief explanation]"
        },
        {
            "value": 10,  # High pain
            "label": "[Pain Point 4 - High Severity]",
            "description": "[Brief explanation]"
        }
    ],
    
    "weekly_hours_question": "Total firm-wide hours per week on [specific manual task]",
    "weekly_hours_range": [10, 200, [reasonable default]],
    "weekly_hours_help_text": "Example: [X] staff × [Y] hours each = [Z] hours/week",
    
    "demo_documents": "[type of documents you'd test in Phase 1]",
    
    "automation_potential": 0.40  # Start with 40%, adjust based on industry complexity
}
```

---

## Step 4.2: Example - Legal Services

**Time to add: 15 minutes**

```python
"Legal Services": {
    "context": "Legal practices and law firms (10-100 staff)",
    
    "pain_point_question": "What's your biggest administrative bottleneck?",
    "pain_point_options": [
        {
            "value": 3,
            "label": "Time Entry & Billing (Manual time sheet entry)",
            "description": "Low-medium pain - tedious but straightforward"
        },
        {
            "value": 6,
            "label": "Matter File Management (Creating and organizing client files)",
            "description": "Medium pain - time-consuming setup"
        },
        {
            "value": 8,
            "label": "Contract Review (Reading and extracting key terms)",
            "description": "Medium-high pain - requires legal judgment"
        },
        {
            "value": 10,
            "label": "Document Discovery (Searching and indexing large document sets)",
            "description": "High pain - extremely time-consuming, paralegal work"
        }
    ],
    
    "weekly_hours_question": "Total firm-wide hours per week on administrative tasks (all staff combined)",
    "weekly_hours_range": [10, 150, 50],
    "weekly_hours_help_text": "Example: 20 staff × 2.5 hours each = 50 hours/week. Include: time entry, file management, document review.",
    
    "demo_documents": "contracts, matter files, time sheets, or discovery documents",
    
    "automation_potential": 0.35  # Slightly lower due to judgment-heavy work
}
```

**That's it.** The rest of the calculator automatically works.

---

## Step 4.3: Example - Logistics & Freight

```python
"Logistics & Freight": {
    "context": "Logistics and freight companies (20-200 staff)",
    
    "pain_point_question": "What's your biggest operational bottleneck?",
    "pain_point_options": [
        {
            "value": 4,
            "label": "Proof of Delivery Processing (Manual data entry from PODs)",
            "description": "Medium pain - repetitive, high volume"
        },
        {
            "value": 7,
            "label": "Freight Manifest Processing (Typing from PDF manifests)",
            "description": "Medium-high pain - error-prone, urgent deadlines"
        },
        {
            "value": 9,
            "label": "Customs Documentation (Manual preparation of import/export docs)",
            "description": "High pain - complex, compliance-critical"
        },
        {
            "value": 10,
            "label": "Invoice Matching (Reconciling carrier invoices vs bookings)",
            "description": "High pain - time-consuming, disputes common"
        }
    ],
    
    "weekly_hours_question": "Total operations hours per week on manual data entry (all staff combined)",
    "weekly_hours_range": [20, 400, 120],
    "weekly_hours_help_text": "Example: 40 operations staff × 3 hours each = 120 hours/week. Include: manifest entry, POD processing, customs docs.",
    
    "demo_documents": "freight manifests, bills of lading, proof of delivery, or customs documentation",
    
    "automation_potential": 0.50  # Higher due to repetitive nature
}
```

---

## Step 4.4: Checklist for Adding New Industry

### **Step 1**: Write Industry Config (10 minutes)
- [ ] Choose industry name
- [ ] Write context description
- [ ] Write pain point question
- [ ] Write 4 pain point options (with descriptions)
- [ ] Set weekly hours range and default
- [ ] Write help text example
- [ ] List demo documents
- [ ] Set automation potential (0.35-0.50)

### **Step 2**: Add to Industry Selection Page (2 minutes)
- [ ] Add industry card to Step 1 grid
- [ ] Choose appropriate emoji icon
- [ ] Write brief description (1 sentence)

### **Step 3**: Test Calculator (3 minutes)
- [ ] Select industry from Step 1
- [ ] Enter test inputs
- [ ] Verify results page displays correctly
- [ ] Check that industry-specific content shows (demo documents, pain points)

**Total Time**: ~15 minutes per industry

---

# Testing Checklist

## Engineering Calculator Testing

### Input Form Tests
- [ ] Industry context banner shows "Architecture & Building Services" with 🏗️ icon
- [ ] Pain point question shows 4 options (BIM export, Excel cleanup, Spec writing, Transmittals)
- [ ] Each pain point has description text visible
- [ ] Weekly hours question shows "Total firm-wide" with help text example
- [ ] Weekly hours slider range is 10-200 (not 0-20)
- [ ] Default weekly hours is 80
- [ ] Form disclaimer box shows before submit buttons
- [ ] "Back" button works
- [ ] "Calculate ROI" button submits form

### Results Page Tests
- [ ] Big scary number displays correctly (formatted currency)
- [ ] "What This Means" section shows correct calculations
- [ ] Reality check box displays with warning icon
- [ ] Phase 1 explainer shows engineering demo documents
- [ ] Timeline shows 4 steps (Day 1 AM, Day 1 PM, Day 2, Day 3)
- [ ] Guarantee box displays with 90% accuracy emphasis
- [ ] Primary CTA is large gold button "Book $1,500 Feasibility Test"
- [ ] Secondary CTAs show "Try Assessment Demo" and "Learn More About Engineering"
- [ ] Detailed breakdown (collapsed by default) shows all inputs and calculations

### Calculation Tests

Test with these inputs:
- Staff: 25
- Rate: $255/hour
- Weekly hours: 100
- Pain point: Drawing Registers (Excel cleanup) - value 5

Expected results:
- Total annual hours: 100 × 48 = 4,800 hours
- Annual burn: 4,800 × $255 = $1,224,000
- Tier 1 savings: $1,224,000 × 0.40 = $489,600

---

## Accounting Calculator Testing

### Input Form Tests
- [ ] Industry context banner shows "Accounting & Advisory" with 🏢 icon
- [ ] Pain point question shows 4 options (Invoice entry, GL coding, Trust accounts, Inter-entity)
- [ ] Each pain point has description visible
- [ ] Weekly hours question shows accounting-specific help text
- [ ] Default weekly hours is 60 (not 80)
- [ ] Form disclaimer displays

### Results Page Tests
- [ ] Demo documents show "invoices, bank statements, trust account transactions..."
- [ ] All other sections display correctly (universal template)

### Calculation Tests

Test with these inputs:
- Staff: 15
- Rate: $250/hour
- Weekly hours: 60
- Pain point: Inter-Entity Matching - value 10

Expected results:
- Total annual hours: 60 × 48 = 2,880 hours
- Annual burn: 2,880 × $250 = $720,000
- Tier 1 savings: $720,000 × 0.40 = $288,000

---

## Cross-Browser Testing

Test in:
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

## Mobile Responsive Testing

Test at these breakpoints:
- [ ] 375px (iPhone SE)
- [ ] 768px (iPad)
- [ ] 1024px (iPad Pro)
- [ ] 1440px (Desktop)

Check:
- [ ] Phase 1 grid stacks to single column on mobile
- [ ] Button text doesn't overflow
- [ ] Reality check box is readable
- [ ] Timeline steps are readable

---

# Deployment Steps

## Step 1: Backup Current Files

```bash
# Backup Python config
cp roi_calculator_flask.py roi_calculator_flask.py.backup

# Backup templates
cp templates/roi_step2_input.html templates/roi_step2_input.html.backup
cp templates/roi_step3_results.html templates/roi_step3_results.html.backup
```

## Step 2: Update Files

### 2.1: Update `roi_calculator_flask.py`

1. Add improved Engineering config (from Part 1, Step 1.1)
2. Add Accounting config (from Part 3, Step 3.1)
3. Update calculation function to pass all required variables

### 2.2: Update Input Form Template

1. Add industry context banner (Part 1, Step 1.2)
2. Update pain point question to use config (Part 1, Step 1.2)
3. Update weekly hours question (Part 1, Step 1.2)
4. Add form disclaimer (Part 1, Step 1.2)

### 2.3: Replace Results Page Template

1. Replace entire `roi_step3_results.html` with universal template (Part 2, Step 2.1)

## Step 3: Test Locally

```bash
# Start Flask app
python roi_calculator_flask.py

# Test URLs
http://localhost:5000/roi-calculator/?industry=Architecture%20%26%20Building%20Services
http://localhost:5000/roi-calculator/?industry=Accounting%20%26%20Advisory
```

### Test Checklist (Quick)
- [ ] Engineering calculator loads
- [ ] Input form shows engineering questions
- [ ] Submit form shows results with reality check
- [ ] Accounting calculator loads
- [ ] Input form shows accounting questions
- [ ] Results page displays correctly

## Step 4: Deploy to Railway

```bash
# Commit changes
git add roi_calculator_flask.py
git add templates/roi_step2_input.html
git add templates/roi_step3_results.html
git commit -m "feat: Update ROI calculator with universal template and improved industry configs"

# Push to Railway
git push origin main
```

## Step 5: Verify Production

Visit production URLs:
- Engineering: `https://curam-protocol.curam-ai.com.au/roi-calculator/?industry=Architecture%20%26%20Building%20Services`
- Accounting: `https://curam-protocol.curam-ai.com.au/roi-calculator/?industry=Accounting%20%26%20Advisory`

### Production Checklist
- [ ] Both calculators load without errors
- [ ] Forms submit successfully
- [ ] Results pages display correctly
- [ ] CTAs link to correct pages (`/contact`, `/automater`, `/accounting`, `/built-environment`)
- [ ] Mobile responsive works
- [ ] No JavaScript console errors

---

# Summary

## What You've Built

### ✅ **Universal Template** (do once, use everywhere)
- Reality check messaging
- Phase 1 explainer
- Guarantee emphasis
- CTA hierarchy
- Timeline visualization

### ✅ **Engineering Calculator** (improved)
- Clearer pain point questions
- Better weekly hours question
- Industry context banner
- Form disclaimer

### ✅ **Accounting Calculator** (new, ready to use)
- Accounting-specific pain points
- Appropriate defaults
- Industry-relevant examples

### ✅ **Replication Process** (15 min per industry)
- Template for adding new industries
- Examples: Legal, Logistics
- Step-by-step checklist

---

## Effort Breakdown

| Task | Time | Benefit |
|------|------|---------|
| Update Engineering calculator | 30 min | Improved credibility |
| Create universal results template | 2 hours | Reusable for all industries |
| Set up Accounting calculator | 15 min | Second industry live |
| Add Legal calculator (future) | 15 min | Third industry |
| Add Logistics calculator (future) | 15 min | Fourth industry |

**Total upfront**: 2.75 hours  
**Marginal cost per industry**: 15 minutes  
**Industries you can add**: Unlimited

---

## Next Steps

### Immediate (High Priority)
1. Deploy Engineering and Accounting calculators
2. Test both thoroughly in production
3. Monitor conversion rate to $1,500 Phase 1 bookings

### Near Term (Next 2 Weeks)
4. Add Legal Services calculator (15 min)
5. Add Logistics & Freight calculator (15 min)
6. Track which industries convert best

### Long Term (Next Month)
7. Add Healthcare, Real Estate, Wealth Management
8. Refine pain point questions based on user feedback
9. A/B test different CTA wording

---

## Support

### If Calculator Doesn't Display Correctly
1. Check Python syntax in `roi_calculator_flask.py`
2. Verify template variable names match Python variables
3. Check Flask logs for errors: `railway logs`

### If Calculations Are Wrong
1. Verify formula in calculation function
2. Check that `weekly_hours_range` is being used correctly
3. Test with known inputs and expected outputs

### If New Industry Doesn't Work
1. Verify industry name matches exactly in Step 1 selection
2. Check that industry config is properly formatted (commas, brackets)
3. Test industry config in isolation before deploying

---

**END OF GUIDE**

Total pages: 45  
Implementation time: 2.75 hours  
Reusability: Infinite (15 min per new industry)  
Priority: High (improves lead generation credibility)
