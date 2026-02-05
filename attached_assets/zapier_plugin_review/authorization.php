<?php
/**
 * Authorization View
 *
 * @package Curam_Xero
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$client_id = defined( 'XERO_CLIENT_ID' ) ? XERO_CLIENT_ID : '';
$client_secret = defined( 'XERO_CLIENT_SECRET' ) ? XERO_CLIENT_SECRET : '';
$refresh_token = get_option( 'xero_refresh_token' );
$tenant_id = get_option( 'xero_tenant_id' );
?>
<div class="wrap">
	<h1>Xero Authorization</h1>

	<?php if ( empty( $client_id ) || empty( $client_secret ) ) : ?>
		<div class="notice notice-error">
			<p><strong>Configuration Required:</strong> Add XERO_CLIENT_ID and XERO_CLIENT_SECRET to wp-config.php</p>
		</div>
	<?php endif; ?>

	<table class="form-table">
		<tr>
			<th>Client ID</th>
			<td>
				<?php if ( ! empty( $client_id ) ) : ?>
					✓ Configured: <?php echo esc_html( substr( $client_id, 0, 20 ) ) . '...'; ?>
				<?php else : ?>
					✗ Not configured
				<?php endif; ?>
			</td>
		</tr>
		<tr>
			<th>Client Secret</th>
			<td>
				<?php if ( ! empty( $client_secret ) ) : ?>
					✓ Configured
				<?php else : ?>
					✗ Not configured
				<?php endif; ?>
			</td>
		</tr>
		<tr>
			<th>Authorization Status</th>
			<td>
				<?php if ( ! empty( $refresh_token ) ) : ?>
					<span style="color: green;">✓ Authorized</span>
				<?php else : ?>
					<span style="color: red;">✗ Not authorized</span>
				<?php endif; ?>
			</td>
		</tr>
		<tr>
			<th>Tenant ID</th>
			<td>
				<?php if ( ! empty( $tenant_id ) ) : ?>
					✓ <?php echo esc_html( $tenant_id ); ?>
				<?php else : ?>
					✗ Not retrieved yet
				<?php endif; ?>
			</td>
		</tr>
	</table>

	<?php if ( ! empty( $client_id ) && ! empty( $client_secret ) ) : ?>
		<h2>Connect to Xero</h2>
		<?php if ( empty( $refresh_token ) ) : ?>
			<p>
				<a href="<?php echo esc_url( Curam_Xero_Api::get_authorization_url() ); ?>"
				   class="button button-primary button-hero">
					Connect to Xero
				</a>
			</p>
		<?php else : ?>
			<p style="color: green;">✓ Already connected to Xero</p>
			<p>
				<a href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin.php?page=xero-authorization&action=disconnect' ), 'xero_disconnect' ) ); ?>"
				   class="button"
				   onclick="return confirm('Are you sure you want to disconnect from Xero?');">
					Disconnect
				</a>
			</p>
		<?php endif; ?>
	<?php endif; ?>

	<h2>Setup Instructions</h2>
	<ol>
		<li>Get your Client ID and Client Secret from <a href="https://developer.xero.com/app/manage" target="_blank">Xero Developer Portal</a></li>
		<li>Add them to wp-config.php</li>
		<li>Click "Connect to Xero" button above</li>
		<li>Login to Xero and approve access</li>
		<li>You'll be redirected back here automatically</li>
		<li>Cron job will start checking payments automatically</li>
	</ol>
</div>
