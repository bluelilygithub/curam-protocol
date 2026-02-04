<?php
// If this file is called directly, abort.
if ( ! defined( 'WPINC' ) ) {    die;}


// Initialize $settings
$settings = '';

add_action('wpcf7_before_send_mail', 'save_cf7_to_incoming_cpt');
function save_cf7_to_incoming_cpt($contact_form) {
    if ($contact_form->id() != 2835) {
        return; // Exit if it's not the specific form
    }

    $submission = WPCF7_Submission::get_instance();
    if ($submission) {
        $posted_data = $submission->get_posted_data();

        // Check for duplicate submissions based on a unique field, e.g., email
        $email = $posted_data['your-email'];
        $existing_posts = get_posts([
            'post_type' => 'incoming',
            'meta_query' => [
                [
                    'key' => 'email',
                    'value' => $email,
                    'compare' => '='
                ]
            ]
        ]);

        if (!empty($existing_posts)) {
            // A post with this email already exists
            return;
        }

        $name = sanitize_text_field($posted_data['your-name']);
        $name = ucwords(strtolower($name));

        $post_id = wp_insert_post([
            'post_title' => $name,
            'post_type' => 'clientenquiry',
            'post_status' => 'publish',
        ]);
        

        $myname = sanitize_text_field($posted_data['your-name']);
        $myname = trim($myname);
        $name_parts = explode(' ', $myname);
        $firstname = '';
        $lastname = '';
        $num_parts = count($name_parts);
        if ($num_parts == 1) {
            $firstname = ucfirst(strtolower($name_parts[0])); 
        } elseif ($num_parts >= 2) {
            $firstname = ucfirst(strtolower($name_parts[0])); // Propercase
            $lastname = ucfirst(strtolower($name_parts[$num_parts - 1])); // Propercase
            for ($i = 1; $i < $num_parts - 1; $i++) {
                $firstname .= ' ' . ucfirst(strtolower($name_parts[$i])); // Propercase
            }
        }

        update_post_meta($post_id, 'firstname', $firstname);
        update_post_meta($post_id, 'lastname', $lastname);
        update_post_meta($post_id, 'company_name', sanitize_text_field($posted_data['your-company']));
        update_post_meta($post_id, 'email', sanitize_email($email));
        update_post_meta($post_id, 'phone', sanitize_text_field($posted_data['your-phone']));

        if (isset($_POST['package-type'])) {
            $packagetype = sanitize_text_field($_POST['package-type']);
            update_post_meta($post_id, 'package_type', $packagetype);
        }    
        update_post_meta($post_id, 'vehicle_make', sanitize_text_field($posted_data['your-vehicle-make']));
        update_post_meta($post_id, 'vehicle_model', sanitize_text_field($posted_data['your-vehicle-model']));
        update_post_meta($post_id, 'vehicle_year', sanitize_text_field($posted_data['your-vehicle-year']));
        update_post_meta($post_id, 'vehicle_color', sanitize_text_field($posted_data['your-vehicle-colour']));

        if (isset($_POST['your-vehicle-condition'])) {
            $selected_condition = sanitize_text_field($_POST['your-vehicle-condition']);
            update_post_meta($post_id, 'vehicle_condition', $selected_condition);
        }

        if (isset($_POST['your-state'])) {
            $selected_state = sanitize_text_field($_POST['your-state']);
            update_post_meta($post_id, 'state', $selected_state);
        }
        update_post_meta($post_id, 'suburb', sanitize_text_field($posted_data['your-suburb']));
        update_post_meta($post_id, 'postcode', sanitize_text_field($posted_data['your-postcode']));
        update_post_meta($post_id, 'enquiry_status', 'new');
        update_post_meta($post_id, 'final_value', '0');
        update_post_meta($post_id, 'enquiry_source', 'web');
        update_post_meta($post_id, 'job_number', $post_id);

        $enquiry_system_defaults = get_field('enquiry_system_defaults', 'option');
        $primary_sales_person = $enquiry_system_defaults['primary_sales_person'];
        $primary_sales_person_id = $primary_sales_person['ID'];

        update_post_meta($post_id, 'sales_rep', $primary_sales_person_id);

        $current_datetime = current_time('mysql');
        $progress_details = get_field('progress_details', $post_id);
        $progress_details[] = array(
            'entry_date' => $current_datetime,
            'next_event' => date('Y-m-d H:i:s', strtotime($current_datetime . ' +24 hours')),
            'next_action' => 'Phone',
            'event_message' => sanitize_textarea_field($posted_data['your-message']),
        );
        update_field('progress_details', $progress_details, $post_id);

       // session_start();
       // $_SESSION['cf7_redirect_state_' . $contact_form->id()] = $posted_data['your-state'];

    }
}



/*------------------------------------------------------------------------------------------------*/

