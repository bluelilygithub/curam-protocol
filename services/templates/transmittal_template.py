"""
Transmittal department template section
Extracted from gemini_service.py for modularization
"""

def get_transmittal_template():
    """
    Returns the transmittal-specific template section
    
    Returns:
        str: Jinja2 template string for transmittal department
    """
    return """        {% if department == 'transmittal' and transmittal_data %}
        <!-- Enhanced Transmittal Report with Multiple Categories -->
        <div style="background: #e8f4f8; border-left: 4px solid #3498db; padding: 12px; margin: 20px 0; border-radius: 4px; font-size: 13px; color: #2c3e50;">
            <strong>What this demonstrates:</strong> The LLM extracts semi-structured & narrative data from {{ (results or [])|length }} PDF document(s) and produces 6 clean CSV tables that engineers can immediately use in Excel, BIM coordination, fabrication workflows, and quality audits. Each CSV can be exported individually.
        </div>
        
        <!-- 1. Drawing Register -->
        {% if transmittal_data and transmittal_data.DrawingRegister %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">1. Drawing Register</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Basic drawing metadata | Use Case: Document control, revision tracking</div>
            </div>
            <div style="overflow-x: auto; max-height: 300px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Filename</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Drawing No</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Revision</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Drawing Title</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Scale</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for reg in transmittal_data.DrawingRegister %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;">{{ reg.Filename or reg.get('Filename', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ reg.DwgNo or reg.get('DwgNo', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ reg.Rev or reg.get('Rev', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ reg.Title or reg.get('Title', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ reg.Scale or reg.get('Scale', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=DrawingRegister" class="btn btn-export" style="text-decoration: none;">ðŸ“¥ Export Drawing Register to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 2. Standards & Compliance Matrix -->
        {% if transmittal_data and transmittal_data.Standards %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">2. Standards & Compliance Matrix</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Compliance audits, subcontractor briefing</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Standard</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Clause/Section</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Applicability</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Source Document</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for std in transmittal_data.Standards %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;"><span style="background: #fff3cd; padding: 2px 6px; border-radius: 3px; font-weight: 500;">{{ std.Standard or std.get('Standard', 'N/A') }}</span></td>
                            <td style="padding: 10px 12px;">{{ std.Clause or std.get('Clause', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ std.Applicability or std.get('Applicability', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ std.SourceDocument or std.get('SourceDocument', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=Standards" class="btn btn-export" style="text-decoration: none;">ðŸ“¥ Export Standards to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 3. Material Specifications Inventory -->
        {% if transmittal_data and transmittal_data.Materials %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">3. Material Specifications Inventory</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Procurement, quality control, consistency checks</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Material Type</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Grade/Spec</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Applications</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Source References</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for mat in transmittal_data.Materials %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;"><strong>{{ mat.MaterialType or mat.get('MaterialType', 'N/A') }}</strong></td>
                            <td style="padding: 10px 12px;">{{ mat.GradeSpec or mat.get('GradeSpec', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ mat.Applications or mat.get('Applications', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ mat.SourceDocument or mat.get('SourceDocument', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=Materials" class="btn btn-export" style="text-decoration: none;">ðŸ“¥ Export Materials to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 4. Connection Detail Registry -->
        {% if transmittal_data and transmittal_data.Connections %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">4. Connection Detail Registry</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Fabricator briefing, design consistency checks, RFI prevention</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Detail Mark</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Connection Type</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Bolt Spec</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Plate/Member Spec</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Weld/Torque</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Drawing Ref</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for conn in transmittal_data.Connections %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;"><strong>{{ conn.DetailMark or conn.get('DetailMark', 'N/A') }}</strong></td>
                            <td style="padding: 10px 12px;">{{ conn.ConnectionType or conn.get('ConnectionType', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ conn.BoltSpec or conn.get('BoltSpec', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ conn.PlateSpec or conn.get('PlateSpec', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ conn.WeldTorque or conn.get('WeldTorque', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ conn.DrawingRef or conn.get('DrawingRef', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=Connections" class="btn btn-export" style="text-decoration: none;">Export Connections to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 5. Design Assumptions & Verification Points -->
        {% if transmittal_data and transmittal_data.Assumptions %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">5. Design Assumptions & Verification Checklist</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Site engineer verification, BIM coordination, design review</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Assumption/Spec</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Value</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Location/Zones</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Critical?</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Verification Method</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Source</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for assump in transmittal_data.Assumptions %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;">{{ assump.Assumption or assump.get('Assumption', 'N/A') }}</td>
                            <td style="padding: 10px 12px;"><span style="background: #fff3cd; padding: 2px 6px; border-radius: 3px; font-weight: 500;">{{ assump.Value or assump.get('Value', 'N/A') }}</span></td>
                            <td style="padding: 10px 12px;">{{ assump.Location or assump.get('Location', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">
                                {% set crit = assump.Critical or assump.get('Critical', '') %}
                                {% if 'CRITICAL' in crit|upper %}
                                <strong style="color: #e74c3c;">CRITICAL</strong>
                                {% elif 'HIGH' in crit|upper %}
                                <strong style="color: #f39c12;">HIGH</strong>
        {% else %}
                                {{ crit }}
                                {% endif %}
                            </td>
                            <td style="padding: 10px 12px;">{{ assump.VerificationMethod or assump.get('VerificationMethod', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ assump.SourceDocument or assump.get('SourceDocument', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=Assumptions" class="btn btn-export" style="text-decoration: none;">Export Assumptions to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 6. V.O.S. Flags & Coordination Points -->
        {% if transmittal_data and transmittal_data.VOSFlags %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">6. V.O.S. Flags & On-Site Coordination Points</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Site management, design coordination, decision log</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Flag ID</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Item</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Issue</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Action Required</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Responsible Party</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for vos in transmittal_data.VOSFlags %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;"><span style="background: #e74c3c; color: white; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: 600;">{{ vos.FlagID or vos.get('FlagID', 'N/A') }}</span></td>
                            <td style="padding: 10px 12px;">{{ vos.Item or vos.get('Item', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ vos.Issue or vos.get('Issue', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ vos.ActionRequired or vos.get('ActionRequired', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ vos.ResponsibleParty or vos.get('ResponsibleParty', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ vos.Status or vos.get('Status', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=VOSFlags" class="btn btn-export" style="text-decoration: none;">Export V.O.S. Flags to CSV</a>
            </div>
        </div>
        {% endif %}
        
        <!-- 7. Cross-Reference Validation -->
        {% if transmittal_data and transmittal_data.CrossReferences %}
        <div style="background: white; border-radius: 8px; margin-bottom: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
            <div style="background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">7. Cross-Reference Validation & Missing Details Report</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Extracted from all documents | Use Case: Quality assurance, drawing completeness audit, RFI prevention</div>
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #ecf0f1; position: sticky; top: 0;">
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Reference</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Referenced In</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Refers To</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Found?</th>
                            <th style="padding: 12px; text-align: left; font-weight: 600; border-bottom: 2px solid #bdc3c7;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {% for xref in transmittal_data.CrossReferences %}
                        <tr style="border-bottom: 1px solid #ecf0f1;">
                            <td style="padding: 10px 12px;">{{ xref.Reference or xref.get('Reference', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ xref.ReferencedIn or xref.get('ReferencedIn', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">{{ xref.RefersTo or xref.get('RefersTo', 'N/A') }}</td>
                            <td style="padding: 10px 12px;">
                                {% set found = xref.Found or xref.get('Found', '') %}
                                {% if 'yes' in found|lower or 'true' in found|lower %}
                                <span style="color: #27ae60; font-weight: 600;">Found</span>
                                {% elif 'no' in found|lower or 'false' in found|lower %}
                                <span style="color: #e74c3c; font-weight: 600;">Missing</span>
                                {% else %}
                                {{ found or 'N/A' }}
                                {% endif %}
                            </td>
                            <td style="padding: 10px 12px;">{{ xref.Status or xref.get('Status', 'N/A') }}</td>
                        </tr>
                        {% endfor %}
                    </tbody>
                </table>
            </div>
            <div style="padding: 12px 20px; background: #f8f9fa; border-top: 1px solid #e9ecef;">
                <a href="/export_transmittal_csv?category=CrossReferences" class="btn btn-export" style="text-decoration: none;">ðŸ“¥ Export Cross-References to CSV</a>
            </div>
        </div>
        {% endif %}
        
        {% if model_actions %}
        <div class="action-log" style="margin-top: 30px;">
            <div><strong>Action log</strong></div>
            <ol>
                {% for action in model_actions %}
                <li>{{ action }}</li>
                {% endfor %}
            </ol>
        </div>
        {% endif %}
        
        {% endif %}
        
        {% if department == 'transmittal' and not transmittal_data %}
        <!-- Fallback to simple table if aggregated data not available for transmittal -->
        <table>
            <thead>
            <tr>
                <th>Filename</th>
                    <th>Drawing No</th>
                    <th>Revision</th>
                    <th>Drawing Title</th>
                    <th>Scale</th>
                </tr>
            </thead>
            <tbody>
                {% for row in results %}
                <tr>
                    <td>{{ row.Filename }}</td>
                    <td>{{ row.DwgNo }}</td>
                    <td>{{ row.Rev }}</td>
                    <td>{{ row.Title }}</td>
                    <td>{{ row.Scale }}</td>
                </tr>
                {% endfor %}
            </tbody>
        </table>
        {% endif %}
"""