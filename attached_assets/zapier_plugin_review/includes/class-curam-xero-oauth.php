<?php
/**
 * Curam Xero OAuth - Handles OAuth flow for Xero authorization
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Curam_Xero_Oauth {

	/**
	 * Initialize OAuth hooks.
	 */
	public static function init() {
		add_action( 'admin_init', array( __CLASS__, 'handle_oauth_callback' ) );
	}

	/**
	 * Handle OAuth callback from Xero.
	 */
	public static function handle_oauth_callback() {
		if ( ! isset( $_GET['page'] ) || $_GET['page'] !== 'xero-authorization' ) {
			return;
		}

		if ( isset( $_GET['action'] ) && $_GET['action'] === 'disconnect' ) {
			self::handle_disconnect();
			return;
		}

		if ( ! isset( $_GET['action'] ) || $_GET['action'] !== 'callback' ) {
			return;
		}

		if ( ! isset( $_GET['code'] ) ) {
			wp_die( 'Authorization failed: No code received' );
		}

		if ( ! isset( $_GET['state'] ) || ! wp_verify_nonce( $_GET['state'], 'xero_oauth_state' ) ) {
			wp_die( 'Authorization failed: Invalid state' );
		}

		$code = sanitize_text_field( $_GET['code'] );
		self::exchange_code_for_tokens( $code );
	}

	/**
	 * Handle disconnect action.
	 */
	private static function handle_disconnect() {
		if ( ! isset( $_GET['_wpnonce'] ) || ! wp_verify_nonce( $_GET['_wpnonce'], 'xero_disconnect' ) ) {
			wp_die( 'Security check failed. Please try again.' );
		}
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You do not have permission to perform this action.' );
		}

		delete_option( 'xero_refresh_token' );
		delete_option( 'xero_tenant_id' );
		delete_transient( 'xero_access_token' );
		delete_transient( 'xero_connection_status' );
		error_log( 'Curam Xero: Disconnected by user ' . get_current_user_id() );

		wp_redirect( admin_url( 'admin.php?page=xero-authorization' ) );
		exit;
	}

	/**
	 * Exchange authorization code for tokens.
	 *
	 * @param string $code The authorization code.
	 */
	private static function exchange_code_for_tokens( $code ) {
		$client_id = defined( 'XERO_CLIENT_ID' ) ? XERO_CLIENT_ID : '';
		$client_secret = defined( 'XERO_CLIENT_SECRET' ) ? XERO_CLIENT_SECRET : '';
		$redirect_uri = admin_url( 'admin.php?page=xero-authorization&action=callback' );

		$response = wp_remote_post(
			'https://identity.xero.com/connect/token',
			array(
				'headers' => array(
					'Authorization' => 'Basic ' . base64_encode( $client_id . ':' . $client_secret ),
					'Content-Type'  => 'application/x-www-form-urlencoded',
				),
				'body'    => array(
					'grant_type'   => 'authorization_code',
					'code'         => $code,
					'redirect_uri' => $redirect_uri,
				),
				'timeout' => 30,
			)
		);

		if ( is_wp_error( $response ) ) {
			wp_die( 'Token exchange failed: ' . $response->get_error_message() );
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( empty( $body['access_token'] ) || empty( $body['refresh_token'] ) ) {
			wp_die( 'Token exchange failed: No tokens in response' );
		}

		update_option( 'xero_refresh_token', $body['refresh_token'] );

		self::fetch_tenant_id( $body['access_token'] );

		set_transient( 'xero_access_token', $body['access_token'], 25 * MINUTE_IN_SECONDS );

		wp_redirect( admin_url( 'admin.php?page=xero-authorization&authorized=1' ) );
		exit;
	}

	/**
	 * Fetch tenant ID from Xero connections.
	 *
	 * @param string $access_token The access token.
	 */
	private static function fetch_tenant_id( $access_token ) {
		$response = wp_remote_get(
			'https://api.xero.com/connections',
			array(
				'headers' => array(
					'Authorization' => 'Bearer ' . $access_token,
					'Content-Type'  => 'application/json',
				),
				'timeout' => 30,
			)
		);

		if ( ! is_wp_error( $response ) ) {
			$connections = json_decode( wp_remote_retrieve_body( $response ), true );
			if ( ! empty( $connections[0]['tenantId'] ) ) {
				update_option( 'xero_tenant_id', $connections[0]['tenantId'] );
			}
		}
	}
}
