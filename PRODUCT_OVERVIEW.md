# AI Document Extraction Platform for Civil Engineering Firms

## Overview

This application automates the manual data entry tasks that consume hours of staff time in mid-size civil engineering firms. By leveraging AI-powered document extraction, it transforms unstructured PDF documents (invoices, structural schedules, drawing registers) into structured data ready for accounting software, spreadsheets, or project documentation.

## Target Client Profile

**Primary Market:** Mid-size civil engineering firms with 50-100 employees, similar to [FSACE](https://www.fsace.com.au), a 70-person structural engineering firm.

**Why This Size?**
- Large enough to generate significant document volume (20-50 invoices/week, multiple project schedules)
- Small enough that manual data entry still dominates workflows
- Staff wear multiple hats—engineers do calculations, admins handle invoices, drafters compile registers
- Cost of errors is high (transcription mistakes in structural data can be catastrophic)
- Time saved directly translates to billable hours or improved work-life balance

## What the Application Does

### Three Core Workflows

#### 1. Finance Department: Invoice Processing Automation

**The Problem:**
Office managers and admin staff spend hours each week manually entering invoice data into accounting software (Xero, MYOB). Each invoice requires:
- Opening the email attachment
- Saving the PDF
- Opening accounting software
- Typing vendor name, date, invoice number, total amount
- Checking for typos

**The Solution:**
Upload PDF invoices (from subcontractors, hardware stores, SaaS subscriptions) and receive structured data with:
- Vendor name
- Invoice date
- Invoice number
- Total amount (formatted with currency)
- Summary/description

**Impact:**
- **Time Saved:** 3 minutes per invoice × 50 invoices/week = 2.5 hours/week
- **Value:** Frees office managers to focus on staff culture, project billing, and strategic tasks instead of data entry
- **Frequency:** Daily operation for firms processing 20-50 invoices per week

#### 2. Engineering Department: Structural Schedule Digitization

**The Problem:**
Structural engineers need to extract beam and column specifications from PDF drawings to:
- Check structural capacity
- Prepare material orders
- Transfer data to calculation spreadsheets

Currently, engineers manually read PDF schedules and type entries like "310UC158" into Excel, repeating this 50+ times per schedule.

**The Solution:**
Upload structural schedule PDFs (from CAD or Revit exports) and receive structured data with:
- Mark/Reference number
- Size specification
- Quantity
- Length
- Grade/Material
- Comments

**Impact:**
- **Time Saved:** 45-60 minutes per schedule reduced to 30 seconds
- **Error Prevention:** Eliminates transcription errors (e.g., typing "310UB" instead of "310UC") that can cause catastrophic engineering failures
- **Frequency:** Project-based bursts—heavily used at project start and during major design revisions

#### 3. Drafting Department: Automated Drawing Register Creation

**The Problem:**
Structural drafters spend hours compiling drawing registers for client transmittals by:
- Opening 20-50 drawing PDFs
- Manually copying Drawing Number, Revision, Title, and Scale from each title block
- Compiling into a register spreadsheet

**The Solution:**
Upload drawing PDFs and receive a structured register with:
- Drawing Number
- Revision
- Drawing Title
- Scale

**Impact:**
- **Time Saved:** Hours of manual typing reduced to instant extraction
- **Accuracy:** Avoids Friday-afternoon typos and keeps registers accurate
- **Frequency:** Weekly task for compiling client transmittals

## Why It Works for Companies Like FSACE

### 1. Volume Justifies Automation
A 70-person firm generates enough document volume (20-50 invoices/week, multiple project schedules, weekly transmittals) to make automation worthwhile. The time savings compound across multiple staff members and departments.

### 2. High Error Cost
In structural engineering, transcription errors can be catastrophic. A typo in a beam specification (310UB vs 310UC) can lead to structural failure. AI extraction eliminates human transcription errors by copying exactly what appears in the source document.

### 3. Multi-Department Value
Unlike single-purpose tools, this platform serves three distinct workflows:
- **Finance:** Invoice processing
- **Engineering:** Schedule digitization
- **Drafting:** Register compilation

This multi-department value makes it easier to justify the investment and ensures broader organizational adoption.

### 4. Layout Flexibility
The application uses AI to understand document structure, not rigid templates. It can handle:
- Different invoice layouts (subcontractor tables, SaaS modern formats, thermal receipts)
- Various schedule formats (CAD exports, Revit exports)
- Mixed drawing title block layouts

This flexibility means firms don't need to standardize their document formats—the AI adapts to existing workflows.

### 5. Immediate ROI
Each workflow delivers immediate, measurable time savings:
- Finance: 2.5 hours/week saved
- Engineering: 45-60 minutes per schedule
- Drafting: Hours per transmittal

For a firm billing at $150-200/hour, these savings quickly justify the platform cost.

### 6. Low Barrier to Entry
- No integration required—works with existing PDFs
- No workflow changes—staff upload files as they would email them
- CSV export integrates with existing tools (Excel, accounting software)

## Technical Approach

The application uses Google's Gemini AI models to extract structured data from PDFs. It:
- Extracts text from PDFs using `pdfplumber`
- Sends extracted text to Gemini with department-specific prompts
- Returns structured JSON data
- Formats and displays results in a web interface
- Exports to CSV for integration with existing tools

## Future Potential

For firms like FSACE, this platform could expand to:
- Automated compliance checking (extracting certification numbers, expiry dates)
- Material ordering automation (extracting quantities and specifications for procurement)
- Project documentation automation (extracting key dates, milestones, deliverables)

The foundation is built—additional workflows can be added as the firm's needs evolve.

