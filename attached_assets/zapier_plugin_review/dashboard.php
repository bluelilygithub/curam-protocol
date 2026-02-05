<?php
/**
 * Dashboard View
 *
 * @package Curam_Xero
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

global $wpdb;

// Get statistics
$stats = Curam_Dashboard_Functions::get_stats();
$recent_activity = Curam_Dashboard_Functions::get_recent_activity( 10 );

// Check Xero connection
$xero_connected = false;
$client_id = defined( 'XERO_CLIENT_ID' ) ? XERO_CLIENT_ID : '';
$client_secret = defined( 'XERO_CLIENT_SECRET' ) ? XERO_CLIENT_SECRET : '';
$refresh_token = get_option( 'xero_refresh_token' );
$tenant_id = get_option( 'xero_tenant_id' );

if ( ! empty( $client_id ) && ! empty( $client_secret ) && ! empty( $refresh_token ) && ! empty( $tenant_id ) ) {
	$xero_connected = true;
}

$webhook_url = get_option( 'xero_zapier_webhook_url', defined( 'ZAPIER_WEBHOOK_URL' ) ? ZAPIER_WEBHOOK_URL : '' );
$webhook_ok = ! empty( $webhook_url ) && strpos( $webhook_url, 'hooks.zapier.com' ) !== false;
?>
<div class="wrap">
	<h1 style="margin-bottom: 10px;">📊 Xero Integration Dashboard</h1>
	<p style="color: #666; margin-top: 0;">Performance overview and key metrics for your Xero integration</p>

	<!-- Connection Status Banner -->
	<div style="background: <?php echo ( $xero_connected && $webhook_ok ) ? '#d1f4e0' : '#fff3cd'; ?>; 
					border-left: 4px solid <?php echo ( $xero_connected && $webhook_ok ) ? '#46b450' : '#f0b429'; ?>; 
					padding: 15px; margin: 20px 0; border-radius: 4px;">
		<?php if ( $xero_connected && $webhook_ok ) : ?>
			<strong style="color: #2a7a3f;">✓ All Systems Operational</strong>
			<span style="color: #2a7a3f;"> - Xero connected and Zapier webhook configured</span>
		<?php else : ?>
			<strong style="color: #856404;">⚠ Configuration Required</strong>
			<span style="color: #856404;">
				<?php if ( ! $xero_connected ) echo ' - Xero not connected'; ?>
				<?php if ( ! $webhook_ok ) echo ' - Webhook not configured'; ?>
				<a href="<?php echo admin_url( 'admin.php?page=xero-settings' ); ?>" style="margin-left: 10px;">Configure Now</a>
			</span>
		<?php endif; ?>
	</div>

	<!-- Key Metrics Grid -->
	<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin: 30px 0;">
		
		<!-- Total Invoices -->
		<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
			<div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Total Invoices</div>
			<div style="font-size: 42px; font-weight: bold; margin-bottom: 10px; line-height: 1;"><?php echo number_format( $stats['total_invoices'] ); ?></div>
			<div style="font-size: 12px; opacity: 0.8;">Created via integration</div>
		</div>

		<!-- Success Rate -->
		<div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
			<div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Success Rate</div>
			<div style="font-size: 42px; font-weight: bold; margin-bottom: 10px; line-height: 1;"><?php echo number_format( $stats['success_rate'], 1 ); ?>%</div>
			<div style="font-size: 12px; opacity: 0.8;">
				<?php echo number_format( $stats['assigned_with_invoice'] ); ?> of <?php echo number_format( $stats['total_assigned'] ); ?> assigned posts
			</div>
		</div>

		<!-- Overdue Invoices -->
		<div style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); color: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
			<div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Overdue Invoices</div>
			<div style="font-size: 42px; font-weight: bold; margin-bottom: 10px; line-height: 1;"><?php echo number_format( $stats['overdue_count'] ); ?></div>
			<div style="font-size: 12px; opacity: 0.8;">
				$<?php echo number_format( $stats['overdue_amount'], 2 ); ?> outstanding
			</div>
		</div>

		<!-- Paid This Month -->
		<div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
			<div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Paid This Month</div>
			<div style="font-size: 42px; font-weight: bold; margin-bottom: 10px; line-height: 1;"><?php echo number_format( $stats['paid_this_month'] ); ?></div>
			<div style="font-size: 12px; opacity: 0.8;">
				<?php echo date( 'F Y' ); ?>
			</div>
		</div>

	</div>

	<!-- Status Breakdown -->
	<div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 25px; margin: 20px 0;">
		<h2 style="margin-top: 0;">📈 Status Breakdown</h2>
		<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
			<?php foreach ( $stats['status_counts'] as $status => $count ) : ?>
				<div style="padding: 15px; background: #f9f9f9; border-radius: 6px; text-align: center;">
					<div style="font-size: 28px; font-weight: bold; color: #2271b1; margin-bottom: 8px; line-height: 1;"><?php echo number_format( $count ); ?></div>
					<div style="font-size: 14px; color: #666; text-transform: capitalize;">
						<?php echo esc_html( $status ?: 'Not Set' ); ?>
					</div>
				</div>
			<?php endforeach; ?>
		</div>
	</div>

	<!-- Recent Activity -->
	<div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 25px; margin: 20px 0;">
		<h2 style="margin-top: 0;">🕐 Recent Activity</h2>
		<?php if ( empty( $recent_activity ) ) : ?>
			<p style="color: #666; font-style: italic;">No recent invoice activity</p>
		<?php else : ?>
			<table class="wp-list-table widefat striped">
				<thead>
					<tr>
						<th style="padding: 12px;">Date</th>
						<th style="padding: 12px;">Post</th>
						<th style="padding: 12px;">Invoice Number</th>
						<th style="padding: 12px;">Status</th>
						<th style="padding: 12px;">Action</th>
					</tr>
				</thead>
				<tbody>
					<?php foreach ( $recent_activity as $activity ) : ?>
						<tr>
							<td style="padding: 12px;"><?php echo esc_html( date( 'd/m/Y', strtotime( $activity['date'] ) ) ); ?></td>
							<td style="padding: 12px;">
								<strong><?php echo esc_html( $activity['title'] ); ?></strong>
								<br><small style="color: #666;">ID: <?php echo $activity['post_id']; ?></small>
							</td>
							<td style="padding: 12px;">
								<?php if ( $activity['invoice_number'] ) : ?>
									<code><?php echo esc_html( $activity['invoice_number'] ); ?></code>
								<?php else : ?>
									<span style="color: #999;">—</span>
								<?php endif; ?>
							</td>
							<td style="padding: 12px;">
								<span style="display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500;
									background: <?php echo $activity['status'] === 'paid' ? '#d1f4e0' : ( $activity['status'] === 'overdue' ? '#f8d7da' : '#e8f4f8' ); ?>;
									color: <?php echo $activity['status'] === 'paid' ? '#2a7a3f' : ( $activity['status'] === 'overdue' ? '#721c24' : '#155B7A' ); ?>">
									<?php echo esc_html( ucfirst( $activity['status'] ) ); ?>
								</span>
							</td>
							<td style="padding: 12px;">
								<a href="<?php echo admin_url( 'post.php?post=' . $activity['post_id'] . '&action=edit' ); ?>" class="button button-small">View</a>
							</td>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		<?php endif; ?>
	</div>

	<!-- Quick Actions -->
	<div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 25px; margin: 20px 0;">
		<h2 style="margin-top: 0;">⚡ Quick Actions</h2>
		<div style="display: flex; gap: 10px; flex-wrap: wrap;">
			<a href="<?php echo admin_url( 'admin.php?page=xero-status-checker' ); ?>" class="button button-primary">
				🔍 Check Payment Status
			</a>
			<a href="<?php echo admin_url( 'admin.php?page=xero-authorization' ); ?>" class="button">
				🔐 Manage Authorization
			</a>
			<a href="<?php echo admin_url( 'admin.php?page=xero-settings' ); ?>" class="button">
				⚙️ Settings
			</a>
			<a href="<?php echo admin_url( 'admin.php?page=xero-sql-testing' ); ?>" class="button">
				🧪 Testing & Diagnostics
			</a>
		</div>
	</div>

</div>
