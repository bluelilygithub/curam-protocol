"""
Logistics department template section
Extracted from gemini_service.py for modularization
"""

def get_logistics_template():
    """
    Returns the logistics-specific template section
    
    This template handles rendering of logistics extraction results,
    including FTA Lists, Bills of Lading, and Packing Lists.
    
    Returns:
        str: Jinja2 template string for logistics department
    """
    return """
        {% if department == 'logistics' %}
        {# Render logistics results - one table for all documents #}
        {% if results %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">Logistics Documents Extracted</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ results|length }} row(s) extracted</div>
            </div>
            <div style="overflow-x: auto;">
        
        {# Use namespace to track document types (Jinja2 workaround for loop variables) #}
        {% set ns = namespace(has_fta=false, has_bol=false, has_packing=false) %}
        {% for row in results %}
            {% if row.get('_document_type') == 'fta_list' %}
                {% set ns.has_fta = true %}
            {% elif row.get('_document_type') == 'bill_of_lading' %}
                {% set ns.has_bol = true %}
            {% elif row.get('_document_type') == 'packing_list' %}
                {% set ns.has_packing = true %}
            {% endif %}
        {% endfor %}
        
        
        {# FTA DOCUMENT TABLE #}
        {% if ns.has_fta %}
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px; background: white;">
            <thead>
                <tr style="background-color: #0B1221; color: white;">
                    <th style="padding: 10px; border: 1px solid #ddd;">Item Description</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Country of Origin</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">FTA Agreement</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Shipment Ref</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Invoice #</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Tariff Code</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Notes</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">File</th>
                </tr>
            </thead>
            <tbody>
            {% for row in results %}
                {% if row.get('_document_type') == 'fta_list' %}
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('ItemDescription', row.get('Description', 'N/A')) }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('CountryOfOrigin', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('FTAAgreement', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('ShipmentRef', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('InvoiceNumber', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('TariffCode', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('Notes', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd; font-size: 11px;">{{ row.get('Filename', 'N/A') }}</td>
            </tr>
                {% endif %}
            {% endfor %}
            </tbody>
        </table>
        {% endif %}
        
        {# BILL OF LADING TABLE #}
        {% if ns.has_bol %}
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px; background: white;">
            <thead>
                <tr style="background-color: #0B1221; color: white;">
                    <th style="padding: 10px; border: 1px solid #ddd;">B/L Number</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Shipper</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Consignee</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Vessel</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Container #</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Port of Loading</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Port of Discharge</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Description</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Weight</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">File</th>
                </tr>
            </thead>
            <tbody>
            {% for row in results %}
                {% if row.get('_document_type') == 'bill_of_lading' %}
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('BLNumber', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('Shipper', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('Consignee', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('Vessel', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('ContainerNumber', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('PortOfLoading', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('PortOfDischarge', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('CargoDescription', row.get('Description', 'N/A')) }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('GrossWeight', row.get('Weight', 'N/A')) }}</td>
                <td style="padding: 10px; border: 1px solid #ddd; font-size: 11px;">{{ row.get('Filename', 'N/A') }}</td>
            </tr>
                {% endif %}
            {% endfor %}
            </tbody>
        </table>
        {% endif %}
        
        {# PACKING LIST TABLE #}
        {% if ns.has_packing %}
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px; background: white;">
            <thead>
                <tr style="background-color: #0B1221; color: white;">
                    <th style="padding: 10px; border: 1px solid #ddd;">Carton #</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">PO Number</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Item Description</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Quantity</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Dimensions</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Gross Weight</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Net Weight</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Volume</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">File</th>
                </tr>
            </thead>
            <tbody>
            {% for row in results %}
                {% if row.get('_document_type') == 'packing_list' %}
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('CartonNumber', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('PONumber', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('ItemDescription', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('Quantity', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('Dimensions', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('GrossWeight', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('NetWeight', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">{{ row.get('Volume', 'N/A') }}</td>
                <td style="padding: 10px; border: 1px solid #ddd; font-size: 11px;">{{ row.get('Filename', 'N/A') }}</td>
            </tr>
                {% endif %}
            {% endfor %}
            </tbody>
        </table>
        {% endif %}
        
        {# Show message if no tables were rendered #}
        {% if not ns.has_fta and not ns.has_bol and not ns.has_packing %}
        <div style="background: #f8d7da; border: 2px solid #dc3545; padding: 15px; margin: 20px 0; border-radius: 8px;">
            [WARNING] No recognized document types found in results!<br>
            Total rows: {{ results|length }}<br>
            First row keys: {{ results[0].keys()|list if results else 'No results' }}
        </div>
        {% endif %}
        
            </div>
        </div>

        {% endif %}
        {% endif %}
    """
