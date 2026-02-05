<?php
/**
 * Curam Payment Checker - Handles cron-based payment status checking
 */

if ( ! defined( 'ABSPATH' ) ) {
        exit;
}

class Curam_Payment_Checker {

        const CRON_HOOK = 'xero_check_payment_status';
        const DEFAULT_INTERVAL_MINUTES = 60;
        const DEFAULT_OVERDUE_DAYS = 10;

        /**
         * Initialize payment checker hooks.
         */
        public static function init() {
                add_filter( 'cron_schedules', array( __CLASS__, 'add_cron_interval' ) );
                add_action( self::CRON_HOOK, array( __CLASS__, 'check_all_invoice_payments' ) );
        }

        /**
         * Register activation hook.
         */
        public static function activate() {
                if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
                        wp_schedule_event( time(), 'xero_check_interval', self::CRON_HOOK );
                        error_log( 'Xero payment check cron scheduled' );
                }
        }

        /**
         * Register deactivation hook.
         */
        public static function deactivate() {
                $timestamp = wp_next_scheduled( self::CRON_HOOK );
                if ( $timestamp ) {
                        wp_unschedule_event( $timestamp, self::CRON_HOOK );
                        error_log( 'Xero payment check cron unscheduled' );
                }
        }

        /**
         * Add custom cron interval.
         *
         * @param array $schedules Existing cron schedules.
         * @return array Modified cron schedules.
         */
        public static function add_cron_interval( $schedules ) {
                $minutes = get_option( 'xero_check_interval', self::DEFAULT_INTERVAL_MINUTES );
                $interval_seconds = $minutes * 60;

                $schedules['xero_check_interval'] = array(
                        'interval' => $interval_seconds,
                        'display'  => sprintf( 'Every %d minutes', $minutes ),
                );

                $schedules['xero_custom_interval'] = array(
                        'interval' => $interval_seconds,
                        'display'  => sprintf( 'Every %d minutes', $minutes ),
                );

                return $schedules;
        }

        /**
         * Check all invoices for payment status from Xero.
         */
        public static function check_all_invoice_payments() {
                error_log( 'Xero payment check cron started' );

                $access_token = Curam_Xero_Api::get_access_token();
                if ( ! $access_token ) {
                        error_log( 'Xero payment check failed: Could not get access token' );
                        return;
                }

                $posts = get_posts(
                        array(
                                'post_type'      => 'clientenquiry',
                                'posts_per_page' => -1,
                                'meta_query'     => array(
                                        'relation' => 'AND',
                                        array(
                                                'key'     => 'enquiry_status',
                                                'value'   => array( 'assigned', 'overdue' ),
                                                'compare' => 'IN',
                                        ),
                                        array(
                                                'key'     => 'xero_invoice_id',
                                                'value'   => '',
                                                'compare' => '!=',
                                        ),
                                ),
                        )
                );

                if ( empty( $posts ) ) {
                        error_log( 'Xero payment check: No posts to check' );
                        return;
                }

                error_log( sprintf( 'Xero payment check: Found %d posts to check', count( $posts ) ) );

                $results = self::process_invoices( $access_token, $posts );

                if ( get_option( 'xero_email_notifications', false ) ) {
                        self::send_notification_email( $results );
                }

                error_log(
                        sprintf(
                                'Xero payment check completed: Checked %d invoices, %d paid, %d overdue',
                                $results['checked'],
                                $results['paid'],
                                $results['overdue']
                        )
                );
        }

        /**
         * Process invoice payment statuses.
         *
         * @param string $access_token The access token.
         * @param array  $posts        Posts to check.
         * @return array Results array.
         */
        private static function process_invoices( $access_token, $posts ) {
                $results = array(
                        'checked' => 0,
                        'paid'    => 0,
                        'overdue' => 0,
                );

                $overdue_threshold = get_option( 'xero_overdue_days', self::DEFAULT_OVERDUE_DAYS );

                foreach ( $posts as $post ) {
                        $invoice_id = get_post_meta( $post->ID, 'xero_invoice_id', true );
                        if ( empty( $invoice_id ) ) {
                                continue;
                        }

                        $results['checked']++;

                        $invoice = Curam_Xero_Api::get_invoice( $access_token, $invoice_id );
                        if ( ! $invoice ) {
                                error_log( sprintf( 'Xero payment check: Failed to get invoice %s for post %d', $invoice_id, $post->ID ) );
                                continue;
                        }

                        $status = sanitize_text_field( $invoice['Status'] ?? '' );
                        $amount_due = (float) ( $invoice['AmountDue'] ?? 0 );

                        if ( $status === 'PAID' && $amount_due < 0.01 ) {
                                self::mark_as_paid( $post->ID, $invoice_id );
                                $results['paid']++;
                        } elseif ( $amount_due > 0.01 ) {
                                if ( self::check_and_mark_overdue( $post->ID, $amount_due, $overdue_threshold ) ) {
                                        $results['overdue']++;
                                }
                        }
                }

                return $results;
        }

        /**
         * Mark post as paid.
         *
         * @param int    $post_id    The post ID.
         * @param string $invoice_id The invoice ID.
         */
        private static function mark_as_paid( $post_id, $invoice_id ) {
                update_field( 'enquiry_status', 'paid', $post_id );
                delete_post_meta( $post_id, 'xero_invoice_overdue_warning' );

                $current_details = get_field( 'email_details', $post_id );
                $date_prefix = current_time( 'd/m/y' ) . ': ';
                $new_entry = $date_prefix . 'Payment Received (Auto) - Status updated to Paid';
                update_field( 'email_details', $current_details . "\n" . $new_entry, $post_id );

                error_log( sprintf( 'Xero payment check: Updated post %d - invoice %s is PAID', $post_id, $invoice_id ) );
        }

        /**
         * Check and mark post as overdue if applicable.
         *
         * @param int   $post_id           The post ID.
         * @param float $amount_due        Outstanding amount.
         * @param int   $overdue_threshold Days threshold.
         * @return bool True if marked overdue.
         */
        private static function check_and_mark_overdue( $post_id, $amount_due, $overdue_threshold ) {
                $invoice_created_date = get_post_meta( $post_id, 'xero_invoice_date', true );
                if ( empty( $invoice_created_date ) ) {
                        return false;
                }

                $created_timestamp = strtotime( $invoice_created_date );
                $today_timestamp = current_time( 'timestamp' );
                $days_since_creation = floor( ( $today_timestamp - $created_timestamp ) / ( 60 * 60 * 24 ) );

                if ( $days_since_creation < $overdue_threshold ) {
                        return false;
                }

                update_field( 'enquiry_status', 'overdue', $post_id );

                $warning_message = sprintf(
                        'Invoice is %d days overdue. Outstanding balance: $%.2f',
                        $days_since_creation,
                        $amount_due
                );
                update_post_meta( $post_id, 'xero_invoice_overdue_warning', $warning_message );

                $current_details = get_field( 'email_details', $post_id );
                $date_prefix = current_time( 'd/m/y' ) . ': ';
                $new_entry = $date_prefix . "Invoice OVERDUE - {$days_since_creation} days past creation, \${$amount_due} outstanding";
                update_field( 'email_details', $current_details . "\n" . $new_entry, $post_id );

                error_log(
                        sprintf(
                                'Xero payment check: Post %d marked OVERDUE - %d days, $%.2f outstanding',
                                $post_id,
                                $days_since_creation,
                                $amount_due
                        )
                );

                return true;
        }

        /**
         * Send notification email with results.
         *
         * @param array $results Check results.
         */
        private static function send_notification_email( $results ) {
                $selected_user_ids = get_option( 'xero_notification_users', array() );
                if ( empty( $selected_user_ids ) ) {
                        error_log( 'Xero: Email notifications enabled but no users selected' );
                        return;
                }

                $emails = array();
                foreach ( $selected_user_ids as $user_id ) {
                        $user = get_user_by( 'id', $user_id );
                        if ( $user && is_email( $user->user_email ) ) {
                                $emails[] = sanitize_email( $user->user_email );
                        }
                }

                if ( empty( $emails ) ) {
                        error_log( 'Xero: No valid email addresses found for selected users' );
                        return;
                }

                $site_name = get_bloginfo( 'name' );
                $subject = sprintf( '[%s] Xero Payment Check Results', $site_name );
                $message = sprintf(
                        "Xero Payment Check Results\n\nChecked: %d\nPaid: %d\nOverdue: %d",
                        $results['checked'],
                        $results['paid'],
                        $results['overdue']
                );

                $headers = array( 'Content-Type: text/html; charset=UTF-8' );

                foreach ( $emails as $email ) {
                        wp_mail( $email, $subject, $message, $headers );
                        error_log( 'Xero: Payment check email sent to [RECIPIENT]' );
                }
        }
}

/**
 * Backwards compatibility wrapper function.
 */
if ( ! function_exists( 'xero_check_all_invoice_payments' ) ) {
        function xero_check_all_invoice_payments() {
                return Curam_Payment_Checker::check_all_invoice_payments();
        }
}
