"""
ROI calculation functions for the calculator.
"""


def format_currency(value):
    """Format number as currency"""
    return f"${value:,.0f}"


def generate_automation_roadmap(industry, staff_count, avg_rate, weekly_waste, ai_opportunities):
    """Generate a 3-phase automation roadmap based on industry and inputs"""
    if industry not in ai_opportunities:
        return []
    
    # Get high-potential tasks for this industry
    high_potential_tasks = [t for t in ai_opportunities[industry] if t['potential'] == 'HIGH']
    
    # Calculate per-staff hours, then scale to total staff
    roadmap = []
    cumulative_savings = 0
    
    for idx, task in enumerate(high_potential_tasks[:3]):  # Top 3 high-potential tasks
        phase_num = idx + 1
        hours_per_week_per_staff = task['hours_per_week']
        total_hours_per_year = hours_per_week_per_staff * staff_count * 52
        revenue_reclaimed = total_hours_per_year * avg_rate
        cumulative_savings += revenue_reclaimed
        
        phase_names = {
            1: "Quick Wins",
            2: "High-Impact",
            3: "Full Automation"
        }
        
        week_ranges = {
            1: "Weeks 1-8",
            2: "Weeks 9-16",
            3: "Weeks 17-24"
        }
        
        payback_periods = {
            1: "6 weeks",
            2: "3 months",
            3: "4 months"
        }
        
        roadmap.append({
            "phase": phase_num,
            "name": f"Phase {phase_num}: {phase_names[phase_num]}",
            "weeks": week_ranges[phase_num],
            "task": task['task'],
            "description": task['description'],
            "hours_per_year": total_hours_per_year,
            "revenue_reclaimed": revenue_reclaimed,
            "cumulative_savings": cumulative_savings,
            "payback": payback_periods[phase_num]
        })
    
    return roadmap


def generate_automation_roadmap_v3(task_analysis, staff_count, avg_rate):
    """Generate prioritized roadmap from task analysis (already sorted by ROI)"""
    
    roadmap = []
    cumulative_savings = 0
    
    # Take top 3 tasks by annual savings (already sorted)
    top_tasks = task_analysis[:3]
    
    phase_names = {
        1: "Quick Wins",
        2: "High-Impact",
        3: "Full Automation"
    }
    
    week_ranges = {
        1: "Weeks 1-8",
        2: "Weeks 9-16",
        3: "Weeks 17-24"
    }
    
    payback_periods = {
        1: "6 weeks",
        2: "3 months",
        3: "4 months"
    }
    
    for idx, task in enumerate(top_tasks):
        phase_num = idx + 1
        cumulative_savings += task['annual_savings']
        
        # Calculate annual hours from weekly hours
        annual_hours = task['recoverable_hours_per_week'] * 48
        
        roadmap.append({
            "phase": phase_num,
            "name": f"Phase {phase_num}: {phase_names[phase_num]}",
            "weeks": week_ranges[phase_num],
            "task": task['name'],
            "complexity": task['complexity'],
            "description": task['description'],
            "hours_per_year": annual_hours,
            "revenue_reclaimed": task['annual_savings'],
            "cumulative_savings": cumulative_savings,
            "payback": payback_periods[phase_num],
            "automation_potential": task['automation_potential']
        })
    
    return roadmap


def get_readiness_response(selection):
    """Get response message based on data storage readiness selection"""
    responses = {
        "structured": {
            "title": "Great! You're AI-Ready",
            "message": "Your structured data infrastructure means we can start automation quickly. Let's discuss which high-value tasks to automate first to maximize your ROI.",
            "icon": "✅"
        },
        "mixed": {
            "title": "Needs Preparation (Most Common)",
            "message": "Like 70% of firms, your data needs some preparation. We can show you the fastest path to AI-ready infrastructure—typically 2-4 weeks of data structuring before automation begins.",
            "icon": "⚠️"
        },
        "chaotic": {
            "title": "High Friction (Not Uncommon)",
            "message": "You're not alone—many firms start here. The good news: we've helped 50+ companies go from chaos to automated in 8-12 weeks. The key is a structured migration plan.",
            "icon": "🚨"
        }
    }
    return responses.get(selection, responses["mixed"])


