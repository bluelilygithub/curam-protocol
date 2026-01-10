"""
Finance department template section
Extracted from gemini_service.py for modularization
"""

def get_finance_template():
    """
    Returns the finance-specific template section
    
    Returns:
        str: Jinja2 template string for finance department
    """
    return """        {% if department == 'finance' %}
        {# Render separate table for each document #}
        {% for filename, file_results in grouped_finance_results.items() %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">{{ filename }}</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ file_results|length }} row(s) extracted</div>
            </div>
            <div style="overflow-x: auto;">
        <table>
            <thead>
                <tr>
                <th>Vendor</th>
                <th>Date</th>
                <th>Invoice #</th>
                <th>Currency</th>
                    <th class="currency">Cost</th>
                    <th class="currency">GST</th>
                    <th class="currency">Final Amount</th>
                <th>Summary</th>
                {% if file_results[0].get('admin_test') %}
                <th>Admin Test</th>
                {% endif %}
                {% if file_results[0].get('POReference') and file_results[0].POReference != 'N/A' %}
                <th>PO Ref</th>
                {% endif %}
                {% if file_results[0].get('PaymentTerms') and file_results[0].PaymentTerms != 'N/A' %}
                <th>Payment Terms</th>
                {% endif %}
                {% if file_results[0].get('ShippingTerms') and file_results[0].ShippingTerms != 'N/A' %}
                <th>Shipping Terms</th>
                {% endif %}
            </tr>
            </thead>
            <tbody>
            {% for row in file_results %}
            <tr {% if row.get('requires_manual_verification') %}class="requires-manual-verification"{% elif row.get('has_critical_errors') %}class="has-critical-errors"{% endif %}>
                <td>{{ row.Vendor }}</td>
                <td>{{ row.Date }}</td>
                <td>{{ row.InvoiceNum }}</td>
                <td>{{ row.Currency or 'N/A' }}</td>
                    <td class="currency">{{ row.CostFormatted or row.Cost or 'N/A' }}</td>
                    <td class="currency">{{ row.GSTFormatted if row.GSTFormatted and row.GSTFormatted != 'N/A' else (row.GST or 'N/A') }}</td>
                    <td class="currency">{{ row.FinalAmountFormatted or row.TotalFormatted or row.FinalAmount or row.Total or 'N/A' }}</td>
                <td>{{ row.Summary }}</td>
                {% if file_results[0].get('admin_test') %}
                <td style="background: #D1FAE5; color: #065F46; font-weight: 600;">{{ row.admin_test or 'N/A' }}</td>
                {% endif %}
                {% if file_results[0].get('POReference') and file_results[0].POReference != 'N/A' %}
                <td>{{ row.POReference or 'N/A' }}</td>
                {% endif %}
                {% if file_results[0].get('PaymentTerms') and file_results[0].PaymentTerms != 'N/A' %}
                <td>{{ row.PaymentTerms or 'N/A' }}{% if row.DueDate and row.DueDate != 'N/A' %}<br><small style="color: #666;">Due: {{ row.DueDate }}</small>{% endif %}</td>
                {% endif %}
                {% if file_results[0].get('ShippingTerms') and file_results[0].ShippingTerms != 'N/A' %}
                <td>{{ row.ShippingTerms or 'N/A' }}{% if row.PortOfLoading and row.PortOfLoading != 'N/A' %}<br><small style="color: #666;">{{ row.PortOfLoading }} {{ row.PortOfDischarge or '' }}</small>{% endif %}</td>
                {% endif %}
            </tr>
            {% endfor %}
            </tbody>
        </table>
            </div>
            {# Display Business Context Information #}
            {% for row in file_results %}
            {% if row.get('ABN') or row.get('VesselVoyage') or row.get('BillOfLading') or (row.get('Flags') and row.Flags|length > 0) %}
            <div style="padding: 15px 20px; border-top: 1px solid #e0e0e0; background: #f9f9f9;">
                <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #2c3e50;">Additional Information</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; font-size: 13px;">
                    {% if row.ABN and row.ABN != 'N/A' %}
                    <div><strong>ABN:</strong> {{ row.ABN }}</div>
                    {% endif %}
                    {% if row.VesselVoyage and row.VesselVoyage != 'N/A' %}
                    <div><strong>Vessel:</strong> {{ row.VesselVoyage }}</div>
                    {% endif %}
                    {% if row.BillOfLading and row.BillOfLading != 'N/A' %}
                    <div><strong>B/L Reference:</strong> {{ row.BillOfLading }}</div>
                    {% endif %}
                </div>
                {% if row.get('Flags') and row.Flags|length > 0 %}
                <div style="margin-top: 10px; padding: 10px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 4px;">
                    <strong style="color: #856404;">[!] Flags:</strong>
                    <ul style="margin: 5px 0 0 0; padding-left: 20px; color: #856404;">
                        {% for flag in row.Flags %}
                        <li>{{ flag }}</li>
                        {% endfor %}
                    </ul>
                </div>
                {% endif %}
            </div>
            {% endif %}
            {% endfor %}
            {# Display Line Items if present #}
            {% for row in file_results %}
            {% if row.get('LineItems') and row.LineItems|length > 0 %}
            <div style="padding: 20px; border-top: 2px solid #e0e0e0; background: #f9f9f9;">
                <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #2c3e50;">Line Items</h3>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; background: white;">
                        <thead>
                            <tr style="background: #f5f5f5;">
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Item #</th>
                                {% if row.LineItems[0].get('PartNumber') and row.LineItems[0].PartNumber != 'N/A' %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Part #</th>
                                {% endif %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Description</th>
                                {% if row.LineItems[0].get('HSCode') and row.LineItems[0].HSCode != 'N/A' %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">HS Code</th>
                                {% endif %}
                                <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Quantity</th>
                                <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Unit Price</th>
                                <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Line Total</th>
                                {% if row.LineItems[0].get('SKU') and row.LineItems[0].SKU != 'N/A' %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">SKU</th>
                                {% endif %}
                                {% if row.LineItems[0].get('Category') and row.LineItems[0].Category != 'N/A' %}
                                <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Category</th>
                                {% endif %}
                            </tr>
                        </thead>
                        <tbody>
                            {% for item in row.LineItems %}
                            <tr>
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.ItemNumber or '' }}</td>
                                {% if row.LineItems[0].get('PartNumber') and row.LineItems[0].PartNumber != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.PartNumber or '' }}</td>
                                {% endif %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.Description or 'N/A' }}</td>
                                {% if row.LineItems[0].get('HSCode') and row.LineItems[0].HSCode != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.HSCode or '' }}</td>
                                {% endif %}
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">{{ item.Quantity or 'N/A' }}</td>
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">{{ item.UnitPrice or 'N/A' }}</td>
                                <td style="padding: 8px; text-align: right; border: 1px solid #ddd; font-weight: bold;">{{ item.LineTotal or 'N/A' }}</td>
                                {% if row.LineItems[0].get('SKU') and row.LineItems[0].SKU != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.SKU or '' }}</td>
                                {% endif %}
                                {% if row.LineItems[0].get('Category') and row.LineItems[0].Category != 'N/A' %}
                                <td style="padding: 8px; border: 1px solid #ddd;">{{ item.Category or '' }}</td>
                                {% endif %}
                            </tr>
                            {% endfor %}
                        </tbody>
                    </table>
                </div>
            </div>
            {% endif %}
            {% endfor %}
        </div>
        {% endfor %}
        {% endif %}
"""