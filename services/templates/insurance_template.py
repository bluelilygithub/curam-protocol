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
                        {% if row.get('ACN') and row.ACN != 'N/A' %}
                        <div><strong>ACN:</strong> {{ row.ACN }}</div>
                        {% endif %}
                    </div>
                </div>
                
                {# Policy Dates Section #}
                {% if row.get('EffectiveDate') or row.get('ExpiryDate') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Policy Period</h4>
                    <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                        {% if row.get('EffectiveDate') %}
                        <div style="background: #f0fdf4; padding: 12px 16px; border-radius: 6px;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Effective Date</div>
                            <div style="font-size: 16px; font-weight: 600; color: #166534;">{{ row.EffectiveDate }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('ExpiryDate') %}
                        <div style="background: #fef2f2; padding: 12px 16px; border-radius: 6px;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Expiry Date</div>
                            <div style="font-size: 16px; font-weight: 600; color: #dc2626;">{{ row.ExpiryDate }}</div>
                        </div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Financial Details Section #}
                {% if row.get('PremiumAmount') or row.get('SumInsured') or row.get('ExcessAmount') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Financial Details</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
                        {% if row.get('PremiumAmount') %}
                        <div style="background: #faf5ff; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Premium</div>
                            <div style="font-size: 18px; font-weight: 700; color: #6d28d9;">${{ row.PremiumAmount }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('SumInsured') %}
                        <div style="background: #ecfdf5; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Sum Insured</div>
                            <div style="font-size: 18px; font-weight: 700; color: #065f46;">${{ row.SumInsured }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('ExcessAmount') %}
                        <div style="background: #fff7ed; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Excess</div>
                            <div style="font-size: 18px; font-weight: 700; color: #c2410c;">${{ row.ExcessAmount }}</div>
                        </div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Coverage Details Section #}
                {% if row.get('CoverageDetails') and row.CoverageDetails is iterable and row.CoverageDetails is not string %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Coverage Details</h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Coverage Type</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Limit</th>
                                </tr>
                            </thead>
                            <tbody>
                                {% for coverage in row.CoverageDetails %}
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ coverage.Type or coverage.CoverageType or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600;">{{ coverage.Limit or coverage.Amount or 'N/A' }}</td>
                                </tr>
                                {% endfor %}
                            </tbody>
                        </table>
                    </div>
                </div>
                {% endif %}
                
                {# Claim Information Section (for claims forms) #}
                {% if row.get('ClaimNumber') or row.get('IncidentDate') or row.get('ClaimAmount') %}
                <div style="margin-bottom: 20px; background: #fef3c7; padding: 16px; border-radius: 8px; border-left: 4px solid #f59e0b;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #92400e;">Claim Information</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px; color: #78350f;">
                        {% if row.get('ClaimNumber') and row.ClaimNumber != 'N/A' %}
                        <div><strong>Claim #:</strong> {{ row.ClaimNumber }}</div>
                        {% endif %}
                        {% if row.get('IncidentDate') %}
                        <div><strong>Incident Date:</strong> {{ row.IncidentDate }}</div>
                        {% endif %}
                        {% if row.get('ClaimAmount') %}
                        <div><strong>Claim Amount:</strong> ${{ row.ClaimAmount }}</div>
                        {% endif %}
                        {% if row.get('PoliceReportNumber') and row.PoliceReportNumber != 'N/A' %}
                        <div><strong>Police Report #:</strong> {{ row.PoliceReportNumber }}</div>
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
                
                {# Property Information Section #}
                {% if row.get('PropertyAddress') and row.PropertyAddress != 'N/A' %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #4c1d95; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Property Details</h4>
                    <div style="font-size: 13px;">
                        <strong>Address:</strong> {{ row.PropertyAddress }}
                    </div>
                </div>
                {% endif %}
                
                {# Witness Details Section #}
                {% if row.get('WitnessDetails') and row.WitnessDetails != 'N/A' %}
                <div style="margin-bottom: 20px; padding: 12px; background: #f0f9ff; border-radius: 6px;">
                    <strong style="color: #0369a1;">Witness Information:</strong>
                    <div style="margin-top: 6px; font-size: 13px;">{{ row.WitnessDetails }}</div>
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
