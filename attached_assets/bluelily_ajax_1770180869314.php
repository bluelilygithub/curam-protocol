<?php

// If this file is called directly, abort.
if ( ! defined( 'WPINC' ) ) {
  die;
}



add_action('wp_ajax_get_techician_data', 'get_techician_data');
function get_techician_data() {
  if (wp_doing_ajax()) {
    // Sanitize user inputs
    $state = sanitize_text_field($_POST['state']);
    $filter_by_field = filter_var($_POST['filter_by_field'], FILTER_VALIDATE_BOOLEAN); // Sanitize and validate checkbox state

    $meta_query = array(
      array(
        'key' => 'user_state', // Replace with your ACF field name
        'compare' => '=',
        'value' => $state
      )
    );

    // Add additional filter if checkbox is checked
    if ($filter_by_field) {
      $meta_query[] = array(
        'key' => 'remoteonly_option', // Filter based on remoteonly_option
        'compare' => '=',
        'value' => '1' // Assuming 'True' is stored as '1'
      );
    }

    $args = array(
      'role' => 'technician',
      'meta_query' => $meta_query,
      'fields' => array('ID', 'display_name') // Retrieve user ID and display name
    );

    $technicians = get_users($args);

    $options = array();
    if (!empty($technicians)) {
      foreach ($technicians as $user) {
        $remote_only = get_user_meta($user->ID, 'remoteonly_option', true); // Get the value of 'remote-only' ACF field

        $display_name = $user->display_name;
        if (!$remote_only) {
          $display_name .= ' (both)';
        }

        $options[] = array(
          'value' => $user->ID,
          'text' => $display_name
        );
      }
    } else {
      error_log('No technicians found'); // Debugging: log if no technicians found
    }

    wp_send_json_success($options);
  } else {
    wp_die('Not an AJAX request');
  }
}


/*------------------------------------------------------------------------------------*/


add_action('wp_ajax_get_daterange', 'get_daterange');
function get_daterange() {
    // Get the start and end dates from the AJAX request
    $start_date = $_POST['start_date'];
    $end_date = $_POST['end_date'];

    // Perform your query
    $query = new WP_Query(array(
        'post_type'      => 'clientenquiry',
        'posts_per_page' => -1,
        'post_status'    => 'publish', // Filter only published posts
        'date_query'     => array(
            'after'     => $start_date . ' 00:00:00',
            'before'    => $end_date . ' 23:59:59',
            'inclusive' => true, // Include posts published on the end date
        ),
    ));

    // Get the count
    $count = $query->found_posts;

    // Return the count
    echo 'Total records published between ' . $start_date . ' and ' . $end_date . ': ' . $count;

    // Don't forget to exit after echoing the response
    wp_die();
}


/*------------------------------------------------------------------------------------*/

add_action('wp_ajax_get_package_status_totals', 'get_package_status_totals');
function get_package_status_totals() {
global $wpdb;

    // Get the start and end dates from the AJAX request
    $start_date = $_POST['start_date'];
    $end_date = $_POST['end_date'];

    
    // Perform a query to fetch published records from the 'clientenquiry' custom post type
    $query_args = array(
        'post_type'      => 'clientenquiry',
        'posts_per_page' => -1,
        'post_status'    => 'publish', // Filter only published posts
        'date_query'     => array(
            'after'     => $start_date . ' 00:00:00',
            'before'    => $end_date . ' 23:59:59',
            'inclusive' => true, // Include posts published on the end date
        ),
    );

    $query = new WP_Query($query_args);

    // Initialize response array
    $state_totals = array();


     if ($query->have_posts()) {
        while ($query->have_posts()) {
            $query->the_post();
            $state = get_field('state'); // Assuming 'state' is an ACF field
            $package = get_field('package_type'); // Assuming 'package_type' is an ACF field
            $status = get_field('enquiry_status'); // Assuming 'enquiry_status' is an ACF field
            $final_value = get_field('final_value'); // Assuming 'final_value' is an ACF field
            
            // Increment count for state, package, status combination, and store final value
            if (!isset($state_totals[$state][$package][$status])) {
                $state_totals[$state][$package][$status] = array('count' => 1, 'final_value' => $final_value);
            } else {
                $state_totals[$state][$package][$status]['count']++;
                $state_totals[$state][$package][$status]['final_value'] += $final_value;
            }
        }
    }




    // Reset post data
    wp_reset_postdata();

    // Return the response
    echo json_encode($state_totals);

    // Don't forget to exit after echoing the response
    wp_die();
}


/*------------------------------------------------------------------------------------*/