add_filter('acf/load_field/name=entry_date', function ($field) {
    $field['default_value'] = date('d/m/Y g:i a');
    $field['disabled'] = true; // Disable the field
    return $field;
});

add_filter('acf/load_field/name=staff_member', function ($field) {
    $current_user_id = get_current_user_id();
    $current_user_display_name = get_the_author_meta('display_name', $current_user_id);
    $field['default_value'] = $current_user_display_name;
    $field['disabled'] = true; // Disable the field
    return $field;
});


add_filter('acf/load_field/name=email_details', function ($field) {
    $field['disabled'] = true; // Disable the field
    $field['readonly'] = true;
    return $field;
});

add_filter('acf/load_field/name=technician_email', function ($field) {
 //   $field['disabled'] = true; // Disable the field
    $field['readonly'] = true;
    return $field;
});

add_filter('acf/load_field/name=technician_phone', function ($field) {
  //  $field['disabled'] = true; // Disable the field
    $field['readonly'] = true;
    return $field;
});


add_filter('acf/load_field/name=invoiced_date', function ($field) {
    $field['disabled'] = true; // Disable the field
    $field['readonly'] = true;
    return $field;
});

add_filter('acf/load_field/name=completion_date', function ($field) {
    $field['disabled'] = true; // Disable the field
    $field['readonly'] = true;
    return $field;
});

add_filter('acf/load_field/name=contacted_date', function ($field) {
    $field['disabled'] = true; // Disable the field
    $field['readonly'] = true;
    return $field;
});

/*------------------------------------------------------------------------------------------------*/

add_action('acf/save_post', 'update_date_entry_field', 30);

function update_date_entry_field($post_id) {
    if (get_post_type($post_id) === 'clientenquiry') {

        // set the initial first contact date.
        $contacted_date = get_field('contacted_date', $post_id);
        if (empty($contacted_date)) {
            update_field('contacted_date', $current_date, $post_id);
        }

        // Checking if the 'enquiry_status' field value has changed
        $new_update_status = get_field('enquiry_status', $post_id);
        $old_update_status = get_post_meta($post_id, '_old_enquiry_status', true);

        if ($new_update_status !== $old_update_status) {
            updateTransLog($new_update_status, $post_id);
            // Update the old status meta to the new value
            update_post_meta($post_id, '_old_enquiry_status', $new_update_status);

            // Check if the new status is 'completed' and update the 'completion_date'
            if ($new_update_status === 'completed') {
                $current_date = current_time('mysql');
                update_field('completion_date', $current_date, $post_id);
            }
            if ($new_update_status === 'assigned') {
                $current_date = current_time('mysql');
                update_field('invoiced_date', $current_date, $post_id);
            }
            if ($new_update_status === 'emailed') {
                $current_date = current_time('mysql');
                update_field('contacted_date', $current_date, $post_id);
            }
            if ($new_update_status === 'contacted') {
                $current_date = current_time('mysql');
                update_field('contacted_date', $current_date, $post_id);
            }                        
            // Check if the new status is 'cancelled' and set 'sales_value' to zero
            if ($new_update_status === 'cancelled') {
                $current_date = current_time('mysql');
                update_field('final_value', 0, $post_id);
                send_client_cancellation_email($post_id);
                send_technician_cancellation_email($post_id);
            }
        }


        // If 'job_number' is empty, set it to the current post ID  - legacy records
        $job_number = get_field('job_number', $post_id);
        if (empty($job_number)) {
            update_field('job_number', $post_id, $post_id);
        }
            

        if (isset($_POST['acf']['field_65dae59d777bb'])) {
            $progress_details = get_field('progress_details', $post_id);
            $current_datetime = current_time('mysql');

            if (!empty($progress_details) && empty($progress_details[count($progress_details) - 1]['entry_date'])) {
                $progress_details[count($progress_details) - 1]['entry_date'] = $current_datetime;
                update_field('progress_details', $progress_details, $post_id);
            }
        }
    }
}


// Initialize old enquiry status meta when post is saved for the first time
add_action('save_post_clientenquiry', 'initialize_old_enquiry_status', 10, 3);

function initialize_old_enquiry_status($post_id, $post, $update) {
    if (!$update) { // Only for new posts
        $current_status = get_field('enquiry_status', $post_id);
        update_post_meta($post_id, '_old_enquiry_status', $current_status);
    }
}

/*------------------------------------------------------------------------------------------------*/

add_action('acf/save_post', 'send_emails_on_save', 30);

function send_emails_on_save($post_id) {
    if (get_post_type($post_id) === 'clientenquiry') {
        if (isset($_POST['acf']['field_6618979c44fb3'])) {
            $value = $_POST['acf']['field_6618979c44fb3'];
            if ($value === '1' || $value === 1 || $value === 'true' || $value === true) {
                send_warranty_email($post_id);
            }
        }
        if (isset($_POST['acf']['field_66076a821bf6d'])) {
            $value = $_POST['acf']['field_66076a821bf6d'];
            if ($value === '1' || $value === 1 || $value === 'true' || $value === true) {
                send_technician_email($post_id);
                send_customer_appointment_email($post_id);
            }
        }
    }
}


