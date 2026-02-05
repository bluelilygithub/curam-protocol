<?php
/**
 * Settings View
 *
 * @package Curam_Xero
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! current_user_can( 'manage_options' ) ) {
	return;
}

// Handle test buttons
if ( isset( $_POST['test_xero_connection'] ) && check_admin_referer( 'xero_test_action' ) ) {
	delete_transient( 'xero_connection_status' );
	delete_transient( 'xero_access_token' );
	
	$access_token = Curam_Xero_Api::get_access_token();
	if ( $access_token ) {
		set_transient( 'xero_connection_status', 'connected', 5 * MINUTE_IN_SECONDS );
		echo '<div class="notice notice-success"><p>✓ Xero connection successful! Access token retrieved.</p></div>';
	} else {
		set_transient( 'xero_connection_status', 'error', 5 * MINUTE_IN_SECONDS );
		echo '<div class="notice notice-error"><p>✗ Xero connection failed. Check authorization and credentials.</p></div>';
	}
}

if ( isset( $_POST['test_zapier_webhook'] ) && check_admin_referer( 'xero_test_action' ) ) {
	$webhook_url = get_option( 'xero_zapier_webhook_url', defined( 'ZAPIER_WEBHOOK_URL' ) ? ZAPIER_WEBHOOK_URL : '' );
	
	if ( empty( $webhook_url ) ) {
		echo '<div class="notice notice-error"><p>✗ No webhook URL configured.</p></div>';
	} else {
		$test_payload = array(
			'test'    => true,
			'post_id' => 0,
			'message' => 'Test webhook from WordPress at ' . current_time( 'mysql' ),
		);
		
		$response = wp_remote_post(
			$webhook_url,
			array(
				'method'   => 'POST',
				'headers'  => array( 'Content-Type' => 'application/json' ),
				'body'     => wp_json_encode( $test_payload ),
				'timeout'  => 30,
				'blocking' => true,
			)
		);
		
		if ( is_wp_error( $response ) ) {
			echo '<div class="notice notice-error"><p>✗ Webhook test failed: ' . esc_html( $response->get_error_message() ) . '</p></div>';
		} else {
			$response_code = wp_remote_retrieve_response_code( $response );
			if ( $response_code === 200 ) {
				echo '<div class="notice notice-success"><p>✓ Webhook test successful! Zapier received the test data.</p></div>';
			} else {
				echo '<div class="notice notice-error"><p>✗ Webhook responded with code: ' . esc_html( $response_code ) . '</p></div>';
			}
		}
	}
}

// Handle form submission
if ( isset( $_POST['save_xero_settings'] ) && check_admin_referer( 'xero_settings_action' ) ) {
	$old_interval = get_option( 'xero_check_interval', 60 );
	$new_interval = intval( $_POST['check_interval'] );

	update_option( 'xero_overdue_days', intval( $_POST['overdue_days'] ) );
	update_option( 'xero_batch_limit', intval( $_POST['batch_limit'] ) );
	update_option( 'xero_check_interval', $new_interval );
	update_option( 'xero_testing_mode', isset( $_POST['testing_mode'] ) ? '1' : '0' );

	$webhook_url = sanitize_text_field( $_POST['zapier_webhook_url'] );
	if ( ! empty( $webhook_url ) ) {
		if ( ! filter_var( $webhook_url, FILTER_VALIDATE_URL ) ) {
			echo '<div class="notice notice-error"><p>Invalid webhook URL format.</p></div>';
		} elseif ( strpos( $webhook_url, 'hooks.zapier.com' ) === false ) {
			echo '<div class="notice notice-error"><p>Webhook URL must be a Zapier webhook (hooks.zapier.com).</p></div>';
		} else {
			update_option( 'xero_zapier_webhook_url', $webhook_url );
		}
	} else {
		delete_option( 'xero_zapier_webhook_url' );
	}

	$selected_users = isset( $_POST['notification_users'] ) && is_array( $_POST['notification_users'] )
		? array_map( 'intval', $_POST['notification_users'] )
		: array();
	update_option( 'xero_notification_users', $selected_users );
	update_option( 'xero_send_email_reports', isset( $_POST['send_email_reports'] ) ? '1' : '0' );

	if ( $old_interval !== $new_interval ) {
		wp_clear_scheduled_hook( 'xero_check_payment_status' );
		wp_schedule_event( time(), 'xero_custom_interval', 'xero_check_payment_status' );
	}

	echo '<div class="notice notice-success"><p>Settings saved and Cron rescheduled.</p></div>';
}

$last_check = get_transient( 'xero_last_check_results' );
$xero_connected = get_transient( 'xero_connection_status' ) === 'connected';
$webhook_url = get_option( 'xero_zapier_webhook_url', defined( 'ZAPIER_WEBHOOK_URL' ) ? ZAPIER_WEBHOOK_URL : '' );
$webhook_ok = ! empty( $webhook_url ) && strpos( $webhook_url, 'hooks.zapier.com' ) !== false;
?>
<div class="wrap">
	<h1>Xero Configuration</h1>

	<div style="background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; padding: 20px; margin: 20px 0;">
		<h2 style="margin-top: 0;">📊 System Health Dashboard</h2>
		<table class="form-table" style="background: white; padding: 15px; border-radius: 4px;">
			<tr>
				<th style="width: 200px;">Xero Connection</th>
				<td>
					<?php if ( $xero_connected ) : ?>
						<span style="color: #46b450; font-weight: bold;">✓ Connected</span>
					<?php else : ?>
						<span style="color: #dc3232; font-weight: bold;">✗ Not Connected</span>
					<?php endif; ?>
				</td>
			</tr>
			<tr>
				<th>Zapier Webhook</th>
				<td>
					<?php if ( $webhook_ok ) : ?>
						<span style="color: #46b450; font-weight: bold;">✓ Configured</span>
						<br><small style="color: #666;"><?php echo esc_html( substr( $webhook_url, 0, 50 ) . '...' ); ?></small>
					<?php else : ?>
						<span style="color: #dc3232; font-weight: bold;">✗ Not Configured</span>
					<?php endif; ?>
				</td>
			</tr>
			<?php if ( $last_check ) : ?>
			<tr>
				<th>Last Payment Check</th>
				<td>
					<strong><?php echo esc_html( $last_check['timestamp'] ); ?></strong>
					<br>Checked: <?php echo esc_html( $last_check['checked'] ); ?> | 
					Paid: <span style="color: #46b450;"><?php echo esc_html( $last_check['paid'] ); ?></span> | 
					Overdue: <span style="color: #dc3232;"><?php echo esc_html( $last_check['overdue'] ); ?></span>
				</td>
			</tr>
			<?php endif; ?>
			<tr>
				<th>Next Scheduled Check</th>
				<td>
					<?php 
					$next_run = wp_next_scheduled( 'xero_check_payment_status' );
					echo $next_run ? esc_html( date( 'Y-m-d H:i:s', $next_run ) ) : 'Not scheduled'; 
					?>
				</td>
			</tr>
		</table>

		<div style="margin-top: 20px; padding: 15px; background: white; border-radius: 4px;">
			<h3 style="margin-top: 0;">🧪 Connection Tests</h3>
			<form method="post" style="display: inline-block; margin-right: 10px;">
				<?php wp_nonce_field( 'xero_test_action' ); ?>
				<button type="submit" name="test_xero_connection" class="button">Test Xero Connection</button>
			</form>
			<form method="post" style="display: inline-block; margin-right: 10px;">
				<?php wp_nonce_field( 'xero_test_action' ); ?>
				<button type="submit" name="test_zapier_webhook" class="button">Test Zapier Webhook</button>
			</form>
			<p class="description">Click to verify connections are working properly.</p>
		</div>
	</div>

	<form method="post">
		<?php wp_nonce_field( 'xero_settings_action' ); ?>
		
		<h2>Webhook Configuration</h2>
		<table class="form-table">
			<tr>
				<th scope="row">Zapier Webhook URL</th>
				<td>
					<input type="url" name="zapier_webhook_url" value="<?php echo esc_attr( get_option( 'xero_zapier_webhook_url', '' ) ); ?>" class="regular-text" placeholder="https://hooks.zapier.com/hooks/catch/...">
					<p class="description">
						Enter your Zapier webhook URL. If left empty, will use ZAPIER_WEBHOOK_URL from wp-config.php.
						<?php if ( defined( 'ZAPIER_WEBHOOK_URL' ) ) : ?>
							<br><strong>wp-config.php value:</strong> <code><?php echo esc_html( substr( ZAPIER_WEBHOOK_URL, 0, 50 ) . '...' ); ?></code>
						<?php endif; ?>
					</p>
				</td>
			</tr>
		</table>

		<h2>Payment Checking</h2>
		<table class="form-table">
			<tr>
				<th scope="row">Testing Mode</th>
				<td>
					<input type="checkbox" name="testing_mode" value="1" <?php checked( get_option( 'xero_testing_mode' ), '1' ); ?>>
					<span class="description">Run logic without emailing clients or updating Xero.</span>
				</td>
			</tr>
			<tr>
				<th scope="row">Check Interval</th>
				<td>
					<select name="check_interval">
						<option value="15" <?php selected( get_option( 'xero_check_interval', 60 ), 15 ); ?>>15 Minutes</option>
						<option value="30" <?php selected( get_option( 'xero_check_interval', 60 ), 30 ); ?>>30 Minutes</option>
						<option value="60" <?php selected( get_option( 'xero_check_interval', 60 ), 60 ); ?>>1 Hour</option>
						<option value="240" <?php selected( get_option( 'xero_check_interval', 60 ), 240 ); ?>>4 Hours</option>
						<option value="480" <?php selected( get_option( 'xero_check_interval', 60 ), 480 ); ?>>8 Hours</option>
						<option value="1440" <?php selected( get_option( 'xero_check_interval', 60 ), 1440 ); ?>>24 Hours (Recommended)</option>
					</select>
					<p class="description">How often to check Xero for payment status updates.</p>
				</td>
			</tr>
			<tr>
				<th scope="row">Overdue Threshold (Days)</th>
				<td>
					<input type="number" name="overdue_days" value="<?php echo esc_attr( get_option( 'xero_overdue_days', 10 ) ); ?>" class="small-text">
					<span class="description">Number of days before marking invoice as overdue.</span>
				</td>
			</tr>
			<tr>
				<th scope="row">Batch Limit</th>
				<td>
					<input type="number" name="batch_limit" value="<?php echo esc_attr( get_option( 'xero_batch_limit', 50 ) ); ?>" class="small-text">
					<span class="description">Invoices to check per run.</span>
				</td>
			</tr>
		</table>

		<h2>Email Notifications</h2>
		<table class="form-table">
			<tr>
				<th scope="row">Send Email Reports</th>
				<td>
					<input type="checkbox" name="send_email_reports" value="1" <?php checked( get_option( 'xero_send_email_reports' ), '1' ); ?>>
					<span class="description">Send a summary email after each payment check.</span>
				</td>
			</tr>
			<tr>
				<th scope="row">Notification Recipients</th>
				<td>
					<?php
					$selected_user_ids = get_option( 'xero_notification_users', array() );
					$allowed_roles = array( 'administrator', 'website_administrator', 'job_admin', 'sales_rep' );
					$users = get_users( array( 'role__in' => $allowed_roles, 'orderby' => 'display_name' ) );
					
					if ( ! empty( $users ) ) {
						echo '<div style="max-height: 200px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; background: #fff;">';
						foreach ( $users as $user ) {
							$checked = in_array( $user->ID, $selected_user_ids ) ? 'checked' : '';
							printf(
								'<label style="display: block; margin: 5px 0;"><input type="checkbox" name="notification_users[]" value="%d" %s> %s (%s)</label>',
								esc_attr( $user->ID ),
								$checked,
								esc_html( $user->display_name ),
								esc_html( $user->user_email )
							);
						}
						echo '</div>';
					} else {
						echo '<p>No users with appropriate roles found.</p>';
					}
					?>
					<p class="description">Select users who should receive payment check summaries.</p>
				</td>
			</tr>
		</table>

		<?php submit_button( 'Save Settings', 'primary', 'save_xero_settings' ); ?>
	</form>
</div>
