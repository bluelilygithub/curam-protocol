<?php
/**
 * Curam Webhook Handler - Triggers Zapier webhooks for invoice creation
 */

if ( ! defined( 'ABSPATH' ) ) {
        exit;
}

class Curam_Webhook_Handler {

        /**
         * Initialize webhook hooks.
         */
        public static function init() {
                add_action( 'acf/save_post', array( __CLASS__, 'trigger_invoice_on_completed' ), 25 );
        }

        /**
         * Trigger Xero invoice webhook when post status is "assigned".
         *
         * @param int $post_id The post ID.
         */
        public static function trigger_invoice_on_completed( $post_id ) {
                if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
                        return;
                }
                if ( wp_is_post_revision( $post_id ) ) {
                        return;
                }
                if ( get_post_type( $post_id ) !== 'clientenquiry' ) {
                        return;
                }
                if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
                        return;
                }
                if ( ! current_user_can( 'edit_post', $post_id ) ) {
                        error_log( "DiamondPlate Xero: Unauthorized save attempt for post {$post_id}" );
                        return;
                }

                $global_key = 'xero_webhook_global_' . gmdate( 'YmdHi' );
                $global_count = (int) get_transient( $global_key );
                if ( $global_count >= 20 ) {
                        error_log( 'DiamondPlate Xero: Global rate limit exceeded (20/min)' );
                        return;
                }
                set_transient( $global_key, $global_count + 1, 60 );

                $last_webhook_time = get_transient( 'xero_webhook_last_' . $post_id );
                if ( $last_webhook_time && ( time() - $last_webhook_time ) < 10 ) {
                        error_log( "DiamondPlate Xero: Rate limit - webhook called too soon for post {$post_id}" );
                        return;
                }
                set_transient( 'xero_webhook_last_' . $post_id, time(), 60 );

                $status = get_field( 'enquiry_status', $post_id );
                if ( $status !== 'assigned' ) {
                        return;
                }

                $existing_invoice_id = get_post_meta( $post_id, 'xero_invoice_id', true );
                if ( ! empty( $existing_invoice_id ) ) {
                        error_log( "DiamondPlate Xero: Skipping post {$post_id} - already has invoice ID: {$existing_invoice_id}" );
                        return;
                }

                if ( ! self::validate_required_fields( $post_id ) ) {
                        return;
                }

                $payload = self::build_payload( $post_id );
                self::send_webhook( $post_id, $payload );
        }

        /**
         * Validate required fields before sending webhook.
         *
         * @param int $post_id The post ID.
         * @return bool True if valid, false otherwise.
         */
        private static function validate_required_fields( $post_id ) {
                $final_value = get_field( 'final_value', $post_id );
                if ( empty( $final_value ) || $final_value <= 0 ) {
                        error_log( "DiamondPlate Xero: Missing or invalid final_value for post {$post_id}" );
                        $current_details = get_field( 'email_details', $post_id );
                        $error_msg = current_time( 'd/m/y' ) . ': ERROR - No sales value entered, invoice not created';
                        update_field( 'email_details', $current_details . "\n" . $error_msg, $post_id );
                        return false;
                }

                $product_ids = get_field( 'products', $post_id );
                if ( empty( $product_ids ) || ! is_array( $product_ids ) || count( $product_ids ) === 0 ) {
                        error_log( "DiamondPlate Xero: No products selected for post {$post_id}" );
                        $current_details = get_field( 'email_details', $post_id );
                        $error_msg = current_time( 'd/m/y' ) . ': ERROR - No products selected, invoice not created';
                        update_field( 'email_details', $current_details . "\n" . $error_msg, $post_id );
                        return false;
                }

                $email = get_field( 'email', $post_id );
                $email = sanitize_email( strtolower( trim( $email ) ) );
                if ( empty( $email ) || ! is_email( $email ) ) {
                        error_log( "DiamondPlate Xero: Invalid email for post {$post_id} - webhook not sent" );
                        $current_details = get_field( 'email_details', $post_id );
                        $error_msg = current_time( 'd/m/y' ) . ': ERROR - Invalid email, invoice not created';
                        update_field( 'email_details', $current_details . "\n" . $error_msg, $post_id );
                        return false;
                }

                return true;
        }

        /**
         * Build webhook payload from post data.
         *
         * @param int $post_id The post ID.
         * @return array The payload array.
         */
        private static function build_payload( $post_id ) {
                $email = sanitize_email( strtolower( trim( get_field( 'email', $post_id ) ) ) );
                $phone_raw = get_field( 'phone', $post_id );
                $phone = Curam_Helpers::clean_phone_number( $phone_raw );

                $fname = get_field( 'firstname', $post_id );
                $lname = get_field( 'lastname', $post_id );
                $company = get_field( 'company_name', $post_id );

                if ( ! empty( $company ) ) {
                        $contact_name = sanitize_text_field( $company );
                } else {
                        $contact_name = sanitize_text_field( trim( $fname . ' ' . $lname ) );
                }

                if ( empty( $contact_name ) ) {
                        $contact_name = "Client-{$post_id}";
                }

                $product_ids = get_field( 'products', $post_id );
                $product_names = array();
                if ( ! empty( $product_ids ) && is_array( $product_ids ) ) {
                        foreach ( $product_ids as $product ) {
                                $prod_id = is_object( $product ) ? $product->ID : $product;
                                $title = get_the_title( $prod_id );
                                if ( $title ) {
                                        $product_names[] = sanitize_text_field( $title );
                                }
                        }
                }

                $payload = array(
                        'post_id'            => $post_id,
                        'job_number'         => sanitize_text_field( get_field( 'job_number', $post_id ) ),
                        'xero_contact_name'  => $contact_name,
                        'firstname'          => sanitize_text_field( $fname ),
                        'lastname'           => sanitize_text_field( $lname ),
                        'company_name'       => sanitize_text_field( $company ),
                        'email'              => $email,
                        'phone'              => $phone,
                        'address'            => sanitize_text_field( get_field( 'address', $post_id ) ),
                        'suburb'             => sanitize_text_field( get_field( 'suburb', $post_id ) ),
                        'postcode'           => sanitize_text_field( get_field( 'postcode', $post_id ) ),
                        'state'              => sanitize_text_field( get_field( 'state', $post_id ) ),
                        'products'           => ! empty( $product_names ) ? implode( "\n", $product_names ) : '',
                        'final_value'        => floatval( get_field( 'final_value', $post_id ) ),
                        'vehicle_rego'       => sanitize_text_field( get_field( 'vehicle_rego', $post_id ) ),
                );

                return array_filter(
                        $payload,
                        function ( $value ) {
                                return ! is_null( $value ) && $value !== '';
                        }
                );
        }

        /**
         * Send webhook to Zapier.
         *
         * @param int   $post_id The post ID.
         * @param array $payload The payload to send.
         */
        private static function send_webhook( $post_id, $payload ) {
                // Priority: 1. Database option, 2. wp-config.php constant, 3. Fail with error
                $zapier_webhook_url = get_option( 'xero_zapier_webhook_url', '' );
                if ( empty( $zapier_webhook_url ) && defined( 'ZAPIER_WEBHOOK_URL' ) ) {
                        $zapier_webhook_url = ZAPIER_WEBHOOK_URL;
                }

                // No hardcoded fallback - must be configured properly
                if ( empty( $zapier_webhook_url ) ) {
                        error_log( "Curam Xero: No webhook URL configured for post {$post_id} - check wp-config.php ZAPIER_WEBHOOK_URL or Settings page" );
                        $current_details = get_field( 'email_details', $post_id );
                        $error_msg = current_time( 'd/m/y' ) . ': ERROR - Webhook URL not configured, invoice not sent';
                        update_field( 'email_details', $current_details . "\n" . $error_msg, $post_id );
                        return;
                }

                if ( ! filter_var( $zapier_webhook_url, FILTER_VALIDATE_URL ) ) {
                        error_log( 'Curam Xero: Invalid webhook URL configured' );
                        return;
                }

                error_log( "DiamondPlate Xero: Sending webhook for post {$post_id}" );
                error_log( 'DiamondPlate Xero: Payload: ' . wp_json_encode( $payload, JSON_PRETTY_PRINT ) );

                $response = wp_remote_post(
                        $zapier_webhook_url,
                        array(
                                'method'   => 'POST',
                                'headers'  => array( 'Content-Type' => 'application/json' ),
                                'body'     => wp_json_encode( $payload ),
                                'timeout'  => 30,
                                'blocking' => false,
                        )
                );

                if ( is_wp_error( $response ) ) {
                        error_log( "DiamondPlate Xero Webhook Error for post {$post_id}: " . $response->get_error_message() );
                } else {
                        error_log( "DiamondPlate Xero: Webhook sent successfully for post {$post_id}" );
                }
        }
}