/*------------------------------------------------------------------------------------------------*/


function set_email_technician_to_false( $field ) {
    if ( 'email_technician' === $field['name'] ) {
        $field['value'] = false;
    }
    return $field;
}
add_filter( 'acf/load_field/name=email_technician', 'set_email_technician_to_false' );


function set_email_warranty_to_false( $field ) {
    if ( 'email_warranty' === $field['name'] ) {
        $field['value'] = false;
    }
    return $field;
}
add_filter( 'acf/load_field/name=email_warranty', 'set_email_warranty_to_false' );


//*------------------------------------------------------------------------------------------------*/
/* ------- Prepopulate the select field--------------- */
// Filter to sort choices and modify ACF 'products' select field
add_filter('acf/load_field/name=products', 'my_acf_modify_product_select_field', 10, 1);
function my_acf_modify_product_select_field($field) {
    // Check if the field is a select field named 'products'
    if ($field['name'] === 'products' && $field['type'] === 'select') {
        $selected_values = $field['value'];
        $product_posts = get_posts(array(
            'post_type'   => 'product',
            'posts_per_page' => -1,
            'orderby'     => 'title',
            'order'       => 'ASC',
            'post_status' => 'publish',
        ));
        $choices = array();
        foreach ($product_posts as $product_post) {
            // Get the product price
            $price = get_field('product_price', $product_post->ID);
            
            // Format the label with price
            $label = $product_post->post_title;
            if ($price) {
                $label .= '    :  ( $' . number_format((float)$price, 2).' )';
            }
            
            $choices[$product_post->ID] = $label;
        }
        $field['allow_null'] = true;
        $field['return_format'] = 'value';
        $field['choices'] = $choices;
    }
    return $field;
}


/* ------- Prepopulate the select field--------------- */


add_filter('acf/load_field/name=technician', 'populate_technician_list');

function populate_technician_list($field) {
    $current_post_id = isset($_GET['post']) ? $_GET['post'] : null;
    $current_post = get_post($current_post_id);

    if ($current_post && $current_post->post_type == 'clientenquiry' && empty($field['value'])) {
        $state = get_field('state', $current_post->ID);
        $options = array();
        $options[''] = 'Select ' . $state . ' Technician (Disabled)';

        $technicians = get_users(array('role' => 'technician'));

        if (!empty($technicians)) {
            foreach ($technicians as $user) {
                $user_id = $user->ID;
                $user_state = get_user_meta($user_id, 'user_state', true);

                if ($user_state === $state) {
                    $display_name = $user->display_name . ' ' . $user->last_name;
                    $options[$user_id] = $display_name;
                }
            }
        }

        $field['choices'] = $options;
    }

    return $field;
}



/* ------- Prepopulate the select field--------------- */

/*-------------
function redirect_after_clientenquiry_update( $post_id ) {
    if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
        return;
    }
    if ( is_admin() ) {
        if ( 'clientenquiry' === get_post_type( $post_id ) ) {
            // Redirect to the clientenquiry post list page
            wp_redirect( admin_url( 'edit.php?post_type=clientenquiry' ) );
            exit;
        }
    }
}
add_action( 'save_post', 'redirect_after_clientenquiry_update' );
-----------*/

function redirect_after_clientenquiry_update($post_id) {
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    
    // Check if this is a new post or an existing one
    $is_new_post = wp_is_post_revision($post_id) || 'auto-draft' === get_post_status($post_id);
    
    if (is_admin() && !$is_new_post) {
        // Check if the post type is 'clientenquiry'
        if ('clientenquiry' === get_post_type($post_id)) {
            // Redirect to the clientenquiry post list page
            wp_redirect(admin_url('edit.php?post_type=clientenquiry'));
            exit;
        }
    }
}
add_action('save_post', 'redirect_after_clientenquiry_update');



/* ------- Prepopulate the select field--------------- */

function reverseRepeaterDisplayOrder( $value, $post_id, $field ) {
    $order = array();
    
    if( empty($value) ) {  
        return $value; 
    }
    
    foreach( $value as $i => $row ) {
        $order[ $i ] = $row['field_65dae59d777bb'];   // the date field in repeater
    }
    array_multisort( $order, SORT_DESC, $value );
    return $value;  
}

add_filter('acf/load_value/name=progress_details', 'reverseRepeaterDisplayOrder', 10, 3);




/*------------------------------------------------------------------------------------------------*/
/* GOOGLE PLACES API - ADDRESS AUTOCOMPLETE */
/*------------------------------------------------------------------------------------------------*/

/**
 * Google Places API enqueue function has been moved to inc/bluelily_enqueue.php
 * for better organization (see dp_enqueue_google_places_admin function)
 */