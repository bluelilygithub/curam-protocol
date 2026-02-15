<?php
/**
 * Curam Admin Menu - Registers admin menu pages
 */

if ( ! defined( 'ABSPATH' ) ) {
        exit;
}

class Curam_Admin_Menu {

        /**
         * Initialize admin menu hooks.
         */
        public static function init() {
                add_action( 'admin_menu', array( __CLASS__, 'register_menu' ) );
        }

        /**
         * Register the unified Xero admin menu.
         */
        public static function register_menu() {
                if ( ! current_user_can( 'manage_options' ) ) {
                        return;
                }

                add_menu_page(
                        'Xero Management',
                        'Xero',
                        'manage_options',
                        'xero-dashboard',
                        array( __CLASS__, 'render_dashboard_page' ),
                        'dashicons-chart-line',
                        30
                );

                add_submenu_page(
                        'xero-dashboard',
                        'Dashboard',
                        'Dashboard',
                        'manage_options',
                        'xero-dashboard',
                        array( __CLASS__, 'render_dashboard_page' )
                );

                add_submenu_page(
                        'xero-dashboard',
                        'Status Checker',
                        'Status Checker',
                        'manage_options',
                        'xero-status-checker',
                        array( __CLASS__, 'render_status_checker_page' )
                );

                add_submenu_page(
                        'xero-dashboard',
                        'Xero Authorization',
                        'Authorization',
                        'manage_options',
                        'xero-authorization',
                        array( __CLASS__, 'render_authorization_page' )
                );

                add_submenu_page(
                        'xero-dashboard',
                        'Xero Settings',
                        'Settings',
                        'manage_options',
                        'xero-settings',
                        array( __CLASS__, 'render_settings_page' )
                );

                add_submenu_page(
                        'xero-dashboard',
                        'SQL Testing',
                        'Testing & Diagnostics',
                        'manage_options',
                        'xero-sql-testing',
                        array( __CLASS__, 'render_sql_testing_page' )
                );

                add_submenu_page(
                        'xero-dashboard',
                        'Documentation & Tutorials',
                        'Documentation',
                        'manage_options',
                        'xero-documentation',
                        array( __CLASS__, 'render_documentation_page' )
                );
        }

        /**
         * Render dashboard page.
         */
        public static function render_dashboard_page() {
                if ( ! current_user_can( 'manage_options' ) ) {
                        return;
                }
                include CURAM_XERO_PATH . 'admin/views/dashboard.php';
        }

        /**
         * Render status checker page.
         */
        public static function render_status_checker_page() {
                if ( ! current_user_can( 'manage_options' ) ) {
                        return;
                }
                include CURAM_XERO_PATH . 'admin/views/status-checker.php';
        }

        /**
         * Render authorization page.
         */
        public static function render_authorization_page() {
                if ( ! current_user_can( 'manage_options' ) ) {
                        return;
                }
                include CURAM_XERO_PATH . 'admin/views/authorization.php';
        }

        /**
         * Render settings page.
         */
        public static function render_settings_page() {
                if ( ! current_user_can( 'manage_options' ) ) {
                        return;
                }
                include CURAM_XERO_PATH . 'admin/views/settings.php';
        }

        /**
         * Render SQL testing page.
         */
        public static function render_sql_testing_page() {
                if ( ! current_user_can( 'manage_options' ) ) {
                        return;
                }
                include CURAM_XERO_PATH . 'admin/views/sql-testing.php';
        }

        /**
         * Render documentation page.
         */
        public static function render_documentation_page() {
                if ( ! current_user_can( 'manage_options' ) ) {
                        return;
                }
                include CURAM_XERO_PATH . 'admin/views/documentation.php';
        }
}