def get_doc_staff_percentage(total_staff, industry_config):
    """
    Calculate documentation staff percentage with firm size scaling.
    
    Rationale:
    - Small firms (<20): Flat structure, everyone does everything → +10%
    - Medium firms (20-50): Baseline structure → use base %
    - Large firms (50-100): More management layers → -5%
    - Very large (100+): Significant hierarchy → -10%
    
    Args:
        total_staff: Total number of technical staff
        industry_config: Industry configuration dictionary
    
    Returns:
        float: Scaled documentation staff percentage (0.0-1.0)
    """
    base_percentage = industry_config.get('doc_staff_percentage_base', 0.75)
    
    # Apply firm size scaling
    if total_staff < 20:
        # Small firm: flat structure, most people do documentation
        scaled_percentage = base_percentage + 0.10
        # Cap at 90% (always have some senior staff)
        return min(scaled_percentage, 0.90)
        
    elif total_staff < 50:
        # Medium firm: use baseline
        return base_percentage
        
    elif total_staff < 100:
        # Large firm: more management, fewer doing documentation
        scaled_percentage = base_percentage - 0.05
        # Floor at 65% (always need significant documentation staff)
        return max(scaled_percentage, 0.65)
        
    else:
        # Very large firm: significant hierarchy
        scaled_percentage = base_percentage - 0.10
        # Floor at 60%
        return max(scaled_percentage, 0.60)


def calculate_conservative_roi(total_staff, industry_config):
    """
    Calculate CONSERVATIVE ROI based on proven low-hanging fruit only.
    Includes firm size scaling for documentation staff percentage.
    
    Philosophy: Show minimum proven savings on known repetitive tasks,
    not aspirational total opportunity. Focus on documentation staff
    (junior/mid-level) who actually do the work.
    """
    
    # Calculate documentation staff with FIRM SIZE SCALING
    base_percentage = industry_config.get('doc_staff_percentage_base', 0.75)
    doc_staff_percentage = get_doc_staff_percentage(total_staff, industry_config)
    doc_staff_count = int(total_staff * doc_staff_percentage)
    
    # Store both base and scaled for transparency
    base_doc_staff = int(total_staff * base_percentage)
    
    # Use conservative hours and rate
    hours_per_doc_staff = industry_config.get('doc_staff_hours_per_week', 5.0)
    typical_doc_rate = industry_config.get('doc_staff_typical_rate', 140)
    
    # Calculate totals
    total_weekly_hours = doc_staff_count * hours_per_doc_staff
    annual_cost = total_weekly_hours * typical_doc_rate * 48
    
    # Get proven task breakdown
    proven_tasks = industry_config.get('proven_tasks', {})
    tasks = industry_config.get('tasks', [])
    
    # Calculate per-task conservative savings
    task_analysis = []
    total_recoverable_hours = 0
    total_proven_savings = 0
    
    for task in tasks:
        task_id = task['id']
        task_percentage = proven_tasks.get(task_id, 0)
        task_hours = total_weekly_hours * task_percentage
        
        # Use conservative automation potential
        automation_potential = task['automation_potential']
        
        # Apply success rate (conservative adjustment)
        proven_success_rate = task.get('proven_success_rate', 0.85)
        conservative_potential = automation_potential * proven_success_rate
        
        recoverable_hours = task_hours * conservative_potential
        annual_savings = recoverable_hours * typical_doc_rate * 48
        
        task_analysis.append({
            'id': task_id,
            'name': task['name'],
            'complexity': task['complexity'],
            'complexity_label': task['complexity_label'],
            'description': task['description'],
            'hours_per_week': task_hours,
            'percentage_of_total': task_percentage * 100,
            'automation_potential': automation_potential,
            'proven_success_rate': proven_success_rate,
            'conservative_potential': conservative_potential,
            'recoverable_hours_per_week': recoverable_hours,
            'annual_savings': annual_savings,
            'multiplier': task['multiplier'],
            'is_low_hanging_fruit': task.get('is_low_hanging_fruit', False),
            'requires_phase_1': task.get('requires_phase_1', False)
        })
        
        total_recoverable_hours += recoverable_hours
        total_proven_savings += annual_savings
    
    # Sort by annual savings (highest proven ROI first)
    task_analysis.sort(key=lambda x: x['annual_savings'], reverse=True)
    
    # Calculate weighted average (conservative)
    weighted_potential = total_recoverable_hours / total_weekly_hours if total_weekly_hours > 0 else 0
    
    # Tier 2 is aspirational - show but don't emphasize
    tier_2_potential = min(weighted_potential + 0.25, 0.70)  # More conservative
    tier_2_savings = total_weekly_hours * tier_2_potential * typical_doc_rate * 48
    
    # Apply Industry Variance Multiplier (accounts for industry fit to P1 model)
    industry_variance_multiplier = industry_config.get('industry_variance_multiplier', 1.0)
    adjusted_tier_1_savings = total_proven_savings * industry_variance_multiplier
    adjusted_tier_2_savings = tier_2_savings * industry_variance_multiplier
    
    # Determine firm size category for display
    if total_staff < 20:
        firm_size_category = "Small"
        scaling_note = "Flat structure: most staff do documentation"
    elif total_staff < 50:
        firm_size_category = "Medium"
        scaling_note = "Typical structure: baseline percentage"
    elif total_staff < 100:
        firm_size_category = "Large"
        scaling_note = "More management: fewer staff do documentation"
    else:
        firm_size_category = "Very Large"
        scaling_note = "Significant hierarchy: much less documentation staff"
    
    return {
        "mode": "conservative_proven",
        "total_staff": total_staff,
        "doc_staff_count": doc_staff_count,
        "doc_staff_percentage": doc_staff_percentage * 100,
        "base_doc_staff_percentage": base_percentage * 100,
        "base_doc_staff_count": base_doc_staff,
        "firm_size_category": firm_size_category,
        "scaling_note": scaling_note,
        "hours_per_doc_staff": hours_per_doc_staff,
        "typical_doc_rate": typical_doc_rate,
        "total_weekly_hours": total_weekly_hours,
        "annual_cost": annual_cost,
        "task_analysis": task_analysis,
        "total_recoverable_hours": total_recoverable_hours,
        "weighted_potential": weighted_potential,
        "proven_tier_1_savings": total_proven_savings,
        "industry_variance_multiplier": industry_variance_multiplier,
        "adjusted_tier_1_savings": adjusted_tier_1_savings,
        "tier_2_potential": tier_2_potential,
        "tier_2_savings": adjusted_tier_2_savings,  # Return adjusted value for backward compatibility
        "adjusted_tier_2_savings": adjusted_tier_2_savings,
        "capacity_hours": total_recoverable_hours * 48,
        "potential_revenue": adjusted_tier_1_savings,
        # Legacy fields for backward compatibility
        "annual_burn": annual_cost,
        "tier_1_savings": adjusted_tier_1_savings
    }


