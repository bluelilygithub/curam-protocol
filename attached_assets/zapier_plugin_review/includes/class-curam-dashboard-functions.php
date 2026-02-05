<?php
/**
 * Curam Dashboard Functions - Statistics and reporting
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Curam_Dashboard_Functions {

	/**
	 * Get dashboard statistics.
	 *
	 * @return array Statistics array.
	 */
	public static function get_stats() {
		global $wpdb;
		
		$total_invoices = $wpdb->get_var(
			"SELECT COUNT(DISTINCT post_id) 
			FROM {$wpdb->postmeta} 
			WHERE meta_key = 'xero_invoice_id' 
			AND meta_value != ''"
		);
		
		$total_assigned = $wpdb->get_var(
			"SELECT COUNT(*) 
			FROM {$wpdb->postmeta} 
			WHERE meta_key = 'enquiry_status' 
			AND meta_value IN ('assigned', 'overdue', 'paid')"
		);
		
		$assigned_with_invoice = $wpdb->get_var(
			"SELECT COUNT(DISTINCT pm1.post_id)
			FROM {$wpdb->postmeta} pm1
			INNER JOIN {$wpdb->postmeta} pm2 ON pm1.post_id = pm2.post_id
			WHERE pm1.meta_key = 'enquiry_status'
			AND pm1.meta_value IN ('assigned', 'overdue', 'paid')
			AND pm2.meta_key = 'xero_invoice_id'
			AND pm2.meta_value != ''"
		);
		
		$success_rate = $total_assigned > 0 ? ( $assigned_with_invoice / $total_assigned ) * 100 : 0;
		
		$overdue_count = $wpdb->get_var(
			"SELECT COUNT(*) 
			FROM {$wpdb->postmeta} 
			WHERE meta_key = 'enquiry_status' 
			AND meta_value = 'overdue'"
		);
		
		$overdue_amount = $wpdb->get_var(
			"SELECT SUM(CAST(pm.meta_value AS DECIMAL(10,2)))
			FROM {$wpdb->postmeta} pm
			WHERE pm.meta_key = 'final_value'
			AND pm.post_id IN (
				SELECT post_id FROM {$wpdb->postmeta} 
				WHERE meta_key = 'enquiry_status' AND meta_value = 'overdue'
			)"
		);
		
		$paid_this_month = $wpdb->get_var( $wpdb->prepare(
			"SELECT COUNT(DISTINCT pm1.post_id)
			FROM {$wpdb->postmeta} pm1
			INNER JOIN {$wpdb->postmeta} pm2 ON pm1.post_id = pm2.post_id
			WHERE pm1.meta_key = 'enquiry_status'
			AND pm1.meta_value = 'paid'
			AND pm2.meta_key = 'xero_invoice_date'
			AND pm2.meta_value >= %s",
			date( 'Y-m-01' )
		) );
		
		$status_counts = $wpdb->get_results(
			"SELECT meta_value as status, COUNT(*) as count
			FROM {$wpdb->postmeta}
			WHERE meta_key = 'enquiry_status'
			GROUP BY meta_value
			ORDER BY count DESC",
			OBJECT_K
		);
		
		$formatted_counts = array();
		foreach ( $status_counts as $status => $row ) {
			$formatted_counts[ $status ] = intval( $row->count );
		}
		
		return array(
			'total_invoices' => intval( $total_invoices ),
			'total_assigned' => intval( $total_assigned ),
			'assigned_with_invoice' => intval( $assigned_with_invoice ),
			'success_rate' => floatval( $success_rate ),
			'overdue_count' => intval( $overdue_count ),
			'overdue_amount' => floatval( $overdue_amount ?: 0 ),
			'paid_this_month' => intval( $paid_this_month ),
			'status_counts' => $formatted_counts,
		);
	}

	/**
	 * Get recent invoice activity.
	 *
	 * @param int $limit Number of activities to return.
	 * @return array Recent activities.
	 */
	public static function get_recent_activity( $limit = 10 ) {
		global $wpdb;
		
		$results = $wpdb->get_results( $wpdb->prepare(
			"SELECT p.ID as post_id, p.post_title as title, 
					pm1.meta_value as invoice_date,
					pm2.meta_value as invoice_number,
					pm3.meta_value as status
			FROM {$wpdb->posts} p
			INNER JOIN {$wpdb->postmeta} pm1 ON p.ID = pm1.post_id AND pm1.meta_key = 'xero_invoice_date'
			LEFT JOIN {$wpdb->postmeta} pm2 ON p.ID = pm2.post_id AND pm2.meta_key = 'xero_invoice_number'
			LEFT JOIN {$wpdb->postmeta} pm3 ON p.ID = pm3.post_id AND pm3.meta_key = 'enquiry_status'
			WHERE p.post_type = 'clientenquiry'
			ORDER BY pm1.meta_value DESC
			LIMIT %d",
			$limit
		), ARRAY_A );
		
		return array_map( function( $row ) {
			return array(
				'post_id' => $row['post_id'],
				'title' => $row['title'],
				'date' => $row['invoice_date'],
				'invoice_number' => $row['invoice_number'],
				'status' => $row['status'] ?: 'unknown',
			);
		}, $results ?: array() );
	}
}

/**
 * Backwards compatibility wrapper functions.
 */
if ( ! function_exists( 'xero_get_dashboard_stats' ) ) {
	function xero_get_dashboard_stats() {
		return Curam_Dashboard_Functions::get_stats();
	}
}

if ( ! function_exists( 'xero_get_recent_activity' ) ) {
	function xero_get_recent_activity( $limit = 10 ) {
		return Curam_Dashboard_Functions::get_recent_activity( $limit );
	}
}
