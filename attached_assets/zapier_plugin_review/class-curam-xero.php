<?php
/**
 * Main Curam Xero Plugin Class
 *
 * Orchestrates all plugin components and handles initialization.
 */

if ( ! defined( 'ABSPATH' ) ) {
        exit;
}

class Curam_Xero {

        /**
         * Plugin version.
         *
         * @var string
         */
        const VERSION = '2.1.0';

        /**
         * Single instance of the class.
         *
         * @var Curam_Xero
         */
        private static $instance = null;

        /**
         * Get single instance.
         *
         * @return Curam_Xero
         */
        public static function instance() {
                if ( is_null( self::$instance ) ) {
                        self::$instance = new self();
                }
                return self::$instance;
        }

        /**
         * Constructor.
         */
        private function __construct() {
                $this->define_constants();
                $this->includes();
                $this->init_hooks();
        }

        /**
         * Define plugin constants.
         */
        private function define_constants() {
                if ( ! defined( 'CURAM_XERO_VERSION' ) ) {
                        define( 'CURAM_XERO_VERSION', self::VERSION );
                }
                if ( ! defined( 'CURAM_XERO_PATH' ) ) {
                        define( 'CURAM_XERO_PATH', plugin_dir_path( dirname( __FILE__ ) ) );
                }
                if ( ! defined( 'CURAM_XERO_URL' ) ) {
                        define( 'CURAM_XERO_URL', plugin_dir_url( dirname( __FILE__ ) ) );
                }
                if ( ! defined( 'XERO_CHECK_INTERVAL_MINUTES' ) ) {
                        define( 'XERO_CHECK_INTERVAL_MINUTES', 60 );
                }
        }

        /**
         * Include required files.
         */
        private function includes() {
                // Core classes
                require_once CURAM_XERO_PATH . 'includes/class-curam-helpers.php';
                require_once CURAM_XERO_PATH . 'includes/class-curam-xero-api.php';
                require_once CURAM_XERO_PATH . 'includes/class-curam-xero-oauth.php';
                require_once CURAM_XERO_PATH . 'includes/class-curam-webhook-handler.php';
                require_once CURAM_XERO_PATH . 'includes/class-curam-rest-api.php';
                require_once CURAM_XERO_PATH . 'includes/class-curam-payment-checker.php';
                require_once CURAM_XERO_PATH . 'includes/class-curam-dashboard-functions.php';

                // Admin classes
                require_once CURAM_XERO_PATH . 'includes/class-curam-admin-notices.php';
                require_once CURAM_XERO_PATH . 'includes/class-curam-admin-menu.php';
        }

        /**
         * Initialize hooks.
         */
        private function init_hooks() {
                // Initialize components
                add_action( 'plugins_loaded', array( $this, 'init_components' ) );

                // ACF filter for phone validation
                add_filter( 'acf/validate_value/name=phone', array( 'Curam_Helpers', 'validate_phone_number' ), 10, 4 );

                // Admin UI hooks
                add_action( 'acf/render_field/name=enquiry_status', array( $this, 'show_xero_invoice_link' ) );
        }

        /**
         * Initialize plugin components.
         */
        public function init_components() {
                Curam_Xero_Oauth::init();
                Curam_Webhook_Handler::init();
                Curam_Rest_Api::init();
                Curam_Payment_Checker::init();
                Curam_Admin_Notices::init();
                Curam_Admin_Menu::init();
        }

        /**
         * Display Xero invoice link in admin editor.
         *
         * @param array $field ACF field configuration.
         */
        public function show_xero_invoice_link( $field ) {
                global $post;
                if ( ! $post || ! $post->ID ) {
                        return;
                }

                $invoice_id = get_post_meta( $post->ID, 'xero_invoice_id', true );
                $invoice_number = get_post_meta( $post->ID, 'xero_invoice_number', true );
                $invoice_url = get_post_meta( $post->ID, 'xero_invoice_url', true );
                $overdue_warning = get_post_meta( $post->ID, 'xero_invoice_overdue_warning', true );

                if ( $invoice_id ) {
                        echo '<div style="margin-top: 10px; padding: 12px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; color: #155724;">';
                        echo '<strong>✓ Xero Invoice Created: </strong>';
                        echo '<a href="' . esc_url( $invoice_url ) . '" target="_blank" style="font-weight:bold; color:#155724;">' . esc_html( $invoice_number ) . '</a>';
                        echo '</div>';
                }

                if ( ! empty( $overdue_warning ) ) {
                        echo '<div style="margin-top: 10px; padding: 12px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; color: #721c24;">';
                        echo '<strong>⚠ OVERDUE:</strong> ' . esc_html( $overdue_warning );
                        echo '</div>';
                }
        }

        /**
         * Plugin activation.
         */
        public static function activate() {
                // Load payment checker if not already loaded (activation happens before includes())
                if ( ! class_exists( 'Curam_Payment_Checker' ) ) {
                        require_once plugin_dir_path( __FILE__ ) . 'class-curam-payment-checker.php';
                }
                Curam_Payment_Checker::activate();
        }

        /**
         * Plugin deactivation.
         */
        public static function deactivate() {
                // Load payment checker if not already loaded
                if ( ! class_exists( 'Curam_Payment_Checker' ) ) {
                        require_once plugin_dir_path( __FILE__ ) . 'class-curam-payment-checker.php';
                }
                Curam_Payment_Checker::deactivate();
        }
}