function get_technician_totals() {
    global $wpdb;

    // Define the specific date range
 //   $start_date = '2024-08-14';
 //   $end_date = '2024-08-20';

     $start_date = $_POST['start_date'];
    $end_date = $_POST['end_date'];

    // Perform a query to fetch records from the 'clientenquiry' custom post type
    $query_args = array(
        'post_type'      => 'clientenquiry',
        'posts_per_page' => -1,
        'date_query'     => array(
            array(
                'after'     => $start_date,
                'before'    => $end_date,
                'inclusive' => true, // Include posts published on the start and end dates
            ),
        ),
        'meta_query' => array(
            array(
                'key' => 'enquiry_status',
                'value' => array('completed', 'assigned'),
                'compare' => 'IN'
            )
        )
    );

    $query = new WP_Query($query_args);

    // Log the number of returned records
  //  error_log('Number of records returned: ' . $query->found_posts);

    // Initialize response array and totals
    $technician_totals = array();
    $total_assigned_count = 0;
    $total_completed_count = 0;
    $total_assigned_value_sum = 0;
    $total_completed_value_sum = 0;
    $total_days = 0;
    $total_jobs = 0;

    // Tracking which technicians have been processed
    $processed_technicians = array();

    if ($query->have_posts()) {
        while ($query->have_posts()) {
            $query->the_post();
            $technician_id = get_field('technician');
            $technician_user = get_userdata($technician_id);
            $technician_name = $technician_user ? $technician_user->display_name : 'Unknown Technician';

            $status = get_field('enquiry_status');
            $state = get_field('state');
            $final_value = get_field('final_value');

            // Check if this technician has already been processed
            if (!isset($processed_technicians[$technician_name])) {
                $processed_technicians[$technician_name] = array(
                    'technician' => $technician_name,
                    'state' => $state,
                    'assigned_count' => 0,
                    'completed_count' => 0,
                    'assigned_value_sum' => 0,
                    'completed_value_sum' => 0,
                    'completion_times' => array()
                );
            }

            // Process the record
            if ($status == 'assigned') {
                $processed_technicians[$technician_name]['assigned_count']++;
                $processed_technicians[$technician_name]['assigned_value_sum'] += $final_value;
                $total_assigned_count++;
                $total_assigned_value_sum += $final_value;
            } elseif ($status == 'completed') {
                $processed_technicians[$technician_name]['completed_count']++;
                $processed_technicians[$technician_name]['completed_value_sum'] += $final_value;
                $total_completed_count++;
                $total_completed_value_sum += $final_value;
            }

            // Logging each technician's data
         //   error_log("Technician: $technician_name, Assigned Count: " . $processed_technicians[$technician_name]['assigned_count']);
        }
    }

    // Prepare the final data
    $final_data = array();
    foreach ($processed_technicians as $technician_name => $data) {
        $final_data[] = array(
            'technician' => $technician_name,
            'state' => $data['state'],
            'assigned_count' => $data['assigned_count'],
            'completed_count' => $data['completed_count'],
            'assigned_value_sum' => '$' . number_format($data['assigned_value_sum'], 0),
            'completed_value_sum' => '$' . number_format($data['completed_value_sum'], 0),
            'total_value_sum' => '$' . number_format($data['assigned_value_sum'] + $data['completed_value_sum'], 0),
        );
    }

    // Correctly calculate the summary row
    $summary_row = array(
        'technician' => 'Total',
        'state' => '',
        'assigned_count' => $total_assigned_count,
        'completed_count' => $total_completed_count,
        'assigned_value_sum' => '$' . number_format($total_assigned_value_sum, 0),
        'completed_value_sum' => '$' . number_format($total_completed_value_sum, 0),
        'total_value_sum' => '$' . number_format($total_assigned_value_sum + $total_completed_value_sum, 0),
    );

    $final_data[] = $summary_row;

    echo json_encode($final_data);

    wp_die();
}

add_action('wp_ajax_get_technician_totals', 'get_technician_totals');
add_action('wp_ajax_nopriv_get_technician_totals', 'get_technician_totals');



/*------------------------------------------------------------------------------------*/
add_action('wp_ajax_get_salesrep_totals', 'get_salesrep_totals');

