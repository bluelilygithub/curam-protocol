"""
Financial Planning department template section
"""

def get_financial_planning_template():
    """
    Returns the financial planning-specific template section
    
    Returns:
        str: Jinja2 template string for financial planning department
    """
    return """        {% if department == 'financial_planning' %}
        {# Render separate card for each document #}
        {% for filename, file_results in grouped_financial_planning_results.items() %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2c5282 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">{{ filename }}</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ file_results|length }} record(s) extracted</div>
            </div>
            {% for row in file_results %}
            <div style="padding: 20px;">
                {# Client Information Section #}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Client Information</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('ClientName') and row.ClientName != 'N/A' %}
                        <div><strong>Client Name:</strong> {{ row.ClientName }}</div>
                        {% endif %}
                        {% if row.get('AccountNumber') and row.AccountNumber != 'N/A' %}
                        <div><strong>Account #:</strong> {{ row.AccountNumber }}</div>
                        {% endif %}
                        {% if row.get('StatementDate') %}
                        <div><strong>Statement Date:</strong> {{ row.StatementDate }}</div>
                        {% endif %}
                        {% if row.get('Adviser') and row.Adviser != 'N/A' %}
                        <div><strong>Adviser:</strong> {{ row.Adviser }}</div>
                        {% endif %}
                    </div>
                </div>
                
                {# Portfolio Values Section #}
                {% if row.get('OpeningBalance') or row.get('ClosingBalance') or row.get('TotalValue') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Portfolio Values</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('OpeningBalance') %}
                        <div style="background: #f0f9ff; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Opening Balance</div>
                            <div style="font-size: 18px; font-weight: 700; color: #1e3a5f;">${{ row.OpeningBalance|default('N/A') }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('ClosingBalance') %}
                        <div style="background: #f0f9ff; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Closing Balance</div>
                            <div style="font-size: 18px; font-weight: 700; color: #1e3a5f;">${{ row.ClosingBalance|default('N/A') }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('TotalValue') %}
                        <div style="background: #ecfdf5; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Total Value</div>
                            <div style="font-size: 18px; font-weight: 700; color: #065f46;">${{ row.TotalValue|default('N/A') }}</div>
                        </div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Asset Allocation Section #}
                {% if row.get('AssetAllocation') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Asset Allocation</h4>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                        {% if row.AssetAllocation is mapping %}
                            {% for asset_class, percentage in row.AssetAllocation.items() %}
                            <div style="background: #f1f5f9; padding: 8px 14px; border-radius: 20px; font-size: 12px;">
                                <strong>{{ asset_class }}:</strong> {{ percentage }}
                            </div>
                            {% endfor %}
                        {% else %}
                            <div style="color: #64748b;">{{ row.AssetAllocation }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Holdings Section #}
                {% if row.get('Holdings') and row.Holdings is iterable and row.Holdings is not string %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Holdings</h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Fund/Security Name</th>
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Asset Class</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Units</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Unit Price</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Market Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {% for holding in row.Holdings %}
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ holding.FundName or holding.SecurityName or 'N/A' }}</td>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ holding.AssetClass or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0;">{{ holding.UnitsHeld or holding.Units or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0;">{{ holding.UnitPrice or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600;">{{ holding.MarketValue or 'N/A' }}</td>
                                </tr>
                                {% endfor %}
                            </tbody>
                        </table>
                    </div>
                </div>
                {% endif %}
                
                {# Licensee Information Section #}
                {% if row.get('AFSL') or row.get('ABN') or row.get('BusinessName') %}
                <div style="background: #fef9c3; padding: 12px; border-radius: 6px; border-left: 4px solid #ca8a04;">
                    <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #854d0e;">Licensee Information</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; font-size: 12px; color: #713f12;">
                        {% if row.get('BusinessName') and row.BusinessName != 'N/A' %}
                        <div><strong>Business:</strong> {{ row.BusinessName }}</div>
                        {% endif %}
                        {% if row.get('AFSL') and row.AFSL != 'N/A' %}
                        <div><strong>AFSL:</strong> {{ row.AFSL }}</div>
                        {% endif %}
                        {% if row.get('ABN') and row.ABN != 'N/A' %}
                        <div><strong>ABN:</strong> {{ row.ABN }}</div>
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
