<?php
/**
 * Curam REST API - Handles REST endpoints for Zapier/Xero integration
 * 
 * Stage 2 Refactoring: REST API endpoints extracted from main plugin file
 * 
 * @package Curam_AI_Zapier
 * @version 1.5
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Curam_Rest_Api {

	/**
	 * Initialize REST API hooks.
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/**
	 * Register REST API routes.
	 */
	public static function register_routes() {
		register_rest_route(
			'diamondplate/v1',
			'/invoice-created',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'store_invoice_id' ),
				'permission_callback' => array( __CLASS__, 'verify_auth' ),
			)
		);

		register_rest_route(
			'diamondplate/v1',
			'/payment-received',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'update_status_on_payment' ),
				'permission_callback' => array( __CLASS__, 'verify_auth' ),
			)
		);
	}

	/**
	 * Verify REST API authentication for Zapier requests.
	 *
	 * @param WP_REST_Request $request The REST request object.
	 * @return bool|WP_Error True if authenticated, WP_Error otherwise.
	 */
	public static function verify_auth( $request ) {
		if ( is_user_logged_in() && current_user_can( 'edit_posts' ) ) {
			return true;
		}

		$secret = $request->get_header( 'X-Zapier-Secret' );
		$expected_secret = defined( 'ZAPIER_SECRET_KEY' ) ? ZAPIER_SECRET_KEY : 'your-secret-key-here';

		if ( $secret === $expected_secret ) {
			return true;
		}

		$client_ip = function_exists( 'curam_get_client_ip' ) ? curam_get_client_ip() : $_SERVER['REMOTE_ADDR'];
		error_log( 'DiamondPlate Xero: Unauthorized REST API access attempt from IP: ' . $client_ip );
		return new WP_Error(
			'rest_forbidden',
			'Authentication required',
			array( 'status' => 401 )
		);
	}

	/**
	 * Store Xero invoice ID after invoice creation.
	 *
	 * @param WP_REST_Request $request The REST request object.
	 * @return WP_REST_Response Response object.
	 */
	public static function store_invoice_id( $request ) {
		$post_id = absint( $request->get_param( 'post_id' ) );
		$invoice_id = $request->get_param( 'invoice_id' );
		$invoice_number = $request->get_param( 'invoice_number' );
		$error_message = $request->get_param( 'error_message' );

		if ( ! $post_id || ! get_post( $post_id ) ) {
			return new WP_REST_Response( array( 'error' => 'Invalid or missing post ID' ), 400 );
		}

		if ( get_post_type( $post_id ) !== 'clientenquiry' ) {
			return new WP_REST_Response( array( 'error' => 'Invalid post type' ), 400 );
		}

		$current_details = get_field( 'email_details', $post_id );
		$date_prefix = current_time( 'd/m/y' ) . ': ';

		if ( ! empty( $error_message ) ) {
			$new_entry = $date_prefix . 'ERROR - ' . sanitize_text_field( $error_message );
			update_field( 'email_details', $current_details . "\n" . $new_entry, $post_id );
			return new WP_REST_Response( array( 'success' => true ), 200 );
		}

		if ( ! empty( $invoice_id ) ) {
			update_post_meta( $post_id, 'xero_invoice_id', sanitize_text_field( $invoice_id ) );
			update_post_meta( $post_id, 'xero_invoice_number', sanitize_text_field( $invoice_number ) );
			update_post_meta( $post_id, 'xero_invoice_date', current_time( 'mysql' ) );

			$invoice_url = 'https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=' . $invoice_id;
			update_post_meta( $post_id, 'xero_invoice_url', esc_url_raw( $invoice_url ) );

			$new_entry = $date_prefix . 'Invoice Created ' . sanitize_text_field( $invoice_number );
			update_field( 'email_details', $current_details . "\n" . $new_entry, $post_id );
		}

		return new WP_REST_Response( array( 'success' => true ), 200 );
	}

	/**
	 * Update enquiry status when payment is received from Xero.
	 *
	 * @param WP_REST_Request $request The REST request object.
	 * @return WP_REST_Response Response object.
	 */
	public static function update_status_on_payment( $request ) {
		$invoice_id = sanitize_text_field( $request->get_param( 'invoice_id' ) );

		if ( empty( $invoice_id ) || strlen( $invoice_id ) !== 36 ) {
			return new WP_REST_Response( array( 'error' => 'Invalid invoice ID format' ), 400 );
		}

		$posts = get_posts(
			array(
				'post_type'   => 'clientenquiry',
				'meta_key'    => 'xero_invoice_id',
				'meta_value'  => sanitize_text_field( $invoice_id ),
				'numberposts' => 1,
			)
		);

		if ( empty( $posts ) ) {
			return new WP_REST_Response( array( 'error' => 'Post not found' ), 404 );
		}

		$post_id = $posts[0]->ID;

		update_field( 'enquiry_status', 'paid', $post_id );

		$current_details = get_field( 'email_details', $post_id );
		$date_prefix = current_time( 'd/m/y' ) . ': ';
		$new_entry = $date_prefix . 'Payment Received - Status updated to Paid';
		update_field( 'email_details', $current_details . "\n" . $new_entry, $post_id );

		return new WP_REST_Response(
			array(
				'success' => true,
				'post_id' => $post_id,
				'message' => 'Status updated to paid',
			),
			200
		);
	}
}

/**
 * Backwards compatibility wrapper functions.
 */
if ( ! function_exists( 'verify_zapier_rest_auth' ) ) {
	function verify_zapier_rest_auth( $request ) {
		return Curam_Rest_Api::verify_auth( $request );
	}
}

if ( ! function_exists( 'store_xero_invoice_id' ) ) {
	function store_xero_invoice_id( $request ) {
		return Curam_Rest_Api::store_invoice_id( $request );
	}
}

if ( ! function_exists( 'update_status_on_payment' ) ) {
	function update_status_on_payment( $request ) {
		return Curam_Rest_Api::update_status_on_payment( $request );
	}
}