function get_salesrep_totals() {
    global $wpdb;

    // Get the start and end dates from the AJAX request
    $start_date = isset($_POST['start_date']) ? sanitize_text_field($_POST['start_date']) : '';
    $end_date = isset($_POST['end_date']) ? sanitize_text_field($_POST['end_date']) : '';

    // Initialize response array
    $sales_rep_totals = array();

    // Perform a query to fetch published records from the 'clientenquiry' custom post type
    $query_args = array(
        'post_type'      => 'clientenquiry',
        'posts_per_page' => -1,
        'post_status'    => 'publish', // Filter only published posts
        'date_query'     => array(
            'after'     => $start_date . ' 00:00:00',
            'before'    => $end_date . ' 23:59:59',
            'inclusive' => true, // Include posts published on the end date
        ),
    );

    $query = new WP_Query($query_args);

    if ($query->have_posts()) {
        while ($query->have_posts()) {
            $query->the_post();
            $selected_sales_rep = get_field('sales_rep'); // Assuming 'sales_rep' is an ACF field storing user ID

            // Increment count for selected sales rep and enquiry status combination
            if (!empty($selected_sales_rep)) {
                if (is_array($selected_sales_rep)) {
                    // Get the sales rep's display name from the array
                    $sales_rep_name = $selected_sales_rep['display_name'];
                } else {
                    // Handle cases where $selected_sales_rep is not an array
                    $user = get_userdata($selected_sales_rep);
                    $sales_rep_name = $user->display_name;
                }

                // Get the enquiry status
                $status = get_field('enquiry_status'); // Assuming 'enquiry_status' is an ACF field

                // Increment count for the sales rep and enquiry status
                if (!isset($sales_rep_totals[$sales_rep_name][$status])) {
                    $sales_rep_totals[$sales_rep_name][$status] = 1;
                } else {
                    $sales_rep_totals[$sales_rep_name][$status]++;
                }
            }
        }
    }

    // Reset post data
    wp_reset_postdata();

    // Return the response
    echo json_encode($sales_rep_totals);

    // Don't forget to exit after echoing the response
    wp_die();
}

/* ------------------------------------------------------------------------------ */
/*------------------------------------------------------------------------------------*/

add_action('wp_ajax_get_prodsBystate_totals', 'get_prodsBystate_totals');

function get_prodsBystate_totals() {
    global $wpdb;

    // Get the start and end dates from the AJAX request
    $start_date = isset($_POST['start_date']) ? sanitize_text_field($_POST['start_date']) : '';
    $end_date = isset($_POST['end_date']) ? sanitize_text_field($_POST['end_date']) : '';

    // Initialize response array
    $sales_rep_totals = array();

    // Perform a query to fetch published records from the 'clientenquiry' custom post type
    $query_args = array(
        'post_type'      => 'clientenquiry',
        'posts_per_page' => -1,
        'post_status'    => 'publish', // Filter only published posts
        'date_query'     => array(
            'after'     => $start_date . ' 00:00:00',
            'before'    => $end_date . ' 23:59:59',
            'inclusive' => true, // Include posts published on the end date
        ),
    );

    $query = new WP_Query($query_args);

    if ($query->have_posts()) {
        while ($query->have_posts()) {
        $query->the_post();
        
        // Get the state for the current post
        $state = get_field('state');

        // Get the products for the current post
        $products = get_field('products');

        // Increment the count for each product within the current state
        foreach ($products as $product) {
            if (!isset($product_counts_by_state[$state][$product])) {
                // Initialize count if it's not set yet
                $product_counts_by_state[$state][$product] = 1;
            } else {
                // Increment count if it's already set
                $product_counts_by_state[$state][$product]++;
            }
        }
    }
    }

    // Reset post data
    wp_reset_postdata();

    // Return the response
    echo json_encode($product_counts_by_state);

    // Don't forget to exit after echoing the response
    wp_die();
}

/* ------------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------------ */


add_action('wp_ajax_get_completed_enquiries', 'get_completed_enquiries');

function get_completed_enquiries() {
    // Get the start and end dates from the AJAX request
    $start_date = isset($_POST['start_date']) ? sanitize_text_field($_POST['start_date']) : '';
    $end_date = isset($_POST['end_date']) ? sanitize_text_field($_POST['end_date']) : '';

    // Initialize response array
    $completed_enquiries = array();

    // Perform a query to fetch published records from the 'clientenquiry' custom post type
    $query_args = array(
        'post_type'      => 'clientenquiry',
        'posts_per_page' => -1,
        'post_status'    => 'publish', // Filter only published posts
        'meta_query'     => array(
            array(
                'key'     => 'completion_date',
                'value'   => array($start_date . ' 00:00:00', $end_date . ' 23:59:59'),
                'compare' => 'BETWEEN',
                'type'    => 'DATETIME'
            ),
        ),
    );

    $query = new WP_Query($query_args);

    if ($query->have_posts()) {
        while ($query->have_posts()) {
            $query->the_post();
            
            // Get the enquiry_status for the current post
            $enquiry_status = get_field('enquiry_status');

            // Only collect posts with enquiry_status == 'completed'
            if ($enquiry_status === 'completed') {
                $selected_sales_rep = get_field('sales_rep'); // Assuming 'sales_rep' is an ACF field storing user ID

                if (is_array($selected_sales_rep)) {
                    $sales_rep_name = $selected_sales_rep['display_name'];
                } else {
                    $user = get_userdata($selected_sales_rep);
                    $sales_rep_name = $user->display_name;
                }

                $sales_value = get_field('final_value');
                $sales_value = is_numeric($sales_value) ? floatval($sales_value) : 0;

                // Group by sales rep and accumulate sales value and row count
                if (!isset($completed_enquiries[$sales_rep_name])) {
                    $completed_enquiries[$sales_rep_name] = array(
                        'total_sales_value' => 0,
                        'row_count' => 0,
                    );
                }

                $completed_enquiries[$sales_rep_name]['total_sales_value'] += $sales_value;
                $completed_enquiries[$sales_rep_name]['row_count'] += 1;
            }
        }
    }

    // Reset post data
    wp_reset_postdata();

    // Return the response
    echo json_encode($completed_enquiries);

    // Don't forget to exit after echoing the response
    wp_die();
}



