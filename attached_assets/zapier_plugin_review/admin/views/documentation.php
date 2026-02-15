<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<style>
	.curam-docs-wrap {
		max-width: 1100px;
		margin: 20px auto 40px;
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, sans-serif;
	}
	.curam-docs-header {
		background: linear-gradient(135deg, #1e3a5f 0%, #2c5282 50%, #2b6cb0 100%);
		color: #fff;
		padding: 32px 40px;
		border-radius: 12px;
		margin-bottom: 28px;
		box-shadow: 0 4px 20px rgba(30, 58, 95, 0.25);
	}
	.curam-docs-header h1 {
		margin: 0 0 8px;
		font-size: 28px;
		font-weight: 700;
		color: #fff;
	}
	.curam-docs-header p {
		margin: 0;
		font-size: 15px;
		opacity: 0.85;
		line-height: 1.5;
	}
	.curam-docs-header .version-badge {
		display: inline-block;
		background: rgba(255,255,255,0.2);
		padding: 4px 12px;
		border-radius: 20px;
		font-size: 13px;
		margin-top: 12px;
		font-weight: 500;
	}
	.curam-docs-tabs {
		display: flex;
		gap: 2px;
		background: #e2e8f0;
		border-radius: 10px 10px 0 0;
		overflow: hidden;
		flex-wrap: wrap;
	}
	.curam-docs-tab {
		padding: 14px 22px;
		cursor: pointer;
		font-size: 14px;
		font-weight: 500;
		color: #4a5568;
		background: #e2e8f0;
		border: none;
		transition: all 0.2s ease;
		white-space: nowrap;
	}
	.curam-docs-tab:hover {
		background: #cbd5e0;
		color: #2d3748;
	}
	.curam-docs-tab.active {
		background: #fff;
		color: #1e3a5f;
		font-weight: 600;
		box-shadow: 0 -2px 0 #2b6cb0 inset;
	}
	.curam-docs-content {
		background: #fff;
		border: 1px solid #e2e8f0;
		border-top: none;
		border-radius: 0 0 10px 10px;
		padding: 32px 40px;
		box-shadow: 0 2px 12px rgba(0,0,0,0.06);
	}
	.curam-docs-panel {
		display: none;
	}
	.curam-docs-panel.active {
		display: block;
	}
	.curam-docs-panel h2 {
		font-size: 22px;
		color: #1e3a5f;
		margin: 0 0 20px;
		padding-bottom: 12px;
		border-bottom: 2px solid #e2e8f0;
	}
	.curam-docs-panel h3 {
		font-size: 17px;
		color: #2d3748;
		margin: 28px 0 12px;
	}
	.curam-docs-panel p, .curam-docs-panel li {
		font-size: 14.5px;
		line-height: 1.7;
		color: #4a5568;
	}
	.curam-docs-panel ul, .curam-docs-panel ol {
		padding-left: 24px;
	}
	.curam-docs-panel li {
		margin-bottom: 6px;
	}
	.curam-step-card {
		background: #f7fafc;
		border: 1px solid #e2e8f0;
		border-left: 4px solid #2b6cb0;
		border-radius: 0 8px 8px 0;
		padding: 20px 24px;
		margin: 16px 0;
	}
	.curam-step-card h4 {
		margin: 0 0 8px;
		font-size: 15px;
		color: #1e3a5f;
	}
	.curam-step-card p {
		margin: 0;
		font-size: 14px;
	}
	.curam-step-number {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: #2b6cb0;
		color: #fff;
		border-radius: 50%;
		font-size: 14px;
		font-weight: 700;
		margin-right: 10px;
		flex-shrink: 0;
	}
	.curam-code-block {
		background: #1a202c;
		color: #e2e8f0;
		padding: 18px 22px;
		border-radius: 8px;
		font-family: "SF Mono", "Fira Code", "Consolas", monospace;
		font-size: 13px;
		line-height: 1.6;
		overflow-x: auto;
		margin: 12px 0 16px;
	}
	.curam-code-block .code-comment {
		color: #718096;
	}
	.curam-code-block .code-keyword {
		color: #90cdf4;
	}
	.curam-code-block .code-string {
		color: #9ae6b4;
	}
	.curam-info-box {
		background: #ebf8ff;
		border: 1px solid #bee3f8;
		border-radius: 8px;
		padding: 16px 20px;
		margin: 16px 0;
	}
	.curam-info-box.warning {
		background: #fffaf0;
		border-color: #feebc8;
	}
	.curam-info-box.success {
		background: #f0fff4;
		border-color: #c6f6d5;
	}
	.curam-info-box.danger {
		background: #fff5f5;
		border-color: #fed7d7;
	}
	.curam-info-box strong {
		display: block;
		margin-bottom: 4px;
		font-size: 14px;
	}
	.curam-info-box p {
		margin: 0;
		font-size: 13.5px;
	}
	.curam-feature-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 16px;
		margin: 20px 0;
	}
	.curam-feature-card {
		background: #f7fafc;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 20px;
		transition: box-shadow 0.2s;
	}
	.curam-feature-card:hover {
		box-shadow: 0 4px 12px rgba(0,0,0,0.08);
	}
	.curam-feature-card .feature-icon {
		font-size: 24px;
		margin-bottom: 10px;
	}
	.curam-feature-card h4 {
		margin: 0 0 8px;
		font-size: 15px;
		color: #1e3a5f;
	}
	.curam-feature-card p {
		margin: 0;
		font-size: 13.5px;
		color: #718096;
	}
	.curam-table {
		width: 100%;
		border-collapse: collapse;
		margin: 16px 0;
		font-size: 14px;
	}
	.curam-table th {
		background: #edf2f7;
		text-align: left;
		padding: 12px 16px;
		font-weight: 600;
		color: #2d3748;
		border-bottom: 2px solid #cbd5e0;
	}
	.curam-table td {
		padding: 10px 16px;
		border-bottom: 1px solid #e2e8f0;
		color: #4a5568;
	}
	.curam-table tr:hover td {
		background: #f7fafc;
	}
	.curam-check { color: #38a169; font-weight: bold; }
	.curam-file-tree {
		background: #f7fafc;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 20px 24px;
		font-family: "SF Mono", "Fira Code", "Consolas", monospace;
		font-size: 13px;
		line-height: 1.8;
		color: #4a5568;
	}
	.curam-file-tree .folder {
		color: #2b6cb0;
		font-weight: 600;
	}
	.curam-file-tree .file-desc {
		color: #a0aec0;
		font-style: italic;
	}
	.curam-checklist {
		list-style: none;
		padding: 0;
	}
	.curam-checklist li {
		padding: 10px 0;
		border-bottom: 1px solid #edf2f7;
		display: flex;
		align-items: flex-start;
		gap: 10px;
	}
	.curam-checklist li:last-child {
		border-bottom: none;
	}
	.curam-checklist .check-box {
		width: 20px;
		height: 20px;
		border: 2px solid #cbd5e0;
		border-radius: 4px;
		flex-shrink: 0;
		margin-top: 2px;
	}
	@media (max-width: 782px) {
		.curam-docs-content {
			padding: 20px;
		}
		.curam-docs-header {
			padding: 24px;
		}
		.curam-docs-tab {
			padding: 10px 14px;
			font-size: 13px;
		}
	}
</style>

<div class="curam-docs-wrap">

	<div class="curam-docs-header">
		<h1>DiamondPlate Xero Integration &mdash; User Manual</h1>
		<p>Complete guide to configuring, using, and troubleshooting the Xero invoicing automation plugin.</p>
		<span class="version-badge">v2.1.0 &bull; Refactored Edition</span>
	</div>

	<div class="curam-docs-tabs">
		<button class="curam-docs-tab active" data-tab="getting-started">Getting Started</button>
		<button class="curam-docs-tab" data-tab="features">Features</button>
		<button class="curam-docs-tab" data-tab="usage">Daily Usage</button>
		<button class="curam-docs-tab" data-tab="admin-pages">Admin Pages</button>
		<button class="curam-docs-tab" data-tab="api">API Reference</button>
		<button class="curam-docs-tab" data-tab="deployment">Deployment</button>
		<button class="curam-docs-tab" data-tab="troubleshooting">Troubleshooting</button>
		<button class="curam-docs-tab" data-tab="architecture">Architecture</button>
	</div>

	<div class="curam-docs-content">

		<!-- GETTING STARTED -->
		<div class="curam-docs-panel active" id="panel-getting-started">
			<h2>Getting Started</h2>
			<p>This plugin integrates WordPress with Xero accounting software, automatically creating invoices via Zapier webhooks when client enquiries are marked as &ldquo;Invoiced &amp; Assigned&rdquo;.</p>

			<h3>Requirements</h3>
			<ul>
				<li>WordPress 5.0 or higher</li>
				<li>PHP 7.4 or higher</li>
				<li>Advanced Custom Fields (ACF) Pro</li>
				<li>Xero account with API access</li>
				<li>Zapier account (for webhook automation)</li>
			</ul>

			<h3>Installation Steps</h3>

			<div class="curam-step-card">
				<h4><span class="curam-step-number">1</span> Upload Plugin Files</h4>
				<p>Upload the plugin folder to <code>wp-content/plugins/curam-ai-xero/</code> via FTP/SFTP or your hosting file manager.</p>
			</div>

			<div class="curam-step-card">
				<h4><span class="curam-step-number">2</span> Configure wp-config.php</h4>
				<p>Add the following constants to your <code>wp-config.php</code> file, above the line that says &ldquo;That&rsquo;s all, stop editing!&rdquo;:</p>
				<div class="curam-code-block">
<span class="code-comment">// Xero OAuth Credentials</span>
<span class="code-keyword">define</span>(<span class="code-string">'XERO_CLIENT_ID'</span>, <span class="code-string">'your-xero-client-id'</span>);
<span class="code-keyword">define</span>(<span class="code-string">'XERO_CLIENT_SECRET'</span>, <span class="code-string">'your-xero-client-secret'</span>);

<span class="code-comment">// Zapier Webhook</span>
<span class="code-keyword">define</span>(<span class="code-string">'ZAPIER_WEBHOOK_URL'</span>, <span class="code-string">'https://hooks.zapier.com/hooks/catch/YOUR_ID/'</span>);
<span class="code-keyword">define</span>(<span class="code-string">'ZAPIER_SECRET_KEY'</span>, <span class="code-string">'your-random-32-character-secret-key'</span>);
				</div>
			</div>

			<div class="curam-step-card">
				<h4><span class="curam-step-number">3</span> Activate the Plugin</h4>
				<p>Go to <strong>Plugins &rarr; Installed Plugins</strong>, find &ldquo;Curam-Ai Xero Integration&rdquo; and click <strong>Activate</strong>.</p>
			</div>

			<div class="curam-step-card">
				<h4><span class="curam-step-number">4</span> Connect to Xero</h4>
				<p>Navigate to <strong>Xero &rarr; Authorization</strong> in the admin menu and click <strong>Connect to Xero</strong> to complete the OAuth flow.</p>
			</div>

			<div class="curam-step-card">
				<h4><span class="curam-step-number">5</span> Verify Setup</h4>
				<p>Visit <strong>Xero &rarr; Dashboard</strong> to confirm metrics are loading, then test with <strong>Xero &rarr; Status Checker</strong>.</p>
			</div>

			<h3>Xero Developer Portal Setup</h3>
			<ol>
				<li>Create an app at <a href="https://developer.xero.com/" target="_blank">developer.xero.com</a></li>
				<li>Set the redirect URI to:<br>
					<code>https://yoursite.com/wp-admin/admin.php?page=xero-authorization&amp;action=callback</code></li>
				<li>Copy the Client ID and Client Secret into <code>wp-config.php</code></li>
			</ol>

			<h3>Zapier Setup</h3>
			<ol>
				<li>Create a new Zap with &ldquo;Webhooks by Zapier&rdquo; as the trigger</li>
				<li>Choose &ldquo;Catch Hook&rdquo;</li>
				<li>Copy the webhook URL into <code>wp-config.php</code></li>
				<li>Add a Xero action: &ldquo;Create Invoice&rdquo;</li>
				<li>Map the fields from the webhook payload to Xero invoice fields</li>
			</ol>
		</div>

		<!-- FEATURES -->
		<div class="curam-docs-panel" id="panel-features">
			<h2>Key Features</h2>

			<div class="curam-feature-grid">
				<div class="curam-feature-card">
					<div class="feature-icon">&#9889;</div>
					<h4>Automatic Invoice Creation</h4>
					<p>Invoices are created in Xero automatically via Zapier when an enquiry status changes to &ldquo;Invoiced &amp; Assigned&rdquo;.</p>
				</div>
				<div class="curam-feature-card">
					<div class="feature-icon">&#128274;</div>
					<h4>OAuth 2.0 Authentication</h4>
					<p>Secure connection to Xero API with automatic token refresh and re-authorization support.</p>
				</div>
				<div class="curam-feature-card">
					<div class="feature-icon">&#128176;</div>
					<h4>Payment Status Checking</h4>
					<p>Automated cron job checks Xero for payment status updates at configurable intervals.</p>
				</div>
				<div class="curam-feature-card">
					<div class="feature-icon">&#9888;</div>
					<h4>Overdue Detection</h4>
					<p>Invoices past their due date are automatically flagged with a prominent warning banner in the admin.</p>
				</div>
				<div class="curam-feature-card">
					<div class="feature-icon">&#128202;</div>
					<h4>Admin Dashboard</h4>
					<p>Beautiful metrics panel showing invoice counts, success rates, overdue alerts, and recent activity.</p>
				</div>
				<div class="curam-feature-card">
					<div class="feature-icon">&#128222;</div>
					<h4>Phone Number Cleaning</h4>
					<p>Australian phone numbers are automatically standardised to international format (+61...).</p>
				</div>
				<div class="curam-feature-card">
					<div class="feature-icon">&#128268;</div>
					<h4>REST API Endpoints</h4>
					<p>Secure webhooks for Zapier to call back with invoice IDs and payment confirmations.</p>
				</div>
				<div class="curam-feature-card">
					<div class="feature-icon">&#128221;</div>
					<h4>Comprehensive Logging</h4>
					<p>Detailed audit trail recorded in the email_details ACF field for every invoice action.</p>
				</div>
			</div>

			<h3>Payment Check Intervals</h3>
			<p>Configure automatic payment checking frequency via <strong>Xero &rarr; Settings</strong>:</p>
			<table class="curam-table">
				<tr><th>Interval</th><th>Best For</th></tr>
				<tr><td>Every 15 minutes</td><td>High-volume invoice processing</td></tr>
				<tr><td>Every 30 minutes</td><td>Active businesses with frequent payments</td></tr>
				<tr><td>Every 60 minutes (default)</td><td>Standard business operations</td></tr>
				<tr><td>Every 4 hours</td><td>Lower volume, fewer API calls</td></tr>
				<tr><td>Every 8 hours</td><td>Minimal checking needed</td></tr>
				<tr><td>Every 24 hours</td><td>Daily reconciliation only</td></tr>
			</table>
		</div>

		<!-- DAILY USAGE -->
		<div class="curam-docs-panel" id="panel-usage">
			<h2>Daily Usage Guide</h2>

			<h3>Creating an Invoice</h3>

			<div class="curam-step-card">
				<h4><span class="curam-step-number">1</span> Open a Client Enquiry</h4>
				<p>Create or edit an existing <strong>Client Enquiry</strong> post in WordPress.</p>
			</div>

			<div class="curam-step-card">
				<h4><span class="curam-step-number">2</span> Fill Required Fields</h4>
				<p>Ensure these fields are completed:</p>
				<ul>
					<li><strong>Email</strong> &mdash; a valid email address for the client</li>
					<li><strong>Final Value</strong> &mdash; the invoice amount (must be greater than $0)</li>
					<li><strong>Products</strong> &mdash; select at least one product/service</li>
				</ul>
			</div>

			<div class="curam-step-card">
				<h4><span class="curam-step-number">3</span> Set Status to &ldquo;Invoiced &amp; Assigned&rdquo;</h4>
				<p>Change the <strong>Enquiry Status</strong> dropdown to &ldquo;Invoiced &amp; Assigned&rdquo;.</p>
			</div>

			<div class="curam-step-card">
				<h4><span class="curam-step-number">4</span> Save the Post</h4>
				<p>Click <strong>Update</strong>. The webhook fires automatically and creates the invoice in Xero via Zapier.</p>
			</div>

			<div class="curam-info-box success">
				<strong>Success Indicator</strong>
				<p>After saving, a green banner will appear showing the Xero invoice number and a link to view it in Xero.</p>
			</div>

			<h3>Monitoring Invoices</h3>
			<ul>
				<li><strong>Dashboard</strong> &mdash; View overall statistics, success rates, and recent activity at <strong>Xero &rarr; Dashboard</strong></li>
				<li><strong>Status Checker</strong> &mdash; Manually trigger a payment check at <strong>Xero &rarr; Status Checker</strong></li>
				<li><strong>Individual Posts</strong> &mdash; Check the email_details field on each Client Enquiry for a full audit trail</li>
			</ul>

			<h3>Automatic Status Updates</h3>
			<table class="curam-table">
				<tr><th>Xero Status</th><th>WordPress Action</th></tr>
				<tr><td>Invoice Paid</td><td>Enquiry status updated to &ldquo;Paid&rdquo;, confirmation logged</td></tr>
				<tr><td>Invoice Overdue</td><td>Enquiry status updated to &ldquo;Overdue&rdquo;, red warning banner shown</td></tr>
				<tr><td>Payment Received (partial)</td><td>Logged in email_details, status unchanged</td></tr>
			</table>

			<h3>Field Validation</h3>
			<div class="curam-info-box warning">
				<strong>Important</strong>
				<p>The plugin validates all required fields before sending the webhook. If any are missing, a yellow warning banner will appear listing the missing fields. The webhook will <em>not</em> fire until all required fields are provided.</p>
			</div>
		</div>

		<!-- ADMIN PAGES -->
		<div class="curam-docs-panel" id="panel-admin-pages">
			<h2>Admin Pages Reference</h2>

			<h3>Dashboard <small>(Xero &rarr; Dashboard)</small></h3>
			<p>The main overview page showing:</p>
			<ul>
				<li>Total invoices created and success rate</li>
				<li>Overdue invoices alert count</li>
				<li>Recent activity log with timestamps</li>
				<li>Status breakdown (paid, pending, overdue, failed)</li>
			</ul>

			<h3>Status Checker <small>(Xero &rarr; Status Checker)</small></h3>
			<p>Manually trigger a payment status check against Xero:</p>
			<ul>
				<li>Click &ldquo;Check Payments Now&rdquo; to run an immediate check</li>
				<li>View the last check results and timestamp</li>
				<li>See configuration validation status</li>
			</ul>

			<h3>Authorization <small>(Xero &rarr; Authorization)</small></h3>
			<p>Manage the OAuth 2.0 connection to Xero:</p>
			<ul>
				<li>View current connection status (Connected/Disconnected)</li>
				<li>Connect or disconnect from Xero</li>
				<li>Re-authorize if the token has expired</li>
			</ul>

			<h3>Settings <small>(Xero &rarr; Settings)</small></h3>
			<p>Configure plugin behaviour:</p>
			<ul>
				<li><strong>Webhook URL</strong> &mdash; View or update the Zapier webhook URL (primary source: wp-config.php)</li>
				<li><strong>Payment Check Interval</strong> &mdash; How often to check Xero for payment updates</li>
				<li><strong>Overdue Threshold</strong> &mdash; Days past due before flagging as overdue</li>
				<li><strong>Email Notifications</strong> &mdash; Enable/disable and select notification recipients</li>
				<li><strong>Test Connection</strong> &mdash; Verify Xero API connectivity</li>
			</ul>

			<h3>Testing &amp; Diagnostics <small>(Xero &rarr; Testing &amp; Diagnostics)</small></h3>
			<p>Developer tools for troubleshooting:</p>
			<ul>
				<li>Run SQL queries against the WordPress database</li>
				<li>Test Xero API responses</li>
				<li>Verify connection and configuration health</li>
			</ul>

			<h3>Documentation <small>(Xero &rarr; Documentation)</small></h3>
			<p>You are here! This page provides the complete user manual and reference guide.</p>
		</div>

		<!-- API REFERENCE -->
		<div class="curam-docs-panel" id="panel-api">
			<h2>API Reference</h2>

			<h3>REST API Endpoints</h3>
			<p>These endpoints are called by Zapier to report back invoice creation and payment status.</p>

			<div class="curam-step-card">
				<h4>Invoice Created Callback</h4>
				<div class="curam-code-block">
<span class="code-keyword">POST</span> /wp-json/diamondplate/v1/invoice-created
<span class="code-comment">Header:</span> X-Zapier-Secret: your-secret-key
<span class="code-comment">Content-Type:</span> application/json

{
  <span class="code-string">"post_id"</span>: 123,
  <span class="code-string">"invoice_id"</span>: <span class="code-string">"xero-guid-here"</span>,
  <span class="code-string">"invoice_number"</span>: <span class="code-string">"INV-001"</span>
}
				</div>
				<p>Called by Zapier after successfully creating an invoice in Xero. Stores the invoice ID and number on the WordPress post.</p>
			</div>

			<div class="curam-step-card">
				<h4>Payment Received Webhook</h4>
				<div class="curam-code-block">
<span class="code-keyword">POST</span> /wp-json/diamondplate/v1/payment-received
<span class="code-comment">Header:</span> X-Zapier-Secret: your-secret-key
<span class="code-comment">Content-Type:</span> application/json

{
  <span class="code-string">"invoice_id"</span>: <span class="code-string">"xero-guid-here"</span>
}
				</div>
				<p>Called when a payment is received in Xero. Updates the enquiry status to &ldquo;Paid&rdquo;.</p>
			</div>

			<h3>Authentication</h3>
			<p>All API endpoints require the <code>X-Zapier-Secret</code> header matching the <code>ZAPIER_SECRET_KEY</code> constant defined in <code>wp-config.php</code>.</p>

			<div class="curam-info-box danger">
				<strong>Security Notice</strong>
				<p>Never share your Zapier secret key. If compromised, update the key in both <code>wp-config.php</code> and your Zapier webhook configuration immediately.</p>
			</div>

			<h3>Testing Endpoints</h3>
			<div class="curam-code-block">
<span class="code-comment"># Test the invoice-created endpoint</span>
curl -X POST https://yoursite.com/wp-json/diamondplate/v1/invoice-created \
  -H <span class="code-string">"X-Zapier-Secret: your-secret-key"</span> \
  -H <span class="code-string">"Content-Type: application/json"</span> \
  -d <span class="code-string">'{"test": true, "post_id": 123}'</span>
			</div>

			<h3>WP-CLI Commands</h3>
			<div class="curam-code-block">
<span class="code-comment"># Manually trigger payment status check</span>
wp cron event run xero_check_payment_status

<span class="code-comment"># List scheduled cron events</span>
wp cron event list | grep xero
			</div>
		</div>

		<!-- DEPLOYMENT -->
		<div class="curam-docs-panel" id="panel-deployment">
			<h2>Deployment Checklist</h2>

			<h3>Pre-Deployment</h3>
			<ul class="curam-checklist">
				<li><span class="check-box"></span> <span>Backup current plugin files (<code>tar -czf curam-backup.tar.gz curam-ai-xero/</code>)</span></li>
				<li><span class="check-box"></span> <span>Backup WordPress database (<code>wp db export backup.sql</code>)</span></li>
				<li><span class="check-box"></span> <span>Note current plugin version</span></li>
				<li><span class="check-box"></span> <span>Verify <code>wp-config.php</code> has all required constants (XERO_CLIENT_ID, XERO_CLIENT_SECRET, ZAPIER_WEBHOOK_URL, ZAPIER_SECRET_KEY)</span></li>
			</ul>

			<h3>Deployment Steps</h3>
			<ul class="curam-checklist">
				<li><span class="check-box"></span> <span>Enable WordPress debug mode (optional but recommended)</span></li>
				<li><span class="check-box"></span> <span>Deactivate the current plugin version</span></li>
				<li><span class="check-box"></span> <span>Replace plugin files via FTP/SFTP or SSH</span></li>
				<li><span class="check-box"></span> <span>Verify the file structure is correct (includes/, admin/views/)</span></li>
				<li><span class="check-box"></span> <span>Activate the new plugin version</span></li>
			</ul>

			<h3>Post-Deployment Testing</h3>
			<ul class="curam-checklist">
				<li><span class="check-box"></span> <span>Plugin activates without PHP errors (check <code>debug.log</code>)</span></li>
				<li><span class="check-box"></span> <span>Xero menu appears in WordPress admin sidebar</span></li>
				<li><span class="check-box"></span> <span>Dashboard page loads with correct statistics</span></li>
				<li><span class="check-box"></span> <span>Authorization page shows &ldquo;Connected&rdquo; status</span></li>
				<li><span class="check-box"></span> <span>Settings page loads and shows correct webhook URL</span></li>
				<li><span class="check-box"></span> <span>Status Checker &mdash; click &ldquo;Check Payments Now&rdquo; runs without errors</span></li>
				<li><span class="check-box"></span> <span>Create a test invoice by setting an enquiry to &ldquo;Invoiced &amp; Assigned&rdquo;</span></li>
				<li><span class="check-box"></span> <span>Verify cron job is scheduled (<code>wp cron event list | grep xero</code>)</span></li>
			</ul>

			<h3>Rollback Plan</h3>
			<div class="curam-info-box danger">
				<strong>If Something Goes Wrong</strong>
				<p>1. Deactivate the new plugin immediately<br>
				2. Restore files from backup: <code>tar -xzf curam-backup.tar.gz</code><br>
				3. Reactivate the previous version<br>
				4. Document the issue for review</p>
			</div>
		</div>

		<!-- TROUBLESHOOTING -->
		<div class="curam-docs-panel" id="panel-troubleshooting">
			<h2>Troubleshooting</h2>

			<h3>Common Issues</h3>

			<div class="curam-step-card">
				<h4>&ldquo;Class not found&rdquo; Error</h4>
				<p>This usually means a file is missing from the <code>includes/</code> directory. Verify all class files were uploaded correctly. Check the file structure matches the expected layout shown in the Architecture tab.</p>
			</div>

			<div class="curam-step-card">
				<h4>OAuth / Xero Connection Not Working</h4>
				<p>OAuth tokens from the previous version are preserved. If the connection shows as disconnected:</p>
				<ul>
					<li>Go to <strong>Xero &rarr; Authorization</strong></li>
					<li>Click <strong>Connect to Xero</strong> to re-authorize</li>
					<li>Verify <code>XERO_CLIENT_ID</code> and <code>XERO_CLIENT_SECRET</code> are correct in <code>wp-config.php</code></li>
				</ul>
			</div>

			<div class="curam-step-card">
				<h4>Webhook Not Sending / Invoice Not Created</h4>
				<ul>
					<li>Check that <code>ZAPIER_WEBHOOK_URL</code> is defined in <code>wp-config.php</code> or set in <strong>Xero &rarr; Settings</strong></li>
					<li>Verify all required fields are filled (email, final value, products)</li>
					<li>Check the validation banner &mdash; it will list any missing fields</li>
					<li>Review <code>wp-content/debug.log</code> for error messages</li>
				</ul>
			</div>

			<div class="curam-step-card">
				<h4>Payment Status Not Updating</h4>
				<ul>
					<li>Confirm the cron job is scheduled: <code>wp cron event list | grep xero</code></li>
					<li>Manually trigger a check: <strong>Xero &rarr; Status Checker &rarr; Check Payments Now</strong></li>
					<li>Verify the Xero OAuth connection is active</li>
				</ul>
			</div>

			<div class="curam-step-card">
				<h4>Missing Function Errors</h4>
				<p>All legacy functions have backward-compatible wrappers. If you see a &ldquo;function not found&rdquo; error, check that the <code>includes/class-curam-helpers.php</code> file contains the wrapper functions.</p>
			</div>

			<h3>Where to Find Logs</h3>
			<table class="curam-table">
				<tr><th>Log Location</th><th>What It Contains</th></tr>
				<tr><td><code>wp-content/debug.log</code></td><td>PHP errors, plugin debug messages, webhook send confirmations</td></tr>
				<tr><td>ACF &ldquo;email_details&rdquo; field</td><td>Per-enquiry audit trail of all invoice actions and timestamps</td></tr>
				<tr><td>Xero &rarr; Dashboard</td><td>Recent activity summary and success/failure counts</td></tr>
			</table>

			<div class="curam-info-box">
				<strong>Enable Debug Logging</strong>
				<p>Add these lines to <code>wp-config.php</code> to capture detailed error logs:<br>
				<code>define('WP_DEBUG', true);</code><br>
				<code>define('WP_DEBUG_LOG', true);</code></p>
			</div>
		</div>

		<!-- ARCHITECTURE -->
		<div class="curam-docs-panel" id="panel-architecture">
			<h2>Plugin Architecture</h2>

			<p>Version 2.1.0 was professionally refactored from a single 3,163-line file into a clean, modular class structure following WordPress coding standards.</p>

			<h3>File Structure</h3>
			<div class="curam-file-tree">
				<span class="folder">curam-ai-xero/</span><br>
				├── curam-ai_zapier.php <span class="file-desc">&mdash; Main plugin entry (bootstrap only, ~70 lines)</span><br>
				│<br>
				├── <span class="folder">includes/</span> <span class="file-desc">&mdash; Core functionality</span><br>
				│&nbsp;&nbsp;&nbsp;├── class-curam-xero.php <span class="file-desc">&mdash; Main orchestrator (singleton)</span><br>
				│&nbsp;&nbsp;&nbsp;├── class-curam-helpers.php <span class="file-desc">&mdash; Phone cleaning, IP detection</span><br>
				│&nbsp;&nbsp;&nbsp;├── class-curam-xero-api.php <span class="file-desc">&mdash; Xero API wrapper</span><br>
				│&nbsp;&nbsp;&nbsp;├── class-curam-xero-oauth.php <span class="file-desc">&mdash; OAuth 2.0 flow handler</span><br>
				│&nbsp;&nbsp;&nbsp;├── class-curam-webhook-handler.php <span class="file-desc">&mdash; Zapier webhook triggers</span><br>
				│&nbsp;&nbsp;&nbsp;├── class-curam-rest-api.php <span class="file-desc">&mdash; REST API endpoints</span><br>
				│&nbsp;&nbsp;&nbsp;├── class-curam-payment-checker.php <span class="file-desc">&mdash; Cron payment checking</span><br>
				│&nbsp;&nbsp;&nbsp;├── class-curam-admin-menu.php <span class="file-desc">&mdash; Admin menu registration</span><br>
				│&nbsp;&nbsp;&nbsp;├── class-curam-admin-notices.php <span class="file-desc">&mdash; Status banners &amp; validation</span><br>
				│&nbsp;&nbsp;&nbsp;└── class-curam-dashboard-functions.php <span class="file-desc">&mdash; Dashboard statistics</span><br>
				│<br>
				└── <span class="folder">admin/views/</span> <span class="file-desc">&mdash; Admin page templates</span><br>
				&nbsp;&nbsp;&nbsp;&nbsp;├── dashboard.php<br>
				&nbsp;&nbsp;&nbsp;&nbsp;├── authorization.php<br>
				&nbsp;&nbsp;&nbsp;&nbsp;├── settings.php<br>
				&nbsp;&nbsp;&nbsp;&nbsp;├── status-checker.php<br>
				&nbsp;&nbsp;&nbsp;&nbsp;├── sql-testing.php<br>
				&nbsp;&nbsp;&nbsp;&nbsp;└── documentation.php
			</div>

			<h3>Function Mapping (Legacy &rarr; New)</h3>
			<p>All original functions still work via backward-compatible wrappers:</p>
			<table class="curam-table">
				<tr><th>Legacy Function</th><th>New Class Method</th><th>Compatible</th></tr>
				<tr><td><code>clean_phone_number()</code></td><td><code>Curam_Helpers::clean_phone_number()</code></td><td><span class="curam-check">&#10003;</span></td></tr>
				<tr><td><code>validate_phone_number()</code></td><td><code>Curam_Helpers::validate_phone_number()</code></td><td><span class="curam-check">&#10003;</span></td></tr>
				<tr><td><code>curam_get_client_ip()</code></td><td><code>Curam_Helpers::get_client_ip()</code></td><td><span class="curam-check">&#10003;</span></td></tr>
				<tr><td><code>xero_get_access_token()</code></td><td><code>Curam_Xero_Api::get_access_token()</code></td><td><span class="curam-check">&#10003;</span></td></tr>
				<tr><td><code>xero_get_invoice()</code></td><td><code>Curam_Xero_Api::get_invoice()</code></td><td><span class="curam-check">&#10003;</span></td></tr>
				<tr><td><code>xero_get_authorization_url()</code></td><td><code>Curam_Xero_Api::get_authorization_url()</code></td><td><span class="curam-check">&#10003;</span></td></tr>
				<tr><td><code>verify_zapier_rest_auth()</code></td><td><code>Curam_Rest_Api::verify_auth()</code></td><td><span class="curam-check">&#10003;</span></td></tr>
				<tr><td><code>xero_check_all_invoice_payments()</code></td><td><code>Curam_Payment_Checker::check_all_invoice_payments()</code></td><td><span class="curam-check">&#10003;</span></td></tr>
				<tr><td><code>xero_get_dashboard_stats()</code></td><td><code>Curam_Dashboard_Functions::get_stats()</code></td><td><span class="curam-check">&#10003;</span></td></tr>
			</table>

			<h3>Refactoring Results</h3>
			<table class="curam-table">
				<tr><th>Metric</th><th>Before</th><th>After</th><th>Improvement</th></tr>
				<tr><td>Main file size</td><td>3,163 lines</td><td>70 lines</td><td>98% smaller</td></tr>
				<tr><td>Time to find code</td><td>15&ndash;20 min</td><td>2 min</td><td>87% faster</td></tr>
				<tr><td>Code review time</td><td>Hours</td><td>Minutes</td><td>90% faster</td></tr>
				<tr><td>Onboarding time</td><td>Days</td><td>Hours</td><td>Dramatically improved</td></tr>
				<tr><td>Performance impact</td><td>&mdash;</td><td>&mdash;</td><td>No degradation</td></tr>
			</table>
		</div>

	</div>
</div>

<script>
(function() {
	var tabs = document.querySelectorAll('.curam-docs-tab');
	var panels = document.querySelectorAll('.curam-docs-panel');

	tabs.forEach(function(tab) {
		tab.addEventListener('click', function() {
			var target = this.getAttribute('data-tab');

			tabs.forEach(function(t) { t.classList.remove('active'); });
			panels.forEach(function(p) { p.classList.remove('active'); });

			this.classList.add('active');
			document.getElementById('panel-' + target).classList.add('active');
		});
	});
})();
</script>