def calculate_metrics_v3(staff_count, avg_rate, industry_config):
    """
    Calculate ROI across all document types using industry defaults.
    No user input for hours - auto-calculated based on staff + industry.
    """
    
    # Auto-calculate total hours
    hours_per_staff = industry_config.get('hours_per_staff_per_week', 4.0)
    total_weekly_hours = staff_count * hours_per_staff
    
    # Get task breakdown
    task_breakdown = industry_config.get('task_breakdown', {})
    tasks = industry_config.get('tasks', [])
    
    # Calculate per-task metrics
    task_analysis = []
    total_recoverable_hours = 0
    
    for task in tasks:
        task_id = task['id']
        task_percentage = task_breakdown.get(task_id, 0)
        task_hours = total_weekly_hours * task_percentage
        automation_potential = task['automation_potential']
        recoverable_hours = task_hours * automation_potential
        annual_savings = recoverable_hours * avg_rate * 48
        
        task_analysis.append({
            'id': task_id,
            'name': task['name'],
            'complexity': task['complexity'],
            'complexity_label': task['complexity_label'],
            'description': task['description'],
            'hours_per_week': task_hours,
            'percentage_of_total': task_percentage * 100,
            'automation_potential': automation_potential,
            'recoverable_hours_per_week': recoverable_hours,
            'annual_savings': annual_savings,
            'multiplier': task['multiplier'],
            'is_highest_roi': task.get('is_highest_roi', False)
        })
        
        total_recoverable_hours += recoverable_hours
    
    # Sort by annual savings (highest ROI first)
    task_analysis.sort(key=lambda x: x['annual_savings'], reverse=True)
    
    # Mark highest ROI task
    if task_analysis:
        task_analysis[0]['is_highest_roi'] = True
    
    # Calculate totals
    annual_burn = total_weekly_hours * avg_rate * 48
    weighted_automation_potential = total_recoverable_hours / total_weekly_hours if total_weekly_hours > 0 else 0
    tier_1_savings = total_recoverable_hours * avg_rate * 48
    
    # Tier 2 (expanded automation - add 30% more)
    tier_2_potential = min(weighted_automation_potential + 0.30, 0.85)
    tier_2_recoverable_hours = total_weekly_hours * tier_2_potential
    tier_2_savings = tier_2_recoverable_hours * avg_rate * 48
    
    # Apply Industry Variance Multiplier (accounts for industry fit to P1 model)
    industry_variance_multiplier = industry_config.get('industry_variance_multiplier', 1.0)
    adjusted_tier_1_savings = tier_1_savings * industry_variance_multiplier
    adjusted_tier_2_savings = tier_2_savings * industry_variance_multiplier
    
    return {
        "mode": "weighted_analysis",
        "hours_per_staff_per_week": hours_per_staff,
        "total_weekly_hours": total_weekly_hours,
        "annual_burn": annual_burn,
        "task_analysis": task_analysis,
        "total_recoverable_hours_per_week": total_recoverable_hours,
        "weighted_automation_potential": weighted_automation_potential,
        "tier_1_savings": adjusted_tier_1_savings,  # Return adjusted value for backward compatibility
        "industry_variance_multiplier": industry_variance_multiplier,
        "adjusted_tier_1_savings": adjusted_tier_1_savings,
        "tier_2_potential": tier_2_potential,
        "tier_2_savings": adjusted_tier_2_savings,  # Return adjusted value for backward compatibility
        "adjusted_tier_2_savings": adjusted_tier_2_savings,
        "tier_2_cost": annual_burn - adjusted_tier_2_savings,
        "capacity_hours": total_recoverable_hours * 48,
        "potential_revenue": adjusted_tier_1_savings
    }