/* ------------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------------ */

// Function to update technician details
function get_technician_details() {
    if (isset($_POST['selected_value'])) {
        $value = sanitize_text_field($_POST['selected_value']);

        if (!empty($value)) {
            $tech_id = $value;
            $tech_user = get_userdata($tech_id);

            if ($tech_user) {
                $user_phone = get_user_meta($tech_id, 'user_phone', true);
                $user_email = $tech_user->user_email;
                $company_id = get_user_meta($tech_id, 'company_name', true); // Fetch company post ID

                // Fetch the partner_address using the company_id
                $partner_address = get_post_meta($company_id, 'partner_address', true);

                // Default values if not set
                $user_phone = $user_phone ?: 'N/A';
                $partner_address = $partner_address ?: 'N/A';

                $response = array(
                    'success' => true,
                    'phone' => $user_phone,
                    'email' => $user_email,
                    'partner_address' => $partner_address // Include partner address in response
                );

                wp_send_json($response);
            } else {
                wp_send_json_error('Technician user not found');
            }
        } else {
            wp_send_json_error('Invalid value');
        }
    } else {
        wp_send_json_error('Selected value not set');
    }

    wp_die();
}

add_action('wp_ajax_get_technician_details', 'get_technician_details');
add_action('wp_ajax_nopriv_get_technician_details', 'get_technician_details');





/* ------------------------------------------------------------------------------ */

function get_product_titles_ajax() {
    if (!isset($_POST['product_ids']) || !is_array($_POST['product_ids'])) {
        wp_send_json_error('Product IDs are missing or invalid');
    }

    $product_ids = array_map('intval', $_POST['product_ids']);
    $titles = array();

    foreach ($product_ids as $id) {
        $titles[$id] = get_the_title($id);
    }

    wp_send_json_success($titles);
}
add_action('wp_ajax_get_product_titles_ajax', 'get_product_titles_ajax');
add_action('wp_ajax_nopriv_get_product_titles_ajax', 'get_product_titles_ajax');



/* ------------------------------------------------------------------------------ */

function get_product_prices() {
    if (isset($_POST['product_ids'])) {
        $product_ids = $_POST['product_ids'];
        $prices = array();

        foreach ($product_ids as $product_id) {
            $price = get_field('product_price', $product_id);
            if ($price) {
                $prices[$product_id] = $price;
            }
        }

        echo json_encode($prices);
    }

    wp_die();
}
add_action('wp_ajax_get_product_prices', 'get_product_prices');
add_action('wp_ajax_nopriv_get_product_prices', 'get_product_prices');


