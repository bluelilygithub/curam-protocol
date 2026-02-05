<?php
/**
 * Curam Admin Notices - Handles admin status banners
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Curam_Admin_Notices {

	/**
	 * Initialize admin notices hooks.
	 */
	public static function init() {
		add_action( 'admin_notices', array( __CLASS__, 'display_status_banner' ) );
	}

	/**
	 * Display status banners and validation errors in the admin editor.
	 */
	public static function display_status_banner() {
		$screen = get_current_screen();
		if ( $screen->id !== 'clientenquiry' ) {
			return;
		}

		global $post;

		$connection_status = self::check_connections();

		if ( $connection_status['xero_ok'] && $connection_status['zapier_ok'] ) {
			self::render_success_banner();
		} else {
			self::render_error_banner( $connection_status['issues'] );
		}

		if ( ! $post || ! $post->ID ) {
			return;
		}

		self::display_overdue_warning( $post->ID );
		self::display_validation_errors( $post->ID );
	}

	/**
	 * Check Xero and Zapier connection status.
	 *
	 * @return array Connection status with xero_ok, zapier_ok, and issues.
	 */
	private static function check_connections() {
		$xero_ok = false;
		$zapier_ok = false;
		$issues = array();

		$connection_status = get_transient( 'xero_connection_status' );

		if ( $connection_status === false ) {
			$client_id = defined( 'XERO_CLIENT_ID' ) ? XERO_CLIENT_ID : '';
			$client_secret = defined( 'XERO_CLIENT_SECRET' ) ? XERO_CLIENT_SECRET : '';
			$refresh_token = get_option( 'xero_refresh_token' );
			$tenant_id = get_option( 'xero_tenant_id' );

			if ( empty( $client_id ) || empty( $client_secret ) || empty( $refresh_token ) || empty( $tenant_id ) ) {
				$connection_status = 'disconnected';
			} else {
				$access_token = Curam_Xero_Api::get_access_token();
				$connection_status = $access_token ? 'connected' : 'error';
			}

			set_transient( 'xero_connection_status', $connection_status, 5 * MINUTE_IN_SECONDS );
		}

		if ( $connection_status === 'connected' ) {
			$xero_ok = true;
		} else {
			$issues[] = 'Xero not authorized or connection failed';
		}

		$zapier_webhook_url = get_option( 'xero_zapier_webhook_url', '' );
		if ( empty( $zapier_webhook_url ) ) {
			$zapier_webhook_url = defined( 'ZAPIER_WEBHOOK_URL' ) ? ZAPIER_WEBHOOK_URL : '';
		}

		if ( empty( $zapier_webhook_url ) ) {
			$issues[] = 'Zapier webhook URL not configured';
		} elseif ( ! filter_var( $zapier_webhook_url, FILTER_VALIDATE_URL ) ) {
			$issues[] = 'Zapier webhook URL is not a valid URL';
		} elseif ( strpos( $zapier_webhook_url, 'hooks.zapier.com' ) === false ) {
			$issues[] = 'Invalid Zapier webhook URL (must be hooks.zapier.com)';
		} else {
			$zapier_ok = true;
		}

		return array(
			'xero_ok'   => $xero_ok,
			'zapier_ok' => $zapier_ok,
			'issues'    => $issues,
		);
	}

	/**
	 * Render success connection banner.
	 */
	private static function render_success_banner() {
		echo '<div class="notice notice-success" style="border-left-color: #28a745; background-color: #f0fdf4;">';
		echo '<p style="color: #155724; font-size: 14px; font-weight: bold;">';
		echo '✓ Xero & Zapier Connected: Invoices will be generated automatically when status is set to "Invoiced & Assigned".';
		echo '</p></div>';
	}

	/**
	 * Render error connection banner.
	 *
	 * @param array $issues List of connection issues.
	 */
	private static function render_error_banner( $issues ) {
		echo '<div class="notice notice-error" style="border-left-color: #dc3545; background-color: #fff3cd;">';
		echo '<p style="color: #856404; font-size: 14px; font-weight: bold;">';
		echo '⚠ Setup Incomplete: ' . esc_html( implode( ', ', $issues ) );
		echo '<br><small>Automatic invoicing will not work until both are configured.</small>';
		echo '</p></div>';
	}

	/**
	 * Display overdue warning if applicable.
	 *
	 * @param int $post_id The post ID.
	 */
	private static function display_overdue_warning( $post_id ) {
		$status = get_field( 'enquiry_status', $post_id );
		$overdue_warning = get_post_meta( $post_id, 'xero_invoice_overdue_warning', true );

		if ( ! empty( $overdue_warning ) && $status === 'overdue' ) {
			echo '<div class="notice notice-error is-dismissible" style="border-left-color: #dc3545; background-color: #fff3cd;">';
			echo '<p style="color: #856404; font-size: 16px; font-weight: bold;">';
			echo '🔴 OVERDUE INVOICE: ' . esc_html( $overdue_warning );
			echo '</p>';
			echo '<p style="color: #856404; font-size: 14px; margin-top: 5px;">';
			echo '<strong>Action Required:</strong> Contact customer for payment or update invoice status in Xero.';
			echo '</p></div>';
		}
	}

	/**
	 * Display validation errors for incomplete invoices.
	 *
	 * @param int $post_id The post ID.
	 */
	private static function display_validation_errors( $post_id ) {
		$status = get_field( 'enquiry_status', $post_id );
		$invoice_id = get_post_meta( $post_id, 'xero_invoice_id', true );

		if ( $status !== 'assigned' || ! empty( $invoice_id ) ) {
			return;
		}

		$final_value = get_field( 'final_value', $post_id );
		$products = get_field( 'products', $post_id );
		$email = get_field( 'email', $post_id );

		$errors = array();

		if ( empty( $final_value ) || $final_value <= 0 ) {
			$errors[] = 'Agreed Sales Value is missing or zero';
		}
		if ( empty( $products ) || ! is_array( $products ) || count( $products ) === 0 ) {
			$errors[] = 'No products selected';
		}
		if ( empty( $email ) || ! is_email( $email ) ) {
			$errors[] = 'Invalid email address';
		}

		if ( ! empty( $errors ) ) {
			echo '<div class="notice notice-error" style="border-left-color: #dc3545;">';
			echo '<p style="color: #721c24; font-size: 14px; font-weight: bold;">';
			echo '⚠ Xero Invoice NOT Created - Missing Required Fields:';
			echo '<ul style="margin: 5px 0; padding-left: 20px;">';
			foreach ( $errors as $error ) {
				echo '<li>' . esc_html( $error ) . '</li>';
			}
			echo '</ul>';
			echo '<strong>Action Required:</strong> Fill in the missing fields above and click "Update" to create the invoice.';
			echo '</p></div>';
		}
	}
}
