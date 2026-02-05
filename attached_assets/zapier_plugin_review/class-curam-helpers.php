<?php
/**
 * Curam Helpers - Utility functions for phone cleaning and validation
 * 
 * Stage 1 Refactoring: Helper functions extracted from main plugin file
 * 
 * @package Curam_AI_Zapier
 * @version 2.1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Curam_Helpers {

	/**
	 * Clean and format phone number to Australian international format.
	 *
	 * @param string $phone Raw phone number input.
	 * @return string Cleaned phone number or empty string if invalid.
	 */
	public static function clean_phone_number( $phone ) {
		if ( empty( $phone ) ) {
			return '';
		}

		$phone = trim( (string) $phone );

		$placeholders = array( 'tba', 'n/a', 'na', 'none', 'unknown', 'call me', 'ask' );
		foreach ( $placeholders as $placeholder ) {
			if ( stripos( $phone, $placeholder ) !== false ) {
				return '';
			}
		}

		if ( strpos( $phone, '+61' ) === 0 ) {
			return preg_replace( '/[\s\-\(\)]+/', '', $phone );
		}

		$digits_only = preg_replace( '/[^0-9+]/', '', $phone );

		if ( strpos( $digits_only, '0' ) === 0 ) {
			$digits_only = '+61' . substr( $digits_only, 1 );
		}

		if ( strlen( $digits_only ) < 12 ) {
			error_log( "DiamondPlate: Invalid phone length - '{$phone}' → '{$digits_only}'" );
			return '';
		}

		return $digits_only;
	}

	/**
	 * Validate phone number field in ACF.
	 *
	 * @param bool|string $valid Current validation status.
	 * @param mixed       $value Field value.
	 * @param array       $field Field settings.
	 * @param string      $input Input name.
	 * @return bool|string Validation result or error message.
	 */
	public static function validate_phone_number( $valid, $value, $field, $input ) {
		if ( ! $valid || empty( $value ) ) {
			return $valid;
		}

		$cleaned = self::clean_phone_number( $value );

		if ( empty( $cleaned ) && ! empty( trim( $value ) ) ) {
			$placeholders = array( 'tba', 'n/a', 'call', 'unknown' );
			foreach ( $placeholders as $placeholder ) {
				if ( stripos( $value, $placeholder ) !== false ) {
					return true;
				}
			}

			return 'Please enter a valid Australian phone number (e.g., 0412 345 678)';
		}

		return true;
	}

	/**
	 * Get client IP address with proxy support.
	 * Works behind CloudFlare, AWS ELB, nginx proxy, etc.
	 *
	 * @return string Client IP address.
	 */
	public static function get_client_ip() {
		if ( ! empty( $_SERVER['HTTP_CF_CONNECTING_IP'] ) ) {
			return sanitize_text_field( $_SERVER['HTTP_CF_CONNECTING_IP'] );
		}
		
		if ( ! empty( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) {
			$ips = explode( ',', $_SERVER['HTTP_X_FORWARDED_FOR'] );
			return sanitize_text_field( trim( $ips[0] ) );
		}
		
		if ( ! empty( $_SERVER['HTTP_X_REAL_IP'] ) ) {
			return sanitize_text_field( $_SERVER['HTTP_X_REAL_IP'] );
		}
		
		return isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( $_SERVER['REMOTE_ADDR'] ) : 'unknown';
	}
}

/**
 * Backwards compatibility wrapper functions.
 * These ensure existing code calling these functions continues to work.
 */
if ( ! function_exists( 'clean_phone_number' ) ) {
	function clean_phone_number( $phone ) {
		return Curam_Helpers::clean_phone_number( $phone );
	}
}

if ( ! function_exists( 'validate_phone_number' ) ) {
	function validate_phone_number( $valid, $value, $field, $input ) {
		return Curam_Helpers::validate_phone_number( $valid, $value, $field, $input );
	}
}

if ( ! function_exists( 'curam_get_client_ip' ) ) {
	function curam_get_client_ip() {
		return Curam_Helpers::get_client_ip();
	}
}
