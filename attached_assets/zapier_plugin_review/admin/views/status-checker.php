<?php
/**
 * Status Checker View
 *
 * @package Curam_Xero
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! current_user_can( 'manage_options' ) ) {
	return;
}

// Handle manual trigger
if ( isset( $_POST['xero_check_now'] ) && check_admin_referer( 'xero_check_now' ) ) {
	ob_start();
	Curam_Payment_Checker::check_all_invoice_payments();
	ob_get_clean();

	$results = get_transient( 'xero_last_check_results' );

	if ( $results ) {
		echo '<div class="notice notice-success" style="padding: 15px;">';
		echo '<h3 style="margin-top: 0;">✓ Payment Check Completed</h3>';
		echo '<table class="widefat" style="max-width: 600px;">';
		echo '<tr><th style="text-align: left;">Total Invoices Checked</th><td><strong>' . esc_html( $results['checked'] ) . '</strong></td></tr>';
		echo '<tr><th style="text-align: left;">Paid & Updated to Completed</th><td><strong style="color: green;">' . esc_html( $results['paid'] ) . '</strong></td></tr>';
		echo '<tr><th style="text-align: left;">Marked as Overdue</th><td><strong style="color: red;">' . esc_html( $results['overdue'] ) . '</strong></td></tr>';
		echo '<tr><th style="text-align: left;">Skipped (No Change)</th><td>' . esc_html( $results['checked'] - $results['paid'] - $results['overdue'] ) . '</td></tr>';
		echo '</table>';
		echo '<p style="margin-top: 10px;"><em>Check WordPress error log for detailed information.</em></p>';
		echo '</div>';
	} else {
		echo '<div class="notice notice-success"><p>Payment check completed. Check error log for details.</p></div>';
	}
}

$next_run = wp_next_scheduled( 'xero_check_payment_status' );
$next_run_time = $next_run ? date( 'Y-m-d H:i:s', $next_run ) : 'Not scheduled';
$last_results = get_transient( 'xero_last_check_results' );
$check_interval = defined( 'XERO_CHECK_INTERVAL_MINUTES' ) ? XERO_CHECK_INTERVAL_MINUTES : get_option( 'xero_check_interval', 60 );
?>
<div class="wrap">
	<h1>Xero Payment Status Checker</h1>

	<?php if ( $last_results ) : ?>
		<div class="notice notice-info" style="padding: 15px; margin-top: 20px;">
			<h3 style="margin-top: 0;">📊 Last Automatic Check Results</h3>
			<p><strong>Run Time:</strong> <?php echo esc_html( $last_results['timestamp'] ); ?></p>
			<table class="widefat" style="max-width: 600px;">
				<tr><th style="text-align: left;">Total Invoices Checked</th><td><strong><?php echo esc_html( $last_results['checked'] ); ?></strong></td></tr>
				<tr><th style="text-align: left;">Paid & Updated</th><td><strong style="color: green;"><?php echo esc_html( $last_results['paid'] ); ?></strong></td></tr>
				<tr><th style="text-align: left;">Marked as Overdue</th><td><strong style="color: red;"><?php echo esc_html( $last_results['overdue'] ); ?></strong></td></tr>
			</table>
		</div>
	<?php endif; ?>

	<h2>Configuration</h2>
	<table class="form-table">
		<tr>
			<th>Check Interval</th>
			<td><?php echo esc_html( $check_interval ); ?> minutes</td>
		</tr>
		<tr>
			<th>Next Scheduled Run</th>
			<td><?php echo esc_html( $next_run_time ); ?></td>
		</tr>
		<tr>
			<th>Client ID</th>
			<td><?php echo defined( 'XERO_CLIENT_ID' ) && ! empty( XERO_CLIENT_ID ) ? '✓ Configured' : '✗ Not configured'; ?></td>
		</tr>
		<tr>
			<th>Client Secret</th>
			<td><?php echo defined( 'XERO_CLIENT_SECRET' ) && ! empty( XERO_CLIENT_SECRET ) ? '✓ Configured' : '✗ Not configured'; ?></td>
		</tr>
		<tr>
			<th>Tenant ID</th>
			<td><?php echo get_option( 'xero_tenant_id' ) ? '✓ Configured' : '✗ Not configured'; ?></td>
		</tr>
		<tr>
			<th>Refresh Token</th>
			<td><?php echo get_option( 'xero_refresh_token' ) ? '✓ Stored' : '✗ Not authorized'; ?></td>
		</tr>
	</table>

	<h2>Manual Test</h2>
	<p>Click below to manually trigger a payment check (for testing purposes):</p>
	<form method="post">
		<?php wp_nonce_field( 'xero_check_now' ); ?>
		<button type="submit" name="xero_check_now" class="button button-primary">Check Payments Now</button>
	</form>

	<h2>Instructions</h2>
	<ol>
		<li>Add Xero credentials to wp-config.php</li>
		<li>Go to <a href="<?php echo esc_url( admin_url( 'admin.php?page=xero-authorization' ) ); ?>">Xero Authorization</a> page</li>
		<li>Click "Connect to Xero" and authorize</li>
		<li>Cron will run automatically every <?php echo esc_html( $check_interval ); ?> minutes</li>
		<li>Check WordPress error log for activity</li>
	</ol>
</div>