def calculate_simple_roi(staff_count, avg_rate, industry_config):
    """
    Simplified ROI calculation for marketing/sales website examples.
    
    Uses database-driven parameters from industry_configs table:
    - doc_staff_pct: Percentage of staff doing documentation
    - hrs_per_week: Hours per doc staff per week
    - loaded_cost: Hourly rate (overrides avg_rate parameter)
    - automation_rate: Conservative automation potential
    
    Formula:
    X staff × doc_staff_pct = doc_staff (rounded)
    doc_staff × hrs_per_week × loaded_cost × 48 weeks = annual_cost
    annual_cost × automation_rate = conservative_savings
    
    Args:
        staff_count: Total number of staff
        avg_rate: Average hourly rate (fallback only)
        industry_config: Industry configuration dictionary with database values
    
    Returns:
        dict: ROI calculation results
    """
    # Get parameters from database config (with defaults)
    DOC_STAFF_PERCENTAGE = float(industry_config.get('doc_staff_pct', 0.85))
    HOURS_PER_WEEK = float(industry_config.get('hrs_per_week', 4.5))
    AUTOMATION_POTENTIAL = float(industry_config.get('automation_rate', 0.40))
    WEEKS_PER_YEAR = 48
    
    # Use database values if available
    avg_rate = float(industry_config.get('loaded_cost', avg_rate))
    billing_rate = float(industry_config.get('billing_rate', avg_rate * 2.5))
    
    # Calculate documentation staff (rounded)
    doc_staff_count = round(staff_count * DOC_STAFF_PERCENTAGE)
    
    # Calculate weekly hours
    total_weekly_hours = doc_staff_count * HOURS_PER_WEEK
    
    # Calculate annual documentation cost
    annual_burn = total_weekly_hours * avg_rate * WEEKS_PER_YEAR
    
    # Calculate conservative savings (40% automation)
    tier_1_savings = annual_burn * AUTOMATION_POTENTIAL
    
    # Calculate Billing Capacity (Revenue Unlocked)
    # Formula: Doc Staff × Hrs/Week × Billing Rate × 48 weeks × Automation Rate
    billing_capacity = total_weekly_hours * billing_rate * WEEKS_PER_YEAR * AUTOMATION_POTENTIAL
    
    # Tier 2: expanded automation (55% - add 15% more)
    tier_2_potential = 0.55
    tier_2_savings = annual_burn * tier_2_potential
    
    # Calculate recoverable hours
    total_recoverable_hours = total_weekly_hours * AUTOMATION_POTENTIAL
    
    return {
        "mode": "simple_marketing",
        "total_staff": staff_count,
        "doc_staff_count": doc_staff_count,
        "doc_staff_percentage": DOC_STAFF_PERCENTAGE * 100,  # 85%
        "base_doc_staff_percentage": DOC_STAFF_PERCENTAGE * 100,
        "base_doc_staff_count": doc_staff_count,
        "firm_size_category": "Standard",
        "scaling_note": "85% documentation staff (15% executives excluded)",
        "hours_per_doc_staff": HOURS_PER_WEEK,
        "typical_doc_rate": avg_rate,
        "billing_rate": billing_rate,
        "total_weekly_hours": total_weekly_hours,
        "annual_cost": annual_burn,
        "annual_burn": annual_burn,
        "task_analysis": [],  # No task breakdown for marketing
        "total_recoverable_hours": total_recoverable_hours,
        "weighted_potential": AUTOMATION_POTENTIAL,
        "automation_potential": AUTOMATION_POTENTIAL,
        "proven_tier_1_savings": tier_1_savings,
        "industry_variance_multiplier": 1.0,  # No variance for marketing
        "adjusted_tier_1_savings": tier_1_savings,
        "tier_1_savings": tier_1_savings,
        "tier_2_potential": tier_2_potential,
        "tier_2_savings": tier_2_savings,
        "adjusted_tier_2_savings": tier_2_savings,
        "capacity_hours": total_recoverable_hours * WEEKS_PER_YEAR,
        "potential_revenue": billing_capacity,
        "billing_capacity": billing_capacity
    }


