<?php
/**
 * SQL Testing & Diagnostics View
 *
 * @package Curam_Xero
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! current_user_can( 'manage_options' ) ) {
	return;
}

global $wpdb;

$active_tab = isset( $_GET['tab'] ) ? sanitize_text_field( $_GET['tab'] ) : 'sql';

$queries = array(
	'Posts with Xero Invoice IDs' => array(
		'description' => 'Show all client enquiries that have Xero invoices',
		'sql' => "SELECT p.ID, p.post_title, p.post_status, pm.meta_value as invoice_id 
				  FROM {$wpdb->posts} p 
				  INNER JOIN {$wpdb->postmeta} pm ON p.ID = pm.post_id 
				  WHERE p.post_type = 'clientenquiry' 
				  AND pm.meta_key = 'xero_invoice_id' 
				  ORDER BY p.ID DESC 
				  LIMIT 20",
	),
	'Posts without Invoices (Assigned)' => array(
		'description' => 'Client enquiries marked as assigned but no invoice created',
		'sql' => "SELECT p.ID, p.post_title, pm.meta_value as status, p.post_date 
				  FROM {$wpdb->posts} p 
				  INNER JOIN {$wpdb->postmeta} pm ON p.ID = pm.post_id AND pm.meta_key = 'enquiry_status'
				  WHERE p.post_type = 'clientenquiry' 
				  AND pm.meta_value = 'assigned'
				  AND p.ID NOT IN (SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = 'xero_invoice_id')
				  ORDER BY p.post_date DESC 
				  LIMIT 20",
	),
	'Overdue Invoices' => array(
		'description' => 'Invoices marked as overdue with warning messages',
		'sql' => "SELECT p.ID, p.post_title, pm1.meta_value as invoice_number, pm2.meta_value as warning
				  FROM {$wpdb->posts} p 
				  LEFT JOIN {$wpdb->postmeta} pm1 ON p.ID = pm1.post_id AND pm1.meta_key = 'xero_invoice_number'
				  LEFT JOIN {$wpdb->postmeta} pm2 ON p.ID = pm2.post_id AND pm2.meta_key = 'xero_invoice_overdue_warning'
				  WHERE p.post_type = 'clientenquiry' 
				  AND pm2.meta_value IS NOT NULL
				  ORDER BY p.ID DESC 
				  LIMIT 20",
	),
	'Posts by Status (Count)' => array(
		'description' => 'Count of client enquiries by enquiry status',
		'sql' => "SELECT pm.meta_value as status, COUNT(*) as count 
				  FROM {$wpdb->posts} p 
				  INNER JOIN {$wpdb->postmeta} pm ON p.ID = pm.post_id 
				  WHERE p.post_type = 'clientenquiry' 
				  AND pm.meta_key = 'enquiry_status' 
				  GROUP BY pm.meta_value 
				  ORDER BY count DESC",
	),
	'Xero Plugin Settings' => array(
		'description' => 'Show all Xero-related settings (tokens sanitized)',
		'sql' => "SELECT option_name,
				  CASE 
					  WHEN option_name LIKE '%token%' THEN CONCAT(LEFT(option_value, 10), '... [HIDDEN]')
					  WHEN option_name LIKE '%secret%' THEN '[HIDDEN]'
					  ELSE option_value 
				  END as option_value
				  FROM {$wpdb->options} 
				  WHERE option_name LIKE 'xero_%'
				  ORDER BY option_name",
	),
	'OAuth Token Status' => array(
		'description' => 'Check if tokens exist (values hidden)',
		'sql' => "SELECT option_name,
				  CASE 
					  WHEN option_value IS NULL OR option_value = '' THEN '❌ NOT SET'
					  WHEN option_name LIKE '%token%' THEN CONCAT('✓ EXISTS (', CHAR_LENGTH(option_value), ' chars)')
					  WHEN option_name = 'xero_tenant_id' THEN option_value
					  ELSE '✓ SET'
				  END as status
				  FROM {$wpdb->options}
				  WHERE option_name IN ('xero_refresh_token', 'xero_tenant_id')
				  ORDER BY option_name",
	),
);

$results = null;
$selected_query = '';
$execution_time = 0;

if ( isset( $_POST['run_query'] ) && check_admin_referer( 'xero_sql_test' ) ) {
	$selected_query = sanitize_text_field( $_POST['query_name'] );
	
	if ( isset( $queries[ $selected_query ] ) ) {
		$start_time = microtime( true );
		$results = $wpdb->get_results( $queries[ $selected_query ]['sql'], ARRAY_A );
		$execution_time = ( microtime( true ) - $start_time ) * 1000;
		
		if ( $wpdb->last_error ) {
			echo '<div class="notice notice-error"><p>SQL Error: ' . esc_html( $wpdb->last_error ) . '</p></div>';
		}
	}
}
?>
<div class="wrap">
	<h1>🔍 Testing & Diagnostics</h1>
	<p>Run SQL queries against WordPress database to diagnose Xero integration issues.</p>

	<h2 class="nav-tab-wrapper">
		<a href="?page=xero-sql-testing&tab=sql" class="nav-tab <?php echo $active_tab === 'sql' ? 'nav-tab-active' : ''; ?>">
			💾 WordPress Queries
		</a>
		<a href="?page=xero-sql-testing&tab=api" class="nav-tab <?php echo $active_tab === 'api' ? 'nav-tab-active' : ''; ?>">
			🌐 Xero API
		</a>
	</h2>

	<?php if ( $active_tab === 'sql' ) : ?>
		<div style="background: #e8f4f8; border-left: 4px solid #2271b1; padding: 15px; margin: 20px 0; border-radius: 4px;">
			<h4 style="margin-top: 0;">📊 About WordPress Queries</h4>
			<p style="margin-bottom: 0;">
				These queries examine your WordPress database to help diagnose issues with the Xero integration.
			</p>
		</div>

		<form method="post" style="margin: 20px 0;">
			<?php wp_nonce_field( 'xero_sql_test' ); ?>
			
			<table class="form-table">
				<tr>
					<th scope="row">Select Query</th>
					<td>
						<select name="query_name" class="regular-text">
							<option value="">-- Choose a test query --</option>
							<?php foreach ( $queries as $name => $query ) : ?>
								<option value="<?php echo esc_attr( $name ); ?>" <?php selected( $selected_query, $name ); ?>>
									<?php echo esc_html( $name ); ?>
								</option>
							<?php endforeach; ?>
						</select>
					</td>
				</tr>
			</table>

			<p>
				<button type="submit" name="run_query" class="button button-primary">Run Query</button>
			</p>
		</form>

		<?php if ( $selected_query && isset( $queries[ $selected_query ] ) ) : ?>
			<div style="background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; padding: 15px; margin: 20px 0;">
				<h3 style="margin-top: 0;">SQL Query:</h3>
				<pre style="background: #fff; padding: 15px; overflow-x: auto; border: 1px solid #ddd; border-radius: 4px;"><?php echo esc_html( $queries[ $selected_query ]['sql'] ); ?></pre>
			</div>
		<?php endif; ?>

		<?php if ( $results !== null ) : ?>
			<div style="background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; padding: 15px; margin: 20px 0;">
				<h3 style="margin-top: 0;">
					Results 
					<span style="font-weight: normal; color: #666; font-size: 14px;">
						(<?php echo count( $results ); ?> rows in <?php echo number_format( $execution_time, 2 ); ?>ms)
					</span>
				</h3>

				<?php if ( empty( $results ) ) : ?>
					<p style="color: #666; font-style: italic;">No results found.</p>
				<?php else : ?>
					<div style="overflow-x: auto;">
						<table class="wp-list-table widefat fixed striped" style="background: white;">
							<thead>
								<tr>
									<?php foreach ( array_keys( $results[0] ) as $column ) : ?>
										<th style="padding: 10px;"><?php echo esc_html( $column ); ?></th>
									<?php endforeach; ?>
								</tr>
							</thead>
							<tbody>
								<?php foreach ( $results as $row ) : ?>
									<tr>
										<?php foreach ( $row as $value ) : ?>
											<td style="padding: 10px;">
												<?php 
												$display_value = is_string( $value ) && strlen( $value ) > 100 
													? substr( $value, 0, 100 ) . '...' 
													: $value;
												echo esc_html( $display_value ); 
												?>
											</td>
										<?php endforeach; ?>
									</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					</div>
				<?php endif; ?>
			</div>
		<?php endif; ?>

	<?php elseif ( $active_tab === 'api' ) : ?>
		<div style="background: #e8f4f8; border-left: 4px solid #2271b1; padding: 15px; margin: 20px 0; border-radius: 4px;">
			<h4 style="margin-top: 0;">🌐 Xero API Testing</h4>
			<p style="margin-bottom: 0;">
				Test your Xero API connection and query live data from Xero.
			</p>
		</div>

		<?php
		$access_token = Curam_Xero_Api::get_access_token();
		$tenant_id = get_option( 'xero_tenant_id' );
		
		if ( ! $access_token || ! $tenant_id ) {
			echo '<div class="notice notice-error"><p>❌ Not authorized. Please <a href="' . esc_url( admin_url( 'admin.php?page=xero-authorization' ) ) . '">connect to Xero</a> first.</p></div>';
		} else {
			echo '<div class="notice notice-success"><p>✓ Connected to Xero. Ready to run API queries.</p></div>';
			
			echo '<form method="post">';
			wp_nonce_field( 'xero_api_test' );
			echo '<p><strong>API Query:</strong></p>';
			echo '<select name="api_query_name" class="regular-text">';
			echo '<option value="Recent Invoices">Recent Invoices (Last 10)</option>';
			echo '<option value="Unpaid Invoices">Unpaid Invoices</option>';
			echo '<option value="Organization Info">Organization Info</option>';
			echo '</select>';
			echo '<p><button type="submit" name="run_api_query" class="button button-primary">Run API Query</button></p>';
			echo '</form>';
		}
		?>
	<?php endif; ?>
</div>
