<?php
/**
 * Plugin Name:  Curam-Ai Xero Integration
 * Plugin URI:   https://curam-ai.com.au
 * Description:  Handles Webhooks and REST API for Xero Invoicing. Includes phone cleaning, name prioritization, field validation, and automated status logging.
 * Version:      2.1.0
 * Author:       Curam Ai
 * Author URI:   https://curam-ai.com.au
 * License:      GPL2
 * Text Domain:  curam-ai-xero
 *
 * SECURITY CONFIGURATION:
 * Add these constants to wp-config.php (above "That's all, stop editing!" line):
 *
 * define('XERO_CLIENT_ID', 'your-xero-client-id');
 * define('XERO_CLIENT_SECRET', 'your-xero-client-secret');
 * define('ZAPIER_WEBHOOK_URL', 'https://hooks.zapier.com/hooks/catch/YOUR_WEBHOOK_ID/');
 * define('ZAPIER_SECRET_KEY', 'your-random-32-character-secret-key-here');
 *
 * CHANGELOG v2.1.0:
 * - Complete plugin refactoring: Reduced main file from 3000+ lines to ~50 lines
 * - Organized into proper class structure following WordPress coding standards
 * - All functionality preserved with backward compatibility wrappers
 * - Improved maintainability and testability
 * 
 * CHANGELOG v2.0.0:
 * - Stage 1-3 Refactoring: Extracted all components to separate class files
 * - Core classes: Helpers, API, OAuth, Webhook Handler, REST API, Payment Checker
 * - Admin classes: Menu, Notices, Dashboard Functions
 * - Backward compatible: All old function names still work
 *
 * CHANGELOG v1.5:
 * - Added automatic overdue invoice detection
 * - Invoices marked overdue if outstanding balance > $0.01 and 10+ days past creation
 * - Status automatically set to 'overdue' with prominent admin warning banner
 * - Overdue warning cleared automatically when payment received
 */

if ( ! defined( 'WPINC' ) ) {
	die;
}

/**
 * Initialize the Curam Xero plugin.
 * 
 * This main file now only handles:
 * 1. Loading the main plugin class
 * 2. Plugin activation/deactivation hooks
 * 3. Initializing the plugin instance
 */

// Load the main plugin class
require_once plugin_dir_path( __FILE__ ) . 'includes/class-curam-xero.php';

/**
 * Plugin activation hook.
 */
function activate_curam_xero_plugin() {
	Curam_Xero::activate();
}
register_activation_hook( __FILE__, 'activate_curam_xero_plugin' );

/**
 * Plugin deactivation hook.
 */
function deactivate_curam_xero_plugin() {
	Curam_Xero::deactivate();
}
register_deactivation_hook( __FILE__, 'deactivate_curam_xero_plugin' );

/**
 * Initialize the plugin.
 */
function run_curam_xero_plugin() {
	return Curam_Xero::instance();
}

// Start the plugin
run_curam_xero_plugin();