/* ----------------------------------------------------------------------------------------- */
function get_avgActionTime() {
    global $wpdb;

    // Get the start and end dates from the AJAX request
    $start_date = $_POST['start_date'];
    $end_date = $_POST['end_date'];

    // Perform a query to fetch records from the 'clientenquiry' custom post type
    $query_args = array(
        'post_type'      => 'clientenquiry',
        'posts_per_page' => -1,
        'date_query'     => array(
            'after'     => date('Y-m-d', strtotime($start_date)),
            'before'    => date('Y-m-d', strtotime($end_date)),
            'inclusive' => true, // Include posts published on the end date
        ),
        'meta_query' => array(
            array(
                'key' => 'enquiry_status',
                'value' => array('completed', 'assigned'),
                'compare' => 'IN'
            )
        )
    );

    $query = new WP_Query($query_args);

    // Initialize response array
    $state_totals = array();
    $total_completed_jobs = 0;
    $total_assigned_jobs = 0;
    $total_completed_value = 0;
    $total_assigned_value = 0;

    if ($query->have_posts()) {
        while ($query->have_posts()) {
            $query->the_post();
            $state = get_field('state'); // Assuming 'state' is an ACF field
            $status = get_field('enquiry_status'); // Get the enquiry status
            $contacted_date = get_field('contacted_date'); // Assuming 'contacted_date' is an ACF field
            $invoiced_date = get_field('invoiced_date'); // Assuming 'invoiced_date' is an ACF field
            $completion_date = get_field('completion_date'); // Assuming 'completion_date' is an ACF field
            $final_value = get_field('final_value'); // Assuming 'final_value' is an ACF field

            // Convert dates to a consistent format (Y-m-d) for calculation
            $contacted_date = !empty($contacted_date) ? date('Y-m-d', strtotime(str_replace('/', '-', $contacted_date))) : null;
            $invoiced_date = !empty($invoiced_date) ? date('Y-m-d', strtotime(str_replace('/', '-', $invoiced_date))) : null;
            $completion_date = !empty($completion_date) ? date('Y-m-d', strtotime(str_replace('/', '-', $completion_date))) : null;

            // Initialize state if not set
            if (!isset($state_totals[$state])) {
                $state_totals[$state] = array(
                    'diff1' => array(),
                    'diff2' => array(),
                    'assigned_diff' => array(),
                    'count' => 0,
                    'assigned_count' => 0,
                    'completed_value_sum' => 0,
                    'assigned_value_sum' => 0
                );
            }

            // Calculate days from contacted to invoiced
            if ($contacted_date && $invoiced_date) {
                $date_diff1 = (strtotime($invoiced_date) - strtotime($contacted_date)) / (60 * 60 * 24);
                $state_totals[$state]['diff1'][] = $date_diff1;
            }

            // Calculate days from invoiced to completed for completed records
            if ($status == 'completed' && $invoiced_date && $completion_date) {
                $date_diff2 = (strtotime($completion_date) - strtotime($invoiced_date)) / (60 * 60 * 24);
                $state_totals[$state]['diff2'][] = $date_diff2;
                $state_totals[$state]['completed_value_sum'] += $final_value;
                $total_completed_value += $final_value;

                // Increment count for the state
                $state_totals[$state]['count']++;
                $total_completed_jobs++;
            }

            // Calculate days from assigned to current date for uncompleted records
            if ($status == 'assigned' && $invoiced_date) {
                $date_diff_assigned = (strtotime(date('Y-m-d')) - strtotime($invoiced_date)) / (60 * 60 * 24);
                $state_totals[$state]['assigned_diff'][] = $date_diff_assigned;
                $state_totals[$state]['assigned_value_sum'] += $final_value;
                $total_assigned_value += $final_value;

                // Increment assigned count for the state
                $state_totals[$state]['assigned_count']++;
                $total_assigned_jobs++;
            }
        }
    }

    // Calculate averages and combined average
    $averages = array();
    foreach ($state_totals as $state => $diffs) {
        $avg1 = count($diffs['diff1']) > 0 ? array_sum($diffs['diff1']) / count($diffs['diff1']) : 'N/A';
        $avg2 = count($diffs['diff2']) > 0 ? array_sum($diffs['diff2']) / count($diffs['diff2']) : 'N/A';
        $avgAssigned = count($diffs['assigned_diff']) > 0 ? array_sum($diffs['assigned_diff']) / count($diffs['assigned_diff']) : 'N/A';
        $total_count = $diffs['count'] + $diffs['assigned_count'];
        
        // Calculate combined average
        $combined_avg = 'N/A';
        if ($total_count > 0) {
            $completed_avg = is_numeric($avg1) && is_numeric($avg2) ? ($avg1 + $avg2) * $diffs['count'] : 0;
            $assigned_avg = is_numeric($avg1) && is_numeric($avgAssigned) ? ($avg1 + $avgAssigned) * $diffs['assigned_count'] : 0;
            $combined_avg = ($completed_avg + $assigned_avg) / $total_count;
        }

        $averages[$state] = array(
            'avg1' => $avg1,
            'avg2' => $avg2,
            'avgAssigned' => $avgAssigned,
            'count' => $diffs['count'],
            'assigned_count' => $diffs['assigned_count'],
            'completed_value_sum' => '$' . number_format($diffs['completed_value_sum'], 2),
            'assigned_value_sum' => '$' . number_format($diffs['assigned_value_sum'], 2),
            'combined_avg' => $combined_avg
        );
    }

    // Calculate totals and averages for the final row
    $final_row = array(
        'avg1' => 'N/A',
        'avg2' => 'N/A',
        'avgAssigned' => 'N/A',
        'count' => $total_completed_jobs,
        'assigned_count' => $total_assigned_jobs,
        'completed_value_sum' => '$' . number_format($total_completed_value, 2),
        'assigned_value_sum' => '$' . number_format($total_assigned_value, 2),
        'combined_avg' => 'N/A'
    );

    // Function to calculate the average of non-N/A values
    function calculate_average($values) {
        $numeric_values = array_filter($values, 'is_numeric');
        return count($numeric_values) > 0 ? array_sum($numeric_values) / count($numeric_values) : 'N/A';
    }

    // Calculate averages for the avg1, avg2, and avgAssigned columns
    $final_row['avg1'] = calculate_average(array_column($averages, 'avg1'));
    $final_row['avg2'] = calculate_average(array_column($averages, 'avg2'));
    $final_row['avgAssigned'] = calculate_average(array_column($averages, 'avgAssigned'));
    $final_row['combined_avg'] = calculate_average(array_column($averages, 'combined_avg'));

    $averages['Total/Average'] = $final_row;

    // Reset post data
    wp_reset_postdata();

    // Return the response
    echo json_encode($averages);

    // Don't forget to exit after echoing the response
    wp_die();
}
add_action('wp_ajax_get_avgActionTime', 'get_avgActionTime');
add_action('wp_ajax_nopriv_get_avgActionTime', 'get_avgActionTime');


