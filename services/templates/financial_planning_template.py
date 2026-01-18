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
            <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; padding: 16px 20px;">
                <div style="font-size: 18px; font-weight: 600;">{{ filename }}</div>
                <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">{{ file_results|length }} record(s) extracted</div>
            </div>
            {% for row in file_results %}
            <div style="padding: 20px;">
                {# Licensee/Company Information #}
                {% if row.get('LicenseeName') or row.get('ABN') or row.get('AFSL') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Licensee Information</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('LicenseeName') and row.LicenseeName != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Licensee:</strong> {{ row.LicenseeName }}</div>
                        {% endif %}
                        {% if row.get('ABN') and row.ABN != 'N/A' %}
                        <div><strong>ABN:</strong> {{ row.ABN }}</div>
                        {% endif %}
                        {% if row.get('AFSL') and row.AFSL != 'N/A' %}
                        <div><strong>AFSL:</strong> {{ row.AFSL }}</div>
                        {% endif %}
                        {% if row.get('BusinessAddress') and row.BusinessAddress != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Address:</strong> {{ row.BusinessAddress }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Adviser Information #}
                {% if row.get('AdviserName') or row.get('AdviserARN') or row.get('AdviserQualifications') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Adviser Details</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('AdviserName') and row.AdviserName != 'N/A' %}
                        <div><strong>Adviser:</strong> {{ row.AdviserName }}</div>
                        {% endif %}
                        {% if row.get('AdviserARN') and row.AdviserARN != 'N/A' %}
                        <div><strong>AR Number:</strong> {{ row.AdviserARN }}</div>
                        {% endif %}
                        {% if row.get('AdviserQualifications') and row.AdviserQualifications != 'N/A' %}
                        <div><strong>Qualifications:</strong> {{ row.AdviserQualifications }}</div>
                        {% endif %}
                        {% if row.get('AdviserContact') and row.AdviserContact != 'N/A' %}
                        <div><strong>Contact:</strong> {{ row.AdviserContact }}</div>
                        {% endif %}
                        {% if row.get('ComplianceManager') and row.ComplianceManager != 'N/A' %}
                        <div><strong>Compliance Manager:</strong> {{ row.ComplianceManager }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Client Information Section #}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Client Information</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('ClientName') and row.ClientName != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Client:</strong> {{ row.ClientName }}</div>
                        {% endif %}
                        {% if row.get('JointClient') and row.JointClient != 'N/A' %}
                        <div><strong>Joint Client:</strong> {{ row.JointClient }}</div>
                        {% endif %}
                        {% if row.get('ClientNumber') and row.ClientNumber != 'N/A' %}
                        <div><strong>Client #:</strong> {{ row.ClientNumber }}</div>
                        {% endif %}
                        {% if row.get('AccountType') and row.AccountType != 'N/A' %}
                        <div><strong>Account Type:</strong> {{ row.AccountType }}</div>
                        {% endif %}
                        {% if row.get('RiskProfile') and row.RiskProfile != 'N/A' %}
                        <div><strong>Risk Profile:</strong> {{ row.RiskProfile }}</div>
                        {% endif %}
                        {% if row.get('ClientAddress') and row.ClientAddress != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Address:</strong> {{ row.ClientAddress }}</div>
                        {% endif %}
                        {% if row.get('AnnualIncome') and row.AnnualIncome != 'N/A' %}
                        <div><strong>Annual Income:</strong> {{ row.AnnualIncome }}</div>
                        {% endif %}
                        {% if row.get('Dependents') and row.Dependents != 'N/A' %}
                        <div><strong>Dependents:</strong> {{ row.Dependents }}</div>
                        {% endif %}
                    </div>
                </div>
                
                {# Portfolio Summary #}
                {% if row.get('OpeningBalance') or row.get('ClosingBalance') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Portfolio Summary{% if row.get('StatementPeriod') %} - {{ row.StatementPeriod }}{% endif %}</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">
                        {% if row.get('OpeningBalance') and row.OpeningBalance != 'N/A' %}
                        <div style="background: #f0f9ff; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Opening Balance</div>
                            <div style="font-size: 16px; font-weight: 700; color: #0369a1;">${{ row.OpeningBalance }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('Contributions') and row.Contributions != 'N/A' %}
                        <div style="background: #ecfdf5; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Contributions</div>
                            <div style="font-size: 16px; font-weight: 700; color: #065f46;">+${{ row.Contributions }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('InvestmentReturns') and row.InvestmentReturns != 'N/A' %}
                        <div style="background: #f0fdf4; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Investment Returns</div>
                            <div style="font-size: 16px; font-weight: 700; color: #166534;">+${{ row.InvestmentReturns }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('Withdrawals') and row.Withdrawals != 'N/A' %}
                        <div style="background: #fef2f2; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Withdrawals</div>
                            <div style="font-size: 16px; font-weight: 700; color: #dc2626;">{{ row.Withdrawals }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('FeesCharged') and row.FeesCharged != 'N/A' %}
                        <div style="background: #fff7ed; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Fees & Charges</div>
                            <div style="font-size: 16px; font-weight: 700; color: #c2410c;">{{ row.FeesCharged }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('ClosingBalance') and row.ClosingBalance != 'N/A' %}
                        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: rgba(255,255,255,0.8); text-transform: uppercase;">Closing Balance</div>
                            <div style="font-size: 18px; font-weight: 700; color: #d4af37;">${{ row.ClosingBalance }}</div>
                        </div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Asset Allocation Table #}
                {% if row.get('AssetAllocation') and row.AssetAllocation is iterable and row.AssetAllocation is not string and row.AssetAllocation|length > 0 %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Asset Allocation</h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Asset Class</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Target %</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Actual %</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Market Value</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Change</th>
                                </tr>
                            </thead>
                            <tbody>
                                {% for asset in row.AssetAllocation %}
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ asset.AssetClass or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0;">{{ asset.TargetPercent or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600;">{{ asset.ActualPercent or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600;">{{ asset.MarketValue or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; color: {% if asset.Change and '+' in (asset.Change|string) %}#166534{% else %}#dc2626{% endif %};">{{ asset.Change or 'N/A' }}</td>
                                </tr>
                                {% endfor %}
                            </tbody>
                        </table>
                    </div>
                    {% if row.get('GrowthAssetsPercent') or row.get('DefensiveAssetsPercent') %}
                    <div style="margin-top: 12px; display: flex; gap: 20px; font-size: 13px;">
                        {% if row.get('GrowthAssetsPercent') and row.GrowthAssetsPercent != 'N/A' %}
                        <div><strong>Growth Assets:</strong> {{ row.GrowthAssetsPercent }}</div>
                        {% endif %}
                        {% if row.get('DefensiveAssetsPercent') and row.DefensiveAssetsPercent != 'N/A' %}
                        <div><strong>Defensive Assets:</strong> {{ row.DefensiveAssetsPercent }}</div>
                        {% endif %}
                    </div>
                    {% endif %}
                </div>
                {% endif %}
                
                {# Detailed Holdings Table #}
                {% if row.get('Holdings') and row.Holdings is iterable and row.Holdings is not string and row.Holdings|length > 0 %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Detailed Holdings</h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Security</th>
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Code</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Units</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Price</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Market Value</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">% Port</th>
                                </tr>
                            </thead>
                            <tbody>
                                {% for holding in row.Holdings %}
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ holding.SecurityName or 'N/A' }}</td>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600; color: #2563eb;">{{ holding.SecurityCode or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0;">{{ holding.Units or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0;">{{ holding.UnitPrice or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600;">{{ holding.MarketValue or 'N/A' }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0;">{{ holding.PortfolioPercent or 'N/A' }}</td>
                                </tr>
                                {% endfor %}
                            </tbody>
                        </table>
                    </div>
                </div>
                {% endif %}
                
                {# Income Summary #}
                {% if row.get('DividendIncome') or row.get('DistributionIncome') or row.get('InterestIncome') or row.get('TotalQuarterlyIncome') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Income Summary</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">
                        {% if row.get('DividendIncome') and row.DividendIncome != 'N/A' %}
                        <div style="background: #ecfdf5; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Dividends</div>
                            <div style="font-size: 16px; font-weight: 700; color: #065f46;">${{ row.DividendIncome }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('FrankingCredits') and row.FrankingCredits != 'N/A' %}
                        <div style="background: #f0fdf4; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Franking Credits</div>
                            <div style="font-size: 16px; font-weight: 700; color: #166534;">${{ row.FrankingCredits }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('DistributionIncome') and row.DistributionIncome != 'N/A' %}
                        <div style="background: #eff6ff; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Distributions</div>
                            <div style="font-size: 16px; font-weight: 700; color: #1e40af;">${{ row.DistributionIncome }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('InterestIncome') and row.InterestIncome != 'N/A' %}
                        <div style="background: #faf5ff; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Interest</div>
                            <div style="font-size: 16px; font-weight: 700; color: #6d28d9;">${{ row.InterestIncome }}</div>
                        </div>
                        {% endif %}
                        {% if row.get('TotalQuarterlyIncome') and row.TotalQuarterlyIncome != 'N/A' %}
                        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: rgba(255,255,255,0.8); text-transform: uppercase;">Total Income</div>
                            <div style="font-size: 18px; font-weight: 700; color: #d4af37;">${{ row.TotalQuarterlyIncome }}</div>
                        </div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Performance Metrics #}
                {% if row.get('QuarterlyReturn') or row.get('OneYearReturn') or row.get('ThreeYearReturn') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Performance Comparison</h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Metric</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Quarter</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">1 Year</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">3 Years (p.a.)</th>
                                    <th style="padding: 10px; text-align: right; border: 1px solid #e2e8f0;">Since Inception</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">Your Portfolio</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600; color: #166534;">{{ row.get('QuarterlyReturn', 'N/A') }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600; color: #166534;">{{ row.get('OneYearReturn', 'N/A') }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600; color: #166534;">{{ row.get('ThreeYearReturn', 'N/A') }}</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600; color: #166534;">{{ row.get('SinceInceptionReturn', 'N/A') }}</td>
                                </tr>
                                {% if row.get('BenchmarkReturn') and row.BenchmarkReturn != 'N/A' %}
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">Benchmark</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0;" colspan="4">{{ row.BenchmarkReturn }}</td>
                                </tr>
                                {% endif %}
                                {% if row.get('Outperformance') and row.Outperformance != 'N/A' %}
                                <tr style="background: #ecfdf5;">
                                    <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600; color: #065f46;">Outperformance</td>
                                    <td style="padding: 8px; text-align: right; border: 1px solid #e2e8f0; font-weight: 600; color: #065f46;" colspan="4">{{ row.Outperformance }}</td>
                                </tr>
                                {% endif %}
                            </tbody>
                        </table>
                    </div>
                </div>
                {% endif %}
                
                {# Investment Objectives #}
                {% if row.get('InvestmentObjective') or row.get('TargetReturn') or row.get('RetirementTarget') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Investment Objectives</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('InvestmentObjective') and row.InvestmentObjective != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Objective:</strong> {{ row.InvestmentObjective }}</div>
                        {% endif %}
                        {% if row.get('TargetReturn') and row.TargetReturn != 'N/A' %}
                        <div><strong>Target Return:</strong> {{ row.TargetReturn }}</div>
                        {% endif %}
                        {% if row.get('RetirementTarget') and row.RetirementTarget != 'N/A' %}
                        <div><strong>Retirement Target:</strong> {{ row.RetirementTarget }}</div>
                        {% endif %}
                        {% if row.get('IncomeTarget') and row.IncomeTarget != 'N/A' %}
                        <div><strong>Income Target:</strong> {{ row.IncomeTarget }}</div>
                        {% endif %}
                        {% if row.get('InvestmentHorizon') and row.InvestmentHorizon != 'N/A' %}
                        <div><strong>Investment Horizon:</strong> {{ row.InvestmentHorizon }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Rebalancing Strategy #}
                {% if row.get('RebalancingStrategy') or row.get('RebalancingThreshold') or row.get('ReviewSchedule') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Rebalancing & Review</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('RebalancingStrategy') and row.RebalancingStrategy != 'N/A' %}
                        <div style="grid-column: span 2;"><strong>Strategy:</strong> {{ row.RebalancingStrategy }}</div>
                        {% endif %}
                        {% if row.get('RebalancingThreshold') and row.RebalancingThreshold != 'N/A' %}
                        <div><strong>Threshold:</strong> {{ row.RebalancingThreshold }}</div>
                        {% endif %}
                        {% if row.get('ReviewSchedule') and row.ReviewSchedule != 'N/A' %}
                        <div><strong>Review Schedule:</strong> {{ row.ReviewSchedule }}</div>
                        {% endif %}
                        {% if row.get('NextReviewDate') and row.NextReviewDate != 'N/A' %}
                        <div><strong>Next Review:</strong> {{ row.NextReviewDate }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Investment Risks #}
                {% if row.get('InvestmentRisks') and row.InvestmentRisks is iterable and row.InvestmentRisks is not string and row.InvestmentRisks|length > 0 %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Investment Risks & Mitigation</h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0; width: 25%;">Risk Type</th>
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Mitigation Strategy</th>
                                </tr>
                            </thead>
                            <tbody>
                                {% for risk in row.InvestmentRisks %}
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">{{ risk.RiskType or 'N/A' }}</td>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ risk.MitigationStrategy or 'N/A' }}</td>
                                </tr>
                                {% endfor %}
                            </tbody>
                        </table>
                    </div>
                </div>
                {% endif %}
                
                {# Fee Disclosure #}
                {% if row.get('InitialAdviceFee') or row.get('TotalInitialFees') or row.get('TotalOngoingFees') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Fee Disclosure</h4>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px;">
                        {# Initial Fees #}
                        {% if row.get('InitialAdviceFee') or row.get('TotalInitialFees') %}
                        <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                            <h5 style="margin: 0 0 12px 0; font-size: 13px; color: #475569;">Initial Fees</h5>
                            {% if row.get('InitialAdviceFee') and row.InitialAdviceFee != 'N/A' %}
                            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
                                <span>SOA Preparation Fee</span>
                                <span style="font-weight: 600;">${{ row.InitialAdviceFee }}</span>
                            </div>
                            {% endif %}
                            {% if row.get('ImplementationFee') and row.ImplementationFee != 'N/A' %}
                            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
                                <span>Implementation Fee</span>
                                <span style="font-weight: 600;">${{ row.ImplementationFee }}</span>
                            </div>
                            {% endif %}
                            {% if row.get('TotalInitialFees') and row.TotalInitialFees != 'N/A' %}
                            <div style="display: flex; justify-content: space-between; font-size: 14px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-weight: 700;">
                                <span>Total Initial Fees</span>
                                <span style="color: #1e3a5f;">${{ row.TotalInitialFees }}</span>
                            </div>
                            {% endif %}
                        </div>
                        {% endif %}
                        {# Ongoing Fees #}
                        {% if row.get('PortfolioManagementFee') or row.get('TotalOngoingFees') %}
                        <div style="background: #f8fafc; padding: 16px; border-radius: 8px;">
                            <h5 style="margin: 0 0 12px 0; font-size: 13px; color: #475569;">Ongoing Fees (Estimated)</h5>
                            {% if row.get('PortfolioManagementFee') and row.PortfolioManagementFee != 'N/A' %}
                            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
                                <span>Portfolio Management</span>
                                <span style="font-weight: 600;">${{ row.PortfolioManagementFee }}</span>
                            </div>
                            {% endif %}
                            {% if row.get('AnnualAdminFee') and row.AnnualAdminFee != 'N/A' %}
                            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
                                <span>Annual Admin Fee</span>
                                <span style="font-weight: 600;">${{ row.AnnualAdminFee }}</span>
                            </div>
                            {% endif %}
                            {% if row.get('TotalOngoingFees') and row.TotalOngoingFees != 'N/A' %}
                            <div style="display: flex; justify-content: space-between; font-size: 14px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-weight: 700;">
                                <span>Total Ongoing Fees</span>
                                <span style="color: #1e3a5f;">${{ row.TotalOngoingFees }}</span>
                            </div>
                            {% endif %}
                        </div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Ongoing Services #}
                {% if row.get('OngoingServices') and row.OngoingServices is iterable and row.OngoingServices is not string and row.OngoingServices|length > 0 %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Ongoing Service Agreement</h4>
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0; width: 25%;">Frequency</th>
                                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">Services Included</th>
                                </tr>
                            </thead>
                            <tbody>
                                {% for service in row.OngoingServices %}
                                <tr>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">{{ service.Frequency or 'N/A' }}</td>
                                    <td style="padding: 8px; border: 1px solid #e2e8f0;">{{ service.Description or 'N/A' }}</td>
                                </tr>
                                {% endfor %}
                            </tbody>
                        </table>
                    </div>
                </div>
                {% endif %}
                
                {# FSG Acknowledgment #}
                {% if row.get('FSGVersion') or row.get('DocumentsAcknowledged') or row.get('SignatureDate') %}
                <div style="margin-bottom: 20px; background: #ecfdf5; padding: 16px; border-radius: 8px; border-left: 4px solid #10b981;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #065f46;">FSG Acknowledgment</h4>
                    <div style="font-size: 13px; color: #047857;">
                        {% if row.get('FSGVersion') and row.FSGVersion != 'N/A' %}
                        <div><strong>FSG Version:</strong> {{ row.FSGVersion }}</div>
                        {% endif %}
                        {% if row.get('DocumentsAcknowledged') and row.DocumentsAcknowledged != 'N/A' %}
                        <div style="margin-top: 6px;"><strong>Documents Acknowledged:</strong> 
                            {% if row.DocumentsAcknowledged is iterable and row.DocumentsAcknowledged is not string %}
                                {{ row.DocumentsAcknowledged | join(', ') }}
                            {% else %}
                                {{ row.DocumentsAcknowledged }}
                            {% endif %}
                        </div>
                        {% endif %}
                        {% if row.get('SignatureDate') and row.SignatureDate != 'N/A' %}
                        <div style="margin-top: 6px;"><strong>Signed:</strong> {{ row.SignatureDate }}</div>
                        {% endif %}
                        {% if row.get('DocumentReference') and row.DocumentReference != 'N/A' %}
                        <div style="margin-top: 6px;"><strong>Reference:</strong> {{ row.DocumentReference }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Document Control #}
                {% if row.get('DocumentType') or row.get('DocumentVersion') or row.get('DatePrepared') %}
                <div style="margin-bottom: 20px;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: #1e3a5f; border-bottom: 2px solid #d4af37; padding-bottom: 6px;">Document Information</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: 13px;">
                        {% if row.get('DocumentType') and row.DocumentType != 'N/A' %}
                        <div><strong>Document Type:</strong> {{ row.DocumentType }}</div>
                        {% endif %}
                        {% if row.get('DocumentVersion') and row.DocumentVersion != 'N/A' %}
                        <div><strong>Version:</strong> {{ row.DocumentVersion }}</div>
                        {% endif %}
                        {% if row.get('DatePrepared') and row.DatePrepared != 'N/A' %}
                        <div><strong>Date Prepared:</strong> {{ row.DatePrepared }}</div>
                        {% endif %}
                        {% if row.get('PreparedBy') and row.PreparedBy != 'N/A' %}
                        <div><strong>Prepared By:</strong> {{ row.PreparedBy }}</div>
                        {% endif %}
                        {% if row.get('DocumentID') and row.DocumentID != 'N/A' %}
                        <div><strong>Document ID:</strong> {{ row.DocumentID }}</div>
                        {% endif %}
                        {% if row.get('NextReview') and row.NextReview != 'N/A' %}
                        <div><strong>Next Review:</strong> {{ row.NextReview }}</div>
                        {% endif %}
                    </div>
                </div>
                {% endif %}
                
                {# Adviser Commentary #}
                {% if row.get('AdviserCommentary') and row.AdviserCommentary != 'N/A' %}
                <div style="margin-top: 15px; padding: 16px; background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); border-radius: 8px; color: white;">
                    <strong style="color: #d4af37;">Adviser Commentary:</strong>
                    <div style="margin-top: 8px; font-size: 13px; line-height: 1.6;">{{ row.AdviserCommentary }}</div>
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
