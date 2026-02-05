<?php
/**
 * Curam Xero API - Wrapper for Xero API interactions
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Curam_Xero_Api {

	const TOKEN_CACHE_KEY = 'xero_access_token';
	const TOKEN_CACHE_DURATION = 25 * MINUTE_IN_SECONDS;

	/**
	 * Get Xero OAuth2 access token.
	 *
	 * @return string|bool Access token or false on failure.
	 */
	public static function get_access_token() {
		$cached_token = get_transient( self::TOKEN_CACHE_KEY );
		if ( $cached_token ) {
			return $cached_token;
		}

		$client_id = defined( 'XERO_CLIENT_ID' ) ? XERO_CLIENT_ID : '';
		$client_secret = defined( 'XERO_CLIENT_SECRET' ) ? XERO_CLIENT_SECRET : '';

		if ( empty( $client_id ) || empty( $client_secret ) ) {
			error_log( 'Xero API: Client ID or Secret not configured in wp-config.php' );
			return false;
		}

		$refresh_token = get_option( 'xero_refresh_token' );
		if ( empty( $refresh_token ) ) {
			error_log( 'Xero API: No refresh token - authorization required' );
			return false;
		}

		$response = wp_remote_post(
			'https://identity.xero.com/connect/token',
			array(
				'headers' => array(
					'Authorization' => 'Basic ' . base64_encode( $client_id . ':' . $client_secret ),
					'Content-Type'  => 'application/x-www-form-urlencoded',
				),
				'body'    => array(
					'grant_type'    => 'refresh_token',
					'refresh_token' => $refresh_token,
				),
				'timeout' => 30,
			)
		);

		if ( is_wp_error( $response ) ) {
			error_log( 'Xero API: Token refresh failed - ' . $response->get_error_message() );
			return false;
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( empty( $body['access_token'] ) ) {
			error_log( 'Xero API: Token refresh failed - no access token in response' );
			return false;
		}

		if ( ! empty( $body['refresh_token'] ) ) {
			update_option( 'xero_refresh_token', $body['refresh_token'] );
		}

		set_transient( self::TOKEN_CACHE_KEY, $body['access_token'], self::TOKEN_CACHE_DURATION );

		return $body['access_token'];
	}

	/**
	 * Get invoice from Xero API.
	 *
	 * @param string $access_token The OAuth access token.
	 * @param string $invoice_id   The Xero invoice GUID.
	 * @return array|bool Invoice data or false on failure.
	 */
	public static function get_invoice( $access_token, $invoice_id ) {
		$tenant_id = get_option( 'xero_tenant_id' );

		if ( empty( $tenant_id ) ) {
			error_log( 'Xero API: No tenant ID configured' );
			return false;
		}

		$response = wp_remote_get(
			'https://api.xero.com/api.xro/2.0/Invoices/' . $invoice_id,
			array(
				'headers' => array(
					'Authorization'  => 'Bearer ' . $access_token,
					'xero-tenant-id' => $tenant_id,
					'Accept'         => 'application/json',
				),
				'timeout' => 30,
			)
		);

		if ( is_wp_error( $response ) ) {
			error_log( 'Xero API: Get invoice failed - ' . $response->get_error_message() );
			return false;
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( empty( $body['Invoices'][0] ) ) {
			return false;
		}

		return $body['Invoices'][0];
	}

	/**
	 * Test connection to Xero API.
	 *
	 * @return bool True if connected, false otherwise.
	 */
	public static function test_connection() {
		$access_token = self::get_access_token();
		return ! empty( $access_token );
	}

	/**
	 * Get authorization URL for OAuth flow.
	 *
	 * @return string Authorization URL.
	 */
	public static function get_authorization_url() {
		$client_id = defined( 'XERO_CLIENT_ID' ) ? XERO_CLIENT_ID : '';
		$redirect_uri = admin_url( 'admin.php?page=xero-authorization&action=callback' );

		$params = array(
			'response_type' => 'code',
			'client_id'     => $client_id,
			'redirect_uri'  => $redirect_uri,
			'scope'         => 'offline_access accounting.transactions.read accounting.contacts.read',
			'state'         => wp_create_nonce( 'xero_oauth_state' ),
		);

		return 'https://login.xero.com/identity/connect/authorize?' . http_build_query( $params );
	}
}

/**
 * Backwards compatibility wrapper functions.
 */
if ( ! function_exists( 'xero_get_access_token' ) ) {
	function xero_get_access_token() {
		return Curam_Xero_Api::get_access_token();
	}
}

if ( ! function_exists( 'xero_get_invoice' ) ) {
	function xero_get_invoice( $access_token, $invoice_id ) {
		return Curam_Xero_Api::get_invoice( $access_token, $invoice_id );
	}
}

if ( ! function_exists( 'xero_get_authorization_url' ) ) {
	function xero_get_authorization_url() {
		return Curam_Xero_Api::get_authorization_url();
	}
}