/* --------------------------------------------------------------------------------- */

function get_avgActionTime_new() {
    global $wpdb;

    // Get the start and end dates from the AJAX request
    $start_date = $_POST['start_date'];
    $end_date = $_POST['end_date'];

    // Perform a query to fetch records from the 'clientenquiry' custom post type
    $query_args = array(
        'post_type'      => 'clientenquiry',
        'posts_per_page' => -1,
        'date_query'     => array(
            'after'     => date('Y-m-d', strtotime($start_date)),
            'before'    => date('Y-m-d', strtotime($end_date)),
            'inclusive' => true, // Include posts published on the end date
        ),
        'meta_query' => array(
            array(
                'key' => 'enquiry_status',
                'value' => array('completed', 'assigned'),
                'compare' => 'IN'
            )
        )
    );

    $query = new WP_Query($query_args);

    // Initialize response array
    $state_totals = array();
    $total_completed_jobs = 0;
    $total_assigned_jobs = 0;
    $total_completed_value = 0;
    $total_assigned_value = 0;

    if ($query->have_posts()) {
        while ($query->have_posts()) {
            $query->the_post();
            $state = get_field('state'); // Assuming 'state' is an ACF field
            $status = get_field('enquiry_status'); // Get the enquiry status
            $published_date = get_the_date('Y-m-d'); // Get the published date
            $contacted_date = get_field('contacted_date'); // Assuming 'contacted_date' is an ACF field
            $invoiced_date = get_field('invoiced_date'); // Assuming 'invoiced_date' is an ACF field
            $completion_date = get_field('completion_date'); // Assuming 'completion_date' is an ACF field
            $final_value = get_field('final_value'); // Assuming 'final_value' is an ACF field

            // Convert dates to a consistent format (Y-m-d) for calculation
            $contacted_date = !empty($contacted_date) ? date('Y-m-d', strtotime(str_replace('/', '-', $contacted_date))) : null;
            $invoiced_date = !empty($invoiced_date) ? date('Y-m-d', strtotime(str_replace('/', '-', $invoiced_date))) : null;
            $completion_date = !empty($completion_date) ? date('Y-m-d', strtotime(str_replace('/', '-', $completion_date))) : null;

            // Initialize state if not set
            if (!isset($state_totals[$state])) {
                $state_totals[$state] = array(
                    'pub_to_contact' => array(),
                    'diff1' => array(),
                    'diff2' => array(),
                    'assigned_diff' => array(),
                    'count' => 0,
                    'assigned_count' => 0, // Initialize assigned_count
                    'completed_value_sum' => 0,
                    'assigned_value_sum' => 0
                );
            }

            // Calculate days from published to contacted
            if ($published_date && $contacted_date) {
                $date_diff_pub_to_contact = (strtotime($contacted_date) - strtotime($published_date)) / (60 * 60 * 24);
                $state_totals[$state]['pub_to_contact'][] = $date_diff_pub_to_contact;
            }

            // Calculate days from contacted to invoiced
            if ($contacted_date && $invoiced_date) {
                $date_diff1 = (strtotime($invoiced_date) - strtotime($contacted_date)) / (60 * 60 * 24);
                $state_totals[$state]['diff1'][] = $date_diff1;
            }

            // Calculate days from invoiced to completed for completed records
            if ($status == 'completed' && $invoiced_date && $completion_date) {
                $date_diff2 = (strtotime($completion_date) - strtotime($invoiced_date)) / (60 * 60 * 24);
                $state_totals[$state]['diff2'][] = $date_diff2;
                $state_totals[$state]['completed_value_sum'] += $final_value;
                $total_completed_value += $final_value;

                // Increment count for the state
                $state_totals[$state]['count']++;
                $total_completed_jobs++;
            }

            // Calculate days from assigned to current date for uncompleted records
            if ($status == 'assigned' && $invoiced_date) {
                $date_diff_assigned = (strtotime(date('Y-m-d')) - strtotime($invoiced_date)) / (60 * 60 * 24);
                $state_totals[$state]['assigned_diff'][] = $date_diff_assigned;
                $state_totals[$state]['assigned_value_sum'] += $final_value;
                $total_assigned_value += $final_value;

                // Increment assigned count for the state
                $state_totals[$state]['assigned_count']++;
                $total_assigned_jobs++;
            }
        }
    }

    // Function to calculate median
    function calculate_median($arr) {
        if (count($arr) == 0) return 'N/A';
        sort($arr);
        $mid = (int) floor((count($arr) - 1) / 2);
        return (count($arr) % 2) ? $arr[$mid] : (($arr[$mid] + $arr[$mid + 1]) / 2.0);
    }

    // Calculate averages, medians, and combined average
    $averages = array();
    foreach ($state_totals as $state => $diffs) {
        $median_pub_to_contact = calculate_median($diffs['pub_to_contact']);
        $median1 = calculate_median($diffs['diff1']);
        $median2 = calculate_median($diffs['diff2']);
        $avgAssigned = count($diffs['assigned_diff']) > 0 ? array_sum($diffs['assigned_diff']) / count($diffs['assigned_diff']) : 'N/A';
        $total_count = $diffs['count'] + $diffs['assigned_count'];
        
        // Calculate completion rate
        $completion_rate = $total_count > 0 ? ($diffs['count'] / $total_count) * 100 : 0;

        // Calculate assigned to completed ratio
        $assigned_to_completed_ratio = $diffs['assigned_count'] > 0 ? $diffs['count'] / $diffs['assigned_count'] : 0;

        $averages[$state] = array(
            'median_pub_to_contact' => $median_pub_to_contact,
            'median1' => $median1,
            'median2' => $median2,
            'count' => $diffs['count'],
            'completion_rate' => $completion_rate,
            'avgAssigned' => $avgAssigned,
            'assigned_count' => $diffs['assigned_count'],
            'assigned_to_completed_ratio' => $assigned_to_completed_ratio,
            'completed_value_sum' => '$' . number_format($diffs['completed_value_sum'], 2),
            'assigned_value_sum' => '$' . number_format($diffs['assigned_value_sum'], 2)
        );
    }

    // Calculate totals and averages for the final row
    $final_row = array(
        'median_pub_to_contact' => 'N/A',
        'median1' => 'N/A',
        'median2' => 'N/A',
        'count' => $total_completed_jobs,
        'completion_rate' => $total_completed_jobs + $total_assigned_jobs > 0 ? ($total_completed_jobs / ($total_completed_jobs + $total_assigned_jobs)) * 100 : 0,
        'avgAssigned' => 'N/A',
        'assigned_count' => $total_assigned_jobs,
        'assigned_to_completed_ratio' => $total_assigned_jobs > 0 ? $total_completed_jobs / $total_assigned_jobs : 0,
        'completed_value_sum' => '$' . number_format($total_completed_value, 2),
        'assigned_value_sum' => '$' . number_format($total_assigned_value, 2)
    );

    // Function to calculate the average of medians
    function calculate_average_of_medians($state_totals, $key) {
        $values = array_filter(array_column($state_totals, $key), 'is_numeric');
        return count($values) > 0 ? array_sum($values) / count($values) : 'N/A';
    }

    // Calculate averages for the median columns and avgAssigned
    $final_row['median_pub_to_contact'] = calculate_average_of_medians($averages, 'median_pub_to_contact');
    $final_row['median1'] = calculate_average_of_medians($averages, 'median1');
    $final_row['median2'] = calculate_average_of_medians($averages, 'median2');
    $final_row['avgAssigned'] = calculate_average_of_medians($averages, 'avgAssigned');

    $averages['Total/Average'] = $final_row;

    // Reset post data
    wp_reset_postdata();

    // Return the response
    echo json_encode($averages);

    // Don't forget to exit after echoing the response
    wp_die();
}
add_action('wp_ajax_get_avgActionTime_new', 'get_avgActionTime_new');
add_action('wp_ajax_nopriv_get_avgActionTime_new', 'get_avgActionTime_new');

