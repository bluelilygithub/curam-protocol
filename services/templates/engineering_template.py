"""
Engineering department template section
Extracted from gemini_service.py for modularization
"""

def get_engineering_template():
    """
    Returns the engineering-specific template section
    
    Returns:
        str: Jinja2 template string for engineering department
    """
    return """        {% if department == 'engineering' %}
        {# Render separate table for each document #}
        {% for filename, file_results in grouped_engineering_results.items() %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">{{ filename }}</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ file_results|length }} row(s) extracted</div>
            </div>
            <div style="overflow-x: auto;">
        <table>
            <thead>
                <tr>
                    {% if schedule_type == 'column' %}
                    <th>Mark</th>
                    <th>Section Type</th>
                    <th>Size</th>
                    <th>Length</th>
                    <th>Grade</th>
                    <th>Base Plate</th>
                    <th>Cap Plate</th>
                    <th>Finish</th>
                    <th>Comments</th>
                    {% else %}
                    <th>Mark</th>
                    <th>Size</th>
                    <th>Qty</th>
                    <th>Length</th>
                    <th>Grade</th>
                    <th>Paint System</th>
                    <th>Comments</th>
                    {% endif %}
            </tr>
            </thead>
            <tbody>
            {% for row in file_results %}
            <tr {% if row.get('requires_manual_verification') %}class="requires-manual-verification"{% elif row.get('has_critical_errors') %}class="has-critical-errors"{% endif %}>
                    {% if schedule_type == 'column' %}
                    <td>{% if row.get('Mark_confidence') == 'low' %}<span class="low-confidence">{{ row.Mark }}</span>{% else %}{{ row.Mark }}{% endif %}</td>
                    <td>{{ row.SectionType }}</td>
                    <td>{% if row.get('Size_confidence') == 'low' %}<span class="low-confidence">{{ row.Size }}</span>{% else %}{{ row.Size }}{% endif %}</td>
                    <td>{{ row.Length }}</td>
                    <td>{% if row.get('Grade_confidence') == 'low' %}<span class="low-confidence">{{ row.Grade }}</span>{% else %}{{ row.Grade }}{% endif %}</td>
                    <td>{{ row.BasePlate }}</td>
                    <td>{{ row.CapPlate }}</td>
                    <td>{{ row.Finish }}</td>
                    <td>
                        {% if row.get('Comments_confidence') == 'low' %}<span class="low-confidence-text">{{ row.Comments }}</span>{% else %}{{ row.Comments }}{% endif %}
                        {% if row.get('critical_errors') %}
                        <div class="critical-error">
                            <div class="critical-error-header">Critical Errors Detected:</div>
                            {% for error in row.critical_errors %}
                            <div class="critical-error-item">{{ error }}</div>
                            {% endfor %}
                        </div>
                        {% endif %}
                    </td>
                    {% else %}
                    <td>{% if row.get('Mark_confidence') == 'low' %}<span class="low-confidence">{{ row.Mark }}</span>{% else %}{{ row.Mark }}{% endif %}</td>
                    <td>
                        {% if row.get('Size_confidence') == 'low' %}<span class="low-confidence">{{ row.Size }}</span>{% else %}{{ row.Size }}{% endif %}
                        {% if row.get('corrections_applied') %}
                            {% for correction in row.corrections_applied %}
                                {% if 'Size' in correction %}
                                <div style="background-color: #d1f2eb; border-left: 3px solid #27ae60; padding: 4px 8px; margin-top: 4px; border-radius: 3px; font-size: 11px;">
                                    {{ correction }}
                                </div>
                                {% endif %}
                            {% endfor %}
                        {% endif %}
                        {% if row.get('critical_errors') %}
                            {% for error in row.critical_errors %}
                                {% if 'Size' in error %}
                                <div class="critical-error" style="margin-top: 4px;">
                                    <div class="critical-error-header">[!] Size Error:</div>
                                    <div class="critical-error-item">{{ error }}</div>
                                </div>
                                {% endif %}
                            {% endfor %}
                        {% endif %}
                    </td>
                    <td>
                        {{ row.Qty }}
                        {% if row.get('critical_errors') %}
                            {% for error in row.critical_errors %}
                                {% if 'Quantity' in error %}
                                <div class="critical-error" style="margin-top: 4px;">
                                    <div class="critical-error-header">[!] Quantity Error:</div>
                                    <div class="critical-error-item">{{ error }}</div>
                                </div>
                                {% endif %}
                            {% endfor %}
                        {% endif %}
                    </td>
                    <td>{{ row.Length }}</td>
                    <td>
                        {% if row.get('Grade_confidence') == 'low' %}<span class="low-confidence">{{ row.Grade }}</span>{% else %}{{ row.Grade }}{% endif %}
                        {% if row.get('critical_errors') %}
                            {% for error in row.critical_errors %}
                                {% if 'Grade' in error %}
                                <div class="critical-error" style="margin-top: 4px;">
                                    <div class="critical-error-header">[!] Grade Error:</div>
                                    <div class="critical-error-item">{{ error }}</div>
                                </div>
                                {% endif %}
                            {% endfor %}
                        {% endif %}
                    </td>
                    <td>{% if row.get('PaintSystem_confidence') == 'low' %}<span class="low-confidence">{{ row.PaintSystem }}</span>{% else %}{{ row.PaintSystem }}{% endif %}</td>
                    <td>
                        {% if row.get('rejection_reason') %}
                        <div class="rejection-notice">
                            {{ row.rejection_reason }}
                        </div>
                        {% endif %}
                        {% if row.get('Comments_confidence') == 'low' %}<span class="low-confidence-text">{{ row.Comments }}</span>{% else %}{{ row.Comments }}{% endif %}
                        {% if row.get('critical_errors') and row.get('requires_manual_verification') %}
                        <div class="critical-error" style="margin-top: 8px;">
                            <div class="critical-error-header">Critical Errors - Manual Verification Required:</div>
                            {% for error in row.critical_errors %}
                            <div class="critical-error-item">{{ error }}</div>
                            {% endfor %}
                        </div>
                        {% endif %}
                    </td>
                    {% endif %}
            </tr>
            {% endfor %}
            </tbody>
        </table>
            </div>
        </div>
        {% endfor %}
        {% endif %}
"""