def has_full_roi_config(industry_config):
    """
    Check if industry has full configuration for conservative ROI calculation.
    
    Returns True if industry has:
    - proven_tasks dictionary (non-empty)
    - tasks array (non-empty list)
    
    Args:
        industry_config: Industry configuration dictionary
    
    Returns:
        bool: True if full config available, False otherwise
    """
    proven_tasks = industry_config.get('proven_tasks', {})
    tasks = industry_config.get('tasks', [])
    
    return (
        isinstance(proven_tasks, dict) and len(proven_tasks) > 0 and
        isinstance(tasks, list) and len(tasks) > 0
    )


# Keep old function for backward compatibility (deprecated)
def calculate_metrics(staff_count, avg_rate, weekly_waste, pain_point, industry_config):
    """DEPRECATED: Use calculate_metrics_v3() instead"""
    base_automation_potential = industry_config.get('automation_potential', 0.50)
    pain_multipliers = {0: 0.85, 3: 0.90, 5: 1.00, 6: 1.05, 7: 1.15, 8: 1.25, 10: 1.35}
    multiplier = pain_multipliers.get(pain_point, 1.00)
    automation_potential = min(base_automation_potential * multiplier, 0.70)
    annual_burn = weekly_waste * avg_rate * 48
    tier_1_savings = annual_burn * automation_potential
    tier_2_potential = min(automation_potential + 0.30, 0.70)
    tier_2_savings = annual_burn * tier_2_potential
    capacity_hours = weekly_waste * 48
    hours_per_staff_per_week = weekly_waste / staff_count if staff_count > 0 else 0
    return {
        "annual_burn": annual_burn,
        "tier_1_savings": tier_1_savings,
        "tier_1_cost": annual_burn - tier_1_savings,
        "tier_2_savings": tier_2_savings,
        "tier_2_cost": annual_burn - tier_2_savings,
        "capacity_hours": capacity_hours,
        "potential_revenue": capacity_hours * avg_rate,
        "pain_point": pain_point,
        "weekly_waste": weekly_waste,
        "hours_per_staff_per_week": hours_per_staff_per_week,
        "automation_potential": automation_potential,
        "base_automation_potential": base_automation_potential,
        "pain_multiplier": multiplier,
        "tier_2_potential": tier_2_potential
    }