/*------------------------------------------------------------------------------------------- */

function rep_running_total() {
    global $wpdb;

    // Retrieve and validate the date range from the AJAX request
    $start_date = $_POST['start_date'];
    $end_date = $_POST['end_date'];

    // Validate the dates
    if (empty($start_date) || empty($end_date)) {
        wp_send_json_error('Invalid date range.');
        wp_die();
    }

    // Convert the dates to the format expected in the SQL query (Y-m-d)
    $start_date_sql = date('Y-m-d', strtotime(str_replace('/', '-', $start_date))); // Convert d/m/Y to Y-m-d
    $end_date_sql = date('Y-m-d', strtotime(str_replace('/', '-', $end_date))); // Convert d/m/Y to Y-m-d

    // Prepare and execute the SQL query
$query = $wpdb->prepare("
    SELECT
        u.display_name AS `Sales Rep`,
        COUNT(CASE WHEN ce.post_date BETWEEN %s AND %s THEN 1 ELSE NULL END) AS `Total Calls`,
        COUNT(CASE WHEN ce.post_date BETWEEN %s AND %s AND pm_invoiced.meta_value IS NOT NULL THEN 1 ELSE NULL END) AS `Total Sales`,
        ROUND(
            (
                COUNT(CASE WHEN ce.post_date BETWEEN %s AND %s AND pm_invoiced.meta_value IS NOT NULL THEN 1 ELSE NULL END) 
                / 
                NULLIF(COUNT(CASE WHEN ce.post_date BETWEEN %s AND %s THEN 1 ELSE NULL END), 0)
            ) * 100, 2
        ) AS `Ratio of Calls to Sales`,
        SUM(CASE WHEN ce.post_date BETWEEN %s AND %s AND pm_invoiced.meta_value IS NOT NULL THEN CAST(pm_value.meta_value AS DECIMAL(10, 2)) ELSE 0 END) AS `Value of Sales`,
        COUNT(CASE WHEN pm_completed.meta_value IS NOT NULL AND STR_TO_DATE(pm_completed.meta_value, '%%Y-%%m-%%d %%H:%%i:%%s') BETWEEN %s AND %s THEN 1 ELSE NULL END) AS `Completed Sales`,
        SUM(CASE WHEN pm_completed.meta_value IS NOT NULL AND STR_TO_DATE(pm_completed.meta_value, '%%Y-%%m-%%d %%H:%%i:%%s') BETWEEN %s AND %s THEN CAST(pm_value.meta_value AS DECIMAL(10, 2)) ELSE 0 END) AS `Values of Completions`
    FROM
        {$wpdb->posts} ce
        INNER JOIN {$wpdb->postmeta} pm_sales_rep ON ce.ID = pm_sales_rep.post_id AND pm_sales_rep.meta_key = 'sales_rep'
        INNER JOIN {$wpdb->users} u ON pm_sales_rep.meta_value = u.ID
        LEFT JOIN {$wpdb->postmeta} pm_invoiced ON ce.ID = pm_invoiced.post_id AND pm_invoiced.meta_key = 'invoiced_date'
        LEFT JOIN {$wpdb->postmeta} pm_completed ON ce.ID = pm_completed.post_id AND pm_completed.meta_key = 'completion_date'
        LEFT JOIN {$wpdb->postmeta} pm_value ON ce.ID = pm_value.post_id AND pm_value.meta_key = 'final_value'
        LEFT JOIN {$wpdb->postmeta} pm_status ON ce.ID = pm_status.post_id AND pm_status.meta_key = 'enquiry_status'
    WHERE
        ce.post_type = 'clientenquiry'
        AND ce.post_status = 'publish'
        AND (pm_status.meta_value IS NULL OR pm_status.meta_value != 'cancelled')  -- Exclude cancelled enquiries
    GROUP BY
        `Sales Rep`
",
$start_date_sql, $end_date_sql,  // For total_calls
$start_date_sql, $end_date_sql,  // For total_sales
$start_date_sql, $end_date_sql,  // For ratio_sales_calls calculation (numerator)
$start_date_sql, $end_date_sql,  // For ratio_sales_calls calculation (denominator)
$start_date_sql, $end_date_sql,  // For value_of_sales
$start_date_sql, $end_date_sql,  // For completed_sales
$start_date_sql, $end_date_sql   // For values_of_completions
);


    // Execute the query
    $results = $wpdb->get_results($query);

    // Initialize the response array
    $sales_rep_summary = array();

    // Process the results
    if (!empty($results)) {
        foreach ($results as $row) {
            $sales_rep_summary[] = array(
                'sales_rep' => $row->{"Sales Rep"},
                'total_calls' => intval($row->{"Total Calls"}),
                'total_sales' => intval($row->{"Total Sales"}),
                'ratio_of_calls_to_sales' => floatval($row->{"Ratio of Calls to Sales"}),
                'value_of_sales' => floatval($row->{"Value of Sales"}),
                'completed_sales' => intval($row->{"Completed Sales"}),
                'values_of_completions' => floatval($row->{"Values of Completions"})
            );
        }
    }

    // Log the JSON response for debugging
    error_log('JSON Response: ' . json_encode($sales_rep_summary));

    // Return the response in JSON format
    wp_send_json_success($sales_rep_summary);
    wp_die(); // This is required to terminate immediately and return a proper response
}

add_action('wp_ajax_rep_running_total', 'rep_running_total');
add_action('wp_ajax_nopriv_rep_running_total', 'rep_running_total');
