"""
Insurance department template section
"""

def get_insurance_template():
    """
    Returns the insurance-specific template section
    
    Returns:
        str: Jinja2 template string for insurance department
    """
    return """        {% if department == 'insurance' %}
        {# Render separate card for each document #}
        {% for filename, file_results in grouped_insurance_results.items() %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">{{ filename }}</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ file_results|length }} record(s) extracted</div>
            </div>
            {% for row in file_results %}
            <div style="padding: 20px;">
                {# Policy Information Section #}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Policy Information</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('PolicyNumber') and row.PolicyNumber != 'N/A' %}
                        <div><strong>Policy #:</strong> {{ row.PolicyNumber }}</div>
                        {% endif %}
                        {% if row.get('ReportReference') and row.ReportReference != 'N/A' %}
                        <div><strong>Report Ref:</strong> {{ row.ReportReference }}</div>
                        {% endif %}
                        {% if row.get('PolicyholderName') and row.PolicyholderName != 'N/A' %}
                        <div><strong>Policyholder:</strong> {{ row.PolicyholderName }}</div>
                        {% endif %}
                        {% if row.get('InsuredParty') and row.InsuredParty != 'N/A' %}
                        <div><strong>Insured Party:</strong> {{ row.InsuredParty }}</div>
                        {% endif %}
                        {% if row.get('PolicyType') and row.PolicyType != 'N/A' %}
                        <div><strong>Policy Type:</strong> {{ row.PolicyType }}</div>
                        {% endif %}
                        {% if row.get('Insurer') and row.Insurer != 'N/A' %}
                        <div><strong>Insurer:</strong> {{ row.Insurer }}</div>
                        {% endif %}
                        {% if row.get('Broker') and row.Broker != 'N/A' %}
                        <div><strong>Broker:</strong> {{ row.Broker }}</div>
                        {% endif %}
                        {% if row.get('ABN') and row.ABN != 'N/A' %}
                        <div><strong>ABN:</strong> {{ row.ABN }}</div>
                        {% endif %}
                        {% if row.get('AFSL') and row.AFSL != 'N/A' %}
                        <div><strong>AFSL:</strong> {{ row.AFSL }}</div>
                        {% endif %}
                    </div>
                </div>
                
                {# Business/Applicant Details (Risk Assessments) #}
                {% if row.get('LegalEntityName') or row.get('TradingName') or row.get('BusinessABN') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Applicant/Business Details</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('LegalEntityName') and row.LegalEntityName != 'N/A' %}
                        <div><strong>Legal Name:</strong> {{ row.LegalEntityName }}</div>
                        {% endif %}
                        {% if row.get('TradingName') and row.TradingName != 'N/A' %}
                        <div><strong>Trading As:</strong> {{ row.TradingName }}</div>
                        {% endif %}
                        {% if row.get('BusinessABN') and row.BusinessABN != 'N/A' %}
                        <div><strong>ABN:</strong> {{ row.BusinessABN }}</div>
                        {% endif %}
                        {% if row.get('BusinessAddress') and row.BusinessAddress != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Address:</strong> {{ row.BusinessAddress }}</div>
                        {% endif %}
                        {% if row.get('BusinessOperations') and row.BusinessOperations != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Operations:</strong> {{ row.BusinessOperations }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Financial Overview (Risk Assessments) #}
                {% if row.get('AnnualRevenue') or row.get('NetProfit') or row.get('TotalAssets') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Financial Overview</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
                        {% if row.get('AnnualRevenue') and row.AnnualRevenue != 'N/A' %}
                        <div style="background: #ecfdf5; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Annual Revenue</div>
                            <div style="font-size: 16px; font-weight: 700; color: #065f46;">{{ row.AnnualRevenue }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('NetProfit') and row.NetProfit != 'N/A' %}
                        <div style="background: #f0fdf4; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Net Profit</div>
                            <div style="font-size: 16px; font-weight: 700; color: #166534;">{{ row.NetProfit }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('TotalAssets') and row.TotalAssets != 'N/A' %}
                        <div style="background: #eff6ff; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Total Assets</div>
                            <div style="font-size: 16px; font-weight: 700; color: #1e40af;">{{ row.TotalAssets }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('CreditRating') and row.CreditRating != 'N/A' %}
                        <div style="background: #faf5ff; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Credit Rating</div>
                            <div style="font-size: 14px; font-weight: 600; color: #6d28d9;">{{ row.CreditRating }}</div>
                        </div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Policy Dates Section #}
                {% if row.get('EffectiveDate') or row.get('ExpiryDate') or row.get('AssessmentDate') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">{% if row.get('AssessmentDate') %}Assessment Details{% else %}Policy Period{% endif %}</h4>
                    <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                        {% if row.get('EffectiveDate') and row.EffectiveDate != 'N/A' %}
                        <div style="background: #f0fdf4; padding: 12px 16px; border-radius: 6px;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Effective Date</div>
                            <div style="font-size: 16px; font-weight: 600; color: #166534;">{{ row.EffectiveDate }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('ExpiryDate') and row.ExpiryDate != 'N/A' %}
                        <div style="background: #fef2f2; padding: 12px 16px; border-radius: 6px;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Expiry Date</div>
                            <div style="font-size: 16px; font-weight: 600; color: #dc2626;">{{ row.ExpiryDate }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('AssessmentDate') and row.AssessmentDate != 'N/A' %}
                        <div style="background: #eff6ff; padding: 12px 16px; border-radius: 6px;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Assessment Date</div>
                            <div style="font-size: 16px; font-weight: 600; color: #1e40af;">{{ row.AssessmentDate }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('Underwriter') and row.Underwriter != 'N/A' %}
                        <div style="background: #faf5ff; padding: 12px 16px; border-radius: 6px;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Underwriter</div>
                            <div style="font-size: 14px; font-weight: 600; color: #6d28d9;">{{ row.Underwriter }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('AssessmentStatus') and row.AssessmentStatus != 'N/A' %}
                        <div style="background: #ecfdf5; padding: 12px 16px; border-radius: 6px;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Status</div>
                            <div style="font-size: 14px; font-weight: 600; color: #065f46;">{{ row.AssessmentStatus }}</div>
                        </div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Financial Details Section (Policies) #}
                {% if row.get('PremiumAmount') or row.get('SumInsured') or row.get('ExcessAmount') or row.get('BuildingSumInsured') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Coverage & Premium</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">
                        {% if row.get('SumInsured') and row.SumInsured != 'N/A' %}
                        <div style="background: #ecfdf5; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Total Sum Insured</div>
                            <div style="font-size: 18px; font-weight: 700; color: #065f46;">${{ row.SumInsured }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('BuildingSumInsured') and row.BuildingSumInsured != 'N/A' %}
                        <div style="background: #eff6ff; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Building</div>
                            <div style="font-size: 16px; font-weight: 700; color: #1e40af;">${{ row.BuildingSumInsured }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('ContentsSumInsured') and row.ContentsSumInsured != 'N/A' %}
                        <div style="background: #faf5ff; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Contents</div>
                            <div style="font-size: 16px; font-weight: 700; color: #6d28d9;">${{ row.ContentsSumInsured }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('LiabilityLimit') and row.LiabilityLimit != 'N/A' %}
                        <div style="background: #f0f9ff; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Liability Limit</div>
                            <div style="font-size: 16px; font-weight: 700; color: #0369a1;">${{ row.LiabilityLimit }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('PremiumAmount') and row.PremiumAmount != 'N/A' %}
                        <div style="background: #fef3c7; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Annual Premium</div>
                            <div style="font-size: 18px; font-weight: 700; color: #92400e;">${{ row.PremiumAmount }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('ExcessAmount') and row.ExcessAmount != 'N/A' %}
                        <div style="background: #fff7ed; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Standard Excess</div>
                            <div style="font-size: 16px; font-weight: 700; color: #c2410c;">${{ row.ExcessAmount }}</div>
                        </div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Property Details Section #}
                {% if row.get('PropertyAddress') and row.PropertyAddress != 'N/A' %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Property Details</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        <div style="grid-column: span 2;"><strong>Address:</strong> {{ row.PropertyAddress }}</div>
                        {% if row.get('PropertyType') and row.PropertyType != 'N/A' %}
                        <div><strong>Type:</strong> {{ row.PropertyType }}</div>
                        {% endif %}
                        {% if row.get('YearBuilt') and row.YearBuilt != 'N/A' %}
                        <div><strong>Year Built:</strong> {{ row.YearBuilt }}</div>
                        {% endif %}
                        {% if row.get('ConstructionType') and row.ConstructionType != 'N/A' %}
                        <div><strong>Construction:</strong> {{ row.ConstructionType }}</div>
                        {% endif %}
                    </div>
                    {% if row.get('PropertyFeatures') and row.PropertyFeatures != 'N/A' %}
                    <div style="margin-top: 10px; font-size: 13px;">
                        <strong>Features:</strong> 
                        {% if row.PropertyFeatures is iterable and row.PropertyFeatures is not string %}
                            {{ row.PropertyFeatures | join(', ') }}
                        {% else %}
                            {{ row.PropertyFeatures }}
                        {% endif %}
                    </div>
                    {% endif %}
                </div>
                {% endif %}
                
                {# Risk Location (Risk Assessments) #}
                {% if row.get('SiteAddress') or row.get('SecurityFeatures') or row.get('FireProtection') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Risk Location</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('SiteAddress') and row.SiteAddress != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Site:</strong> {{ row.SiteAddress }}</div>
                        {% endif %}
                        {% if row.get('BuildingConstruction') and row.BuildingConstruction != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Construction:</strong> {{ row.BuildingConstruction }}</div>
                        {% endif %}
                        {% if row.get('BuildingAge') and row.BuildingAge != 'N/A' %}
                        <div><strong>Age/Condition:</strong> {{ row.BuildingAge }}</div>
                        {% endif %}
                        {% if row.get('SecurityFeatures') and row.SecurityFeatures != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Security:</strong> {{ row.SecurityFeatures }}</div>
                        {% endif %}
                        {% if row.get('FireProtection') and row.FireProtection != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Fire Protection:</strong> {{ row.FireProtection }}</div>
                        {% endif %}
                        {% if row.get('HazardousMaterials') and row.HazardousMaterials != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Hazmat:</strong> {{ row.HazardousMaterials }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Natural Hazard Exposure #}
                {% if row.get('FloodRisk') or row.get('BushfireRisk') or row.get('WindStormRisk') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Natural Hazard Exposure</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">
                        {% if row.get('FloodRisk') and row.FloodRisk != 'N/A' %}
                        <div style="background: #eff6ff; padding: 10px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b;">Flood Risk</div>
                            <div style="font-size: 14px; font-weight: 600; color: #1e40af;">{{ row.FloodRisk }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('BushfireRisk') and row.BushfireRisk != 'N/A' %}
                        <div style="background: #fef2f2; padding: 10px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b;">Bushfire Risk</div>
                            <div style="font-size: 14px; font-weight: 600; color: #dc2626;">{{ row.BushfireRisk }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('WindStormRisk') and row.WindStormRisk != 'N/A' %}
                        <div style="background: #f0f9ff; padding: 10px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b;">Wind/Storm</div>
                            <div style="font-size: 14px; font-weight: 600; color: #0369a1;">{{ row.WindStormRisk }}</div>
                        </div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Equipment Schedule (Risk Assessments) #}
                {% if row.get('EquipmentSchedule') and row.EquipmentSchedule is iterable and row.EquipmentSchedule is not string and row.EquipmentSchedule|length > 0 %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Equipment & Machinery</h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Category</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Value</th>
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Age Profile</th>
                                </tr>
                            </thead>
                            <tbody>
                                {% for item in row.EquipmentSchedule %}
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ item.Category or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600;">{{ item.Value or 'N/A' }}</td>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ item.AgeProfile or 'N/A' }}</td>
                                </tr>
                                {% endfor %}
                            </tbody>
                        </table>
                    </div>
                    {% if row.get('TotalEquipmentValue') and row.TotalEquipmentValue != 'N/A' %}
                    <div style="margin-top: 10px; text-align: right; font-size: 14px;"><strong>Total Replacement Value:</strong> {{ row.TotalEquipmentValue }}</div>
                    {% endif %}
                </div>
                {% endif %}
                
                {# Specified High-Value Items #}
                {% if row.get('SpecifiedItems') and row.SpecifiedItems is iterable and row.SpecifiedItems is not string and row.SpecifiedItems|length > 0 %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Specified High-Value Items</h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Item Description</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Sum Insured</th>
                                </tr>
                            </thead>
                            <tbody>
                                {% for item in row.SpecifiedItems %}
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ item.Description or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600;">{{ item.Value or 'N/A' }}</td>
                                </tr>
                                {% endfor %}
                            </tbody>
                        </table>
                    </div>
                </div>
                {% endif %}
                
                {# Excess Schedule #}
                {% if row.get('ExcessSchedule') and row.ExcessSchedule is iterable and row.ExcessSchedule is not string and row.ExcessSchedule|length > 0 %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Excess Schedule</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
                        {% for excess in row.ExcessSchedule %}
                        <div style="background: #fff7ed; padding: 10px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b;">{{ excess.Type or 'Standard' }}</div>
                            <div style="font-size: 14px; font-weight: 600; color: #c2410c;">{{ excess.Amount or 'N/A' }}</div>
                        </div>
                        {% endfor %}
                    </div>
                </div>
                {% endif %}
                
                {# Optional Covers #}
                {% if row.get('OptionalCovers') and row.OptionalCovers != 'N/A' %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Optional Covers</h4>
                    <div style="font-size: 13px;">
                        {% if row.OptionalCovers is iterable and row.OptionalCovers is not string %}
                            {{ row.OptionalCovers | join(' • ') }}
                        {% else %}
                            {{ row.OptionalCovers }}
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Risk Score & Underwriting Decision #}
                {% if row.get('OverallRiskScore') or row.get('RiskClassification') or row.get('TotalIndicativePremium') %}
                <div style="margin-bottom: 20px; background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 100%); color: white; padding: 16px; border-radius: 8px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #d4af37;">Underwriting Decision</h4>
                    <div style="display: flex; gap: 20px; flex-wrap: wrap; align-items: center;">
                        {% if row.get('OverallRiskScore') and row.OverallRiskScore != 'N/A' %}
                        <div style="text-align: center;">
                            <div style="font-size: 11px; opacity: 0.8;">Risk Score</div>
                            <div style="font-size: 24px; font-weight: 700;">{{ row.OverallRiskScore }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('RiskClassification') and row.RiskClassification != 'N/A' %}
                        <div style="background: rgba(255,255,255,0.2); padding: 8px 16px; border-radius: 20px;">
                            {{ row.RiskClassification }}
                        </div>
                        {% endif %}
                        {% if row.get('TotalIndicativePremium') and row.TotalIndicativePremium != 'N/A' %}
                        <div style="margin-left: auto; text-align: right;">
                            <div style="font-size: 11px; opacity: 0.8;">Indicative Premium</div>
                            <div style="font-size: 20px; font-weight: 700; color: #d4af37;">{{ row.TotalIndicativePremium }}</div>
                        </div>
                        {% endif %}
                    </div>
                    {% if row.get('SpecialConditions') and row.SpecialConditions != 'N/A' %}
                    <div style="margin-top: 12px; font-size: 12px; opacity: 0.9;">
                        <strong>Conditions:</strong> 
                        {% if row.SpecialConditions is iterable and row.SpecialConditions is not string %}
                            {{ row.SpecialConditions | join(' • ') }}
                        {% else %}
                            {{ row.SpecialConditions }}
                        {% endif %}
                    </div>
                    {% endif %}
                </div>
                {% endif %}
                
                {# Underinsurance Alert #}
                {% if row.get('UnderinsuranceAlert') and row.UnderinsuranceAlert != 'N/A' %}
                <div style="margin-bottom: 20px; background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 16px; border-radius: 4px;">
                    <strong style="color: #dc2626;">⚠️ Underinsurance Alert:</strong>
                    <div style="margin-top: 6px; font-size: 13px; color: #991b1b;">{{ row.UnderinsuranceAlert }}</div>
                </div>
                {% endif %}
                
                {# Loss History #}
                {% if row.get('LossHistory') and row.LossHistory is iterable and row.LossHistory is not string and row.LossHistory|length > 0 %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Loss History</h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Date</th>
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Type</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Amount Paid</th>
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Outcome</th>
                                </tr>
                            </thead>
                            <tbody>
                                {% for loss in row.LossHistory %}
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ loss.Date or 'N/A' }}</td>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ loss.Type or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600;">{{ loss.AmountPaid or 'N/A' }}</td>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ loss.Outcome or 'N/A' }}</td>
                                </tr>
                                {% endfor %}
                            </tbody>
                        </table>
                    </div>
                    {% if row.get('LossRatio') and row.LossRatio != 'N/A' %}
                    <div style="margin-top: 10px; font-size: 13px;"><strong>5-Year Loss Ratio:</strong> {{ row.LossRatio }}</div>
                    {% endif %}
                </div>
                {% endif %}
                
                {# Claim Information Section (for claims forms) #}
                {% if row.get('ClaimNumber') or row.get('IncidentDate') or row.get('ClaimAmount') or row.get('ClaimType') %}
                <div style="margin-bottom: 20px; background: #fef3c7; padding: 16px; border-radius: 8px; border-left: 4px solid #f59e0b;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #92400e;">Claim Information</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px; color: #78350f;">
                        {% if row.get('ClaimNumber') and row.ClaimNumber != 'N/A' %}
                        <div><strong>Claim #:</strong> {{ row.ClaimNumber }}</div>
                        {% endif %}
                        {% if row.get('ClaimType') and row.ClaimType != 'N/A' %}
                        <div><strong>Claim Type:</strong> {{ row.ClaimType }}</div>
                        {% endif %}
                        {% if row.get('DateLodged') and row.DateLodged != 'N/A' %}
                        <div><strong>Date Lodged:</strong> {{ row.DateLodged }}</div>
                        {% endif %}
                        {% if row.get('IncidentDate') and row.IncidentDate != 'N/A' %}
                        <div><strong>Incident Date:</strong> {{ row.IncidentDate }}</div>
                        {% endif %}
                        {% if row.get('IncidentTime') and row.IncidentTime != 'N/A' %}
                        <div><strong>Incident Time:</strong> {{ row.IncidentTime }}</div>
                        {% endif %}
                        {% if row.get('TotalClaimAmount') and row.TotalClaimAmount != 'N/A' %}
                        <div><strong>Total Claim:</strong> ${{ row.TotalClaimAmount }}</div>
                        {% endif %}
                    </div>
                    {% if row.get('IncidentDescription') and row.IncidentDescription != 'N/A' %}
                    <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #fbbf24;">
                        <strong>Incident Description:</strong>
                        <div style="margin-top: 6px;">{{ row.IncidentDescription }}</div>
                    </div>
                    {% endif %}
                </div>
                {% endif %}
                
                {# Claimant Information #}
                {% if row.get('PrimaryClaimant') or row.get('JointClaimant') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Claimant Information</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('PrimaryClaimant') and row.PrimaryClaimant != 'N/A' %}
                        <div><strong>Primary Claimant:</strong> {{ row.PrimaryClaimant }}</div>
                        {% endif %}
                        {% if row.get('JointClaimant') and row.JointClaimant != 'N/A' %}
                        <div><strong>Joint Claimant:</strong> {{ row.JointClaimant }}</div>
                        {% endif %}
                        {% if row.get('ClaimantPhone') and row.ClaimantPhone != 'N/A' %}
                        <div><strong>Phone:</strong> {{ row.ClaimantPhone }}</div>
                        {% endif %}
                        {% if row.get('ClaimantEmail') and row.ClaimantEmail != 'N/A' %}
                        <div><strong>Email:</strong> {{ row.ClaimantEmail }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Authority Notifications #}
                {% if row.get('PoliceNotified') or row.get('OtherAuthorities') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Authority Notifications</h4>
                    <div style="font-size: 13px;">
                        {% if row.get('PoliceNotified') and row.PoliceNotified != 'N/A' %}
                        <div><strong>Police:</strong> {{ row.PoliceNotified }}{% if row.get('PoliceEventNumber') %} (Event #{{ row.PoliceEventNumber }}){% endif %}</div>
                        {% endif %}
                        {% if row.get('OtherAuthorities') and row.OtherAuthorities != 'N/A' %}
                        <div style="margin-top: 6px;"><strong>Other:</strong> {{ row.OtherAuthorities }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Building Damage Assessment #}
                {% if row.get('BuildingDamageItems') and row.BuildingDamageItems is iterable and row.BuildingDamageItems is not string and row.BuildingDamageItems|length > 0 %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Building Damage Assessment</h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Area</th>
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Description</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Est. Cost</th>
                                </tr>
                            </thead>
                            <tbody>
                                {% for item in row.BuildingDamageItems %}
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ item.Area or 'N/A' }}</td>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ item.Description or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600;">{{ item.EstimatedCost or 'N/A' }}</td>
                                </tr>
                                {% endfor %}
                            </tbody>
                        </table>
                    </div>
                    {% if row.get('BuildingDamageTotal') and row.BuildingDamageTotal != 'N/A' %}
                    <div style="margin-top: 10px; text-align: right; font-size: 14px;"><strong>Total Building Damage:</strong> ${{ row.BuildingDamageTotal }}</div>
                    {% endif %}
                </div>
                {% endif %}
                
                {# Contents Damage Assessment #}
                {% if row.get('ContentsDamageItems') and row.ContentsDamageItems is iterable and row.ContentsDamageItems is not string and row.ContentsDamageItems|length > 0 %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Contents Damage Assessment</h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Item</th>
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Damage Type</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Claim Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {% for item in row.ContentsDamageItems %}
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ item.Item or 'N/A' }}</td>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ item.DamageType or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600;">{{ item.ClaimAmount or 'N/A' }}</td>
                                </tr>
                                {% endfor %}
                            </tbody>
                        </table>
                    </div>
                    {% if row.get('ContentsDamageTotal') and row.ContentsDamageTotal != 'N/A' %}
                    <div style="margin-top: 10px; text-align: right; font-size: 14px;"><strong>Total Contents Damage:</strong> ${{ row.ContentsDamageTotal }}</div>
                    {% endif %}
                </div>
                {% endif %}
                
                {# Claim Summary Totals #}
                {% if row.get('BuildingDamageTotal') or row.get('ContentsDamageTotal') or row.get('AlternativeAccommodation') or row.get('EmergencyCosts') %}
                <div style="margin-bottom: 20px; background: #f8fafc; padding: 16px; border-radius: 8px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95;">Claim Summary</h4>
                    <div style="display: grid; grid-template-columns: 1fr auto; gap: 8px; font-size: 13px;">
                        {% if row.get('BuildingDamageTotal') and row.BuildingDamageTotal != 'N/A' %}
                        <div>Building Damage</div><div style="text-align: right; font-weight: 600;">${{ row.BuildingDamageTotal }}</div>
                        {% endif %}
                        {% if row.get('ContentsDamageTotal') and row.ContentsDamageTotal != 'N/A' %}
                        <div>Contents Damage</div><div style="text-align: right; font-weight: 600;">${{ row.ContentsDamageTotal }}</div>
                        {% endif %}
                        {% if row.get('AlternativeAccommodation') and row.AlternativeAccommodation != 'N/A' %}
                        <div>Alternative Accommodation</div><div style="text-align: right; font-weight: 600;">${{ row.AlternativeAccommodation }}</div>
                        {% endif %}
                        {% if row.get('EmergencyCosts') and row.EmergencyCosts != 'N/A' %}
                        <div>Emergency/Make-Safe Costs</div><div style="text-align: right; font-weight: 600;">${{ row.EmergencyCosts }}</div>
                        {% endif %}
                        {% if row.get('ExcessAmount') and row.ExcessAmount != 'N/A' %}
                        <div>Less: Policy Excess</div><div style="text-align: right; font-weight: 600; color: #dc2626;">-${{ row.ExcessAmount }}</div>
                        {% endif %}
                    </div>
                    {% if row.get('TotalClaimAmount') and row.TotalClaimAmount != 'N/A' %}
                    <div style="margin-top: 12px; padding-top: 12px; border-top: 2px solid #4c1d95; display: flex; justify-content: space-between; font-size: 16px; font-weight: 700;">
                        <span>ESTIMATED TOTAL CLAIM</span>
                        <span style="color: #4c1d95;">${{ row.TotalClaimAmount }}</span>
                    </div>
                    {% endif %}
                </div>
                {% endif %}
                
                {# Third Party Information #}
                {% if row.get('ThirdPartyName') and row.ThirdPartyName != 'N/A' %}
                <div style="margin-bottom: 20px; background: #f0f9ff; padding: 16px; border-radius: 8px; border-left: 4px solid #0369a1;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #0369a1;">Third Party Information</h4>
                    <div style="font-size: 13px;">
                        <div><strong>Name:</strong> {{ row.ThirdPartyName }}</div>
                        {% if row.get('ThirdPartyAddress') and row.ThirdPartyAddress != 'N/A' %}
                        <div style="margin-top: 6px;"><strong>Address:</strong> {{ row.ThirdPartyAddress }}</div>
                        {% endif %}
                        {% if row.get('ThirdPartyDescription') and row.ThirdPartyDescription != 'N/A' %}
                        <div style="margin-top: 6px;">{{ row.ThirdPartyDescription }}</div>
                        {% endif %}
                        {% if row.get('RecoveryAuthorized') and row.RecoveryAuthorized != 'N/A' %}
                        <div style="margin-top: 6px;"><strong>Recovery Authorized:</strong> {{ row.RecoveryAuthorized }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Assessment Personnel #}
                {% if row.get('AssessingOfficer') or row.get('LossAdjuster') or row.get('ManagerApproval') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Assessment Personnel</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('AssessingOfficer') and row.AssessingOfficer != 'N/A' %}
                        <div><strong>Assessing Officer:</strong> {{ row.AssessingOfficer }}</div>
                        {% endif %}
                        {% if row.get('LossAdjuster') and row.LossAdjuster != 'N/A' %}
                        <div><strong>Loss Adjuster:</strong> {{ row.LossAdjuster }}</div>
                        {% endif %}
                        {% if row.get('ManagerApproval') and row.ManagerApproval != 'N/A' %}
                        <div><strong>Manager Approval:</strong> {{ row.ManagerApproval }}</div>
                        {% endif %}
                        {% if row.get('EstimatedReserve') and row.EstimatedReserve != 'N/A' %}
                        <div><strong>Estimated Reserve:</strong> ${{ row.EstimatedReserve }}</div>
                        {% endif %}
                        {% if row.get('ClaimPriority') and row.ClaimPriority != 'N/A' %}
                        <div><strong>Priority:</strong> {{ row.ClaimPriority }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Notes Section #}
                {% if row.get('Notes') and row.Notes != 'N/A' %}
                <div style="margin-top: 15px; padding: 12px; background: #f8fafc; border-radius: 6px; font-size: 12px; color: #475569;">
                    <strong>Notes:</strong> {{ row.Notes }}
                </div>
                {% endif %}
            </div>
            {% endfor %}
        </div>
        {% endfor %}
        {% endif %}
"""
