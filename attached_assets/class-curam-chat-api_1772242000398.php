<?php
if ( ! defined( 'WPINC' ) ) {
    die;
}

class Curam_Chat_API {

    private static $rate_limit_minute = 30;
    private static $rate_limit_hour   = 100;

    public static function init() {
        add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
    }

    public static function register_routes() {
        register_rest_route( 'curam-chat/v1', '/ask', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'handle_ask' ),
            'permission_callback' => '__return_true',
        ) );

        register_rest_route( 'curam-chat/v1', '/email-transcript', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'handle_email_transcript' ),
            'permission_callback' => '__return_true',
        ) );

        register_rest_route( 'curam-chat/v1', '/reindex', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'handle_reindex' ),
            'permission_callback' => array( __CLASS__, 'check_admin_permission' ),
        ) );

        register_rest_route( 'curam-chat/v1', '/feedback', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'handle_feedback' ),
            'permission_callback' => '__return_true',
        ) );

        register_rest_route( 'curam-chat/v1', '/ask-stream', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'handle_ask_stream' ),
            'permission_callback' => '__return_true',
        ) );

        register_rest_route( 'curam-chat/v1', '/lead', array(
            'methods'             => 'POST',
            'callback'            => array( __CLASS__, 'handle_lead' ),
            'permission_callback' => '__return_true',
        ) );
    }

    public static function check_admin_permission() {
        return current_user_can( 'manage_options' );
    }

    public static function handle_ask( WP_REST_Request $request ) {
        $nonce = $request->get_header( 'X-WP-Nonce' );
        if ( empty( $nonce ) || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
            return new WP_REST_Response( array( 'error' => 'Security check failed.' ), 403 );
        }

        $rate_check = self::check_rate_limit();
        if ( is_wp_error( $rate_check ) ) {
            return new WP_REST_Response( array( 'error' => $rate_check->get_error_message() ), 429 );
        }

        $params  = $request->get_json_params();
        $message = isset( $params['message'] ) ? sanitize_text_field( $params['message'] ) : '';
        $history = isset( $params['history'] ) && is_array( $params['history'] ) ? $params['history'] : array();

        Curam_Chat_Helpers::log( 'ASK request received', 'debug', array(
            'raw_message'   => $message,
            'history_count' => count( $history ),
        ) );

        if ( empty( $message ) ) {
            Curam_Chat_Helpers::log( 'ASK rejected: empty message', 'debug' );
            return new WP_REST_Response( array( 'error' => 'Please enter a question.' ), 400 );
        }

        if ( strlen( $message ) > 500 ) {
            $message = substr( $message, 0, 500 );
        }

        $history = self::sanitize_history( $history );

        $domain_check = self::check_domain_relevance( $message );
        if ( $domain_check !== true ) {
            Curam_Chat_Helpers::log( 'ASK rejected by domain filter', 'debug', array( 'query' => $message ) );
            return new WP_REST_Response( array(
                'message'            => $domain_check,
                'sources'            => array( 'page' => array(), 'post' => array() ),
                'followup_questions' => array(),
            ), 200 );
        }

        Curam_Chat_Helpers::log( 'ASK domain check passed, running search', 'debug', array( 'query' => $message ) );

        $search_results = Curam_Chat_Search::search( $message );
        $context        = isset( $search_results['results'] ) ? $search_results['results'] : array();
        $search_terms   = isset( $search_results['terms'] ) ? $search_results['terms'] : array();

        Curam_Chat_Helpers::log( 'ASK search complete', 'debug', array(
            'query'         => $message,
            'terms'         => implode( ', ', $search_terms ),
            'results_count' => count( $context ),
            'result_titles' => implode( ' | ', array_map( function( $r ) { return $r['title'] . ' (score:' . $r['score'] . ')'; }, $context ) ),
        ) );

        $has_api_key = ! empty( Curam_Chat_Helpers::get_gemini_key() );
        Curam_Chat_Helpers::log( 'ASK Gemini API key status', 'debug', array( 'has_key' => $has_api_key ? 'yes' : 'NO - will use fallback' ) );

        $parallel_result = Curam_Chat_AI::generate_answer_and_followups( $message, $context, $history );
        $ai_response = $parallel_result['answer'];
        $followups   = $parallel_result['followups'];

        $ai_message = isset( $ai_response['message'] ) ? $ai_response['message'] : '';

        Curam_Chat_Helpers::log( 'ASK AI response', 'debug', array(
            'has_message'    => ! empty( $ai_message ) ? 'yes' : 'no',
            'message_length' => strlen( $ai_message ),
            'message_preview' => substr( wp_strip_all_tags( $ai_message ), 0, 200 ),
        ) );

        $sources = self::format_sources( $context );

        Curam_Chat_Helpers::log( 'ASK endpoint complete', 'debug', array(
            'query'          => $message,
            'results_count'  => count( $context ),
            'has_ai'         => ! empty( $ai_message ) ? 'yes' : 'no',
            'followups'      => count( $followups ),
            'source_pages'   => count( $sources['page'] ?? array() ),
            'source_posts'   => count( $sources['post'] ?? array() ),
        ) );

        return new WP_REST_Response( array(
            'message'            => $ai_message,
            'sources'            => $sources,
            'followup_questions' => $followups,
        ), 200 );
    }

    public static function handle_ask_stream( WP_REST_Request $request ) {
        $nonce = $request->get_header( 'X-WP-Nonce' );
        if ( empty( $nonce ) || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
            header( 'Content-Type: text/event-stream' );
            header( 'Cache-Control: no-cache' );
            self::sse_send( 'error', wp_json_encode( array( 'error' => 'Security check failed.' ) ) );
            self::sse_done();
            exit;
        }

        $rate_check = self::check_rate_limit();
        if ( is_wp_error( $rate_check ) ) {
            header( 'Content-Type: text/event-stream' );
            header( 'Cache-Control: no-cache' );
            self::sse_send( 'error', wp_json_encode( array( 'error' => $rate_check->get_error_message() ) ) );
            self::sse_done();
            exit;
        }

        $params  = $request->get_json_params();
        $message = isset( $params['message'] ) ? sanitize_text_field( $params['message'] ) : '';
        $history = isset( $params['history'] ) && is_array( $params['history'] ) ? $params['history'] : array();

        if ( empty( $message ) ) {
            header( 'Content-Type: text/event-stream' );
            header( 'Cache-Control: no-cache' );
            self::sse_send( 'error', wp_json_encode( array( 'error' => 'Please enter a question.' ) ) );
            self::sse_done();
            exit;
        }

        if ( strlen( $message ) > 500 ) {
            $message = substr( $message, 0, 500 );
        }

        $history = self::sanitize_history( $history );

        $domain_check = self::check_domain_relevance( $message );
        if ( $domain_check !== true ) {
            header( 'Content-Type: text/event-stream' );
            header( 'Cache-Control: no-cache' );
            self::sse_send( 'error', wp_json_encode( array(
                'message'            => $domain_check,
                'sources'            => array( 'page' => array(), 'post' => array() ),
                'followup_questions' => array(),
            ) ) );
            self::sse_done();
            exit;
        }

        $search_results = Curam_Chat_Search::search( $message );
        $context        = isset( $search_results['results'] ) ? $search_results['results'] : array();

        $api_key = Curam_Chat_Helpers::get_gemini_key();

        header( 'Content-Type: text/event-stream' );
        header( 'Cache-Control: no-cache' );
        header( 'Connection: keep-alive' );
        header( 'X-Accel-Buffering: no' );

        while ( ob_get_level() ) {
            ob_end_flush();
        }

        $sources = self::format_sources( $context );
        self::sse_send( 'sources', wp_json_encode( $sources ) );

        if ( empty( $api_key ) ) {
            $fallback = Curam_Chat_AI::generate_answer( $message, $context, $history );
            $fallback_msg = isset( $fallback['message'] ) ? $fallback['message'] : '';
            self::sse_send( 'done', wp_json_encode( array( 'message' => $fallback_msg ) ) );
            self::sse_done();
            exit;
        }

        $cache_key = 'curam_chat_' . md5( $message . serialize( $context ) );
        $cached = get_transient( $cache_key );
        if ( false !== $cached ) {
            $cached_msg = isset( $cached['message'] ) ? $cached['message'] : '';
            self::sse_send( 'done', wp_json_encode( array( 'message' => $cached_msg ) ) );
            $followups = Curam_Chat_AI::generate_followup( $message, $context );
            if ( ! empty( $followups ) ) {
                self::sse_send( 'followups', wp_json_encode( $followups ) );
            }
            self::sse_done();
            exit;
        }

        $prompt = Curam_Chat_AI::build_prompt_for( $message, $context, $history );
        $raw_text = '';

        $stream_result = Curam_Chat_AI::stream_gemini( $api_key, $prompt, function( $chunk ) use ( &$raw_text ) {
            $raw_text .= $chunk;
            self::sse_send( 'chunk', $chunk );
        } );

        if ( is_wp_error( $stream_result ) ) {
            Curam_Chat_Helpers::log( 'Stream Gemini failed: ' . $stream_result->get_error_message(), 'error' );
            $fallback = Curam_Chat_AI::generate_answer( $message, $context, $history );
            $fallback_msg = isset( $fallback['message'] ) ? $fallback['message'] : '';
            self::sse_send( 'done', wp_json_encode( array( 'message' => $fallback_msg ) ) );
            self::sse_done();
            exit;
        }

        $processed = Curam_Chat_AI::post_process_for( $raw_text, $context );

        $answer_result = array(
            'message' => $processed,
            'raw'     => $raw_text,
        );
        set_transient( $cache_key, $answer_result, 3600 );

        self::sse_send( 'done', wp_json_encode( array( 'message' => $processed ) ) );

        $followups = Curam_Chat_AI::generate_followup( $message, $context );
        if ( ! empty( $followups ) ) {
            self::sse_send( 'followups', wp_json_encode( $followups ) );
        }

        self::sse_done();
        exit;
    }

    private static function sse_send( $event, $data ) {
        echo 'event: ' . $event . "\n";
        echo 'data: ' . $data . "\n\n";
        if ( ob_get_level() ) {
            ob_flush();
        }
        flush();
    }

    private static function sse_done() {
        echo "event: done\ndata: [DONE]\n\n";
        if ( ob_get_level() ) {
            ob_flush();
        }
        flush();
    }

    public static function handle_email_transcript( WP_REST_Request $request ) {
        $nonce = $request->get_header( 'X-WP-Nonce' );
        if ( empty( $nonce ) || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
            return new WP_REST_Response( array( 'error' => 'Security check failed.' ), 403 );
        }

        $rate_check = self::check_rate_limit();
        if ( is_wp_error( $rate_check ) ) {
            return new WP_REST_Response( array( 'error' => $rate_check->get_error_message() ), 429 );
        }

        $params  = $request->get_json_params();
        $email   = isset( $params['email'] ) ? sanitize_email( $params['email'] ) : '';
        $history = isset( $params['history'] ) && is_array( $params['history'] ) ? $params['history'] : array();
        $name    = isset( $params['name'] ) ? sanitize_text_field( $params['name'] ) : '';
        $company = isset( $params['company'] ) ? sanitize_text_field( $params['company'] ) : '';

        if ( empty( $email ) || ! is_email( $email ) ) {
            return new WP_REST_Response( array( 'error' => 'Please provide a valid email address.' ), 400 );
        }

        if ( empty( $history ) ) {
            return new WP_REST_Response( array( 'error' => 'At least one message is required.' ), 400 );
        }

        $history = self::sanitize_history( $history );

        $result = Curam_Chat_Email::send_transcript( $email, $history, $name, $company );

        if ( is_wp_error( $result ) ) {
            return new WP_REST_Response( array( 'error' => $result->get_error_message() ), 500 );
        }

        return new WP_REST_Response( array(
            'success' => true,
            'message' => 'Chat log sent successfully.',
        ), 200 );
    }

    public static function handle_feedback( WP_REST_Request $request ) {
        $nonce = $request->get_header( 'X-WP-Nonce' );
        if ( empty( $nonce ) || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
            return new WP_REST_Response( array( 'error' => 'Security check failed.' ), 403 );
        }

        $rate_check = self::check_rate_limit();
        if ( is_wp_error( $rate_check ) ) {
            return new WP_REST_Response( array( 'error' => $rate_check->get_error_message() ), 429 );
        }

        $settings = get_option( 'curam_chat_settings', array() );
        if ( ( $settings['feedback_enabled'] ?? '1' ) !== '1' ) {
            return new WP_REST_Response( array( 'error' => 'Feedback is disabled.' ), 403 );
        }

        $params           = $request->get_json_params();
        $query            = isset( $params['query'] ) ? sanitize_text_field( $params['query'] ) : '';
        $response_preview = isset( $params['response_preview'] ) ? sanitize_text_field( substr( $params['response_preview'], 0, 500 ) ) : '';
        $rating           = isset( $params['rating'] ) ? sanitize_text_field( $params['rating'] ) : '';
        $comment          = isset( $params['comment'] ) ? sanitize_textarea_field( substr( $params['comment'], 0, 1000 ) ) : '';

        if ( ! in_array( $rating, array( 'helpful', 'unhelpful' ), true ) ) {
            return new WP_REST_Response( array( 'error' => 'Invalid rating.' ), 400 );
        }

        if ( empty( $query ) ) {
            return new WP_REST_Response( array( 'error' => 'Query is required.' ), 400 );
        }

        $ip = '';
        if ( ! empty( $_SERVER['REMOTE_ADDR'] ) ) {
            $ip = sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
        }

        global $wpdb;
        $table = $wpdb->prefix . 'curam_chat_feedback';

        $inserted = $wpdb->insert(
            $table,
            array(
                'query'            => $query,
                'response_preview' => $response_preview,
                'rating'           => $rating,
                'comment'          => $comment,
                'ip_address'       => $ip,
                'created_at'       => current_time( 'mysql' ),
            ),
            array( '%s', '%s', '%s', '%s', '%s', '%s' )
        );

        if ( false === $inserted ) {
            Curam_Chat_Helpers::log( 'Feedback insert failed', 'error', array(
                'db_error' => $wpdb->last_error,
                'query'    => $query,
                'rating'   => $rating,
            ) );
            return new WP_REST_Response( array( 'error' => 'Failed to save feedback.' ), 500 );
        }

        Curam_Chat_Helpers::log( 'Feedback received', 'info', array(
            'rating' => $rating,
            'query'  => $query,
        ) );

        return new WP_REST_Response( array( 'success' => true ), 200 );
    }

    public static function handle_lead( WP_REST_Request $request ) {
        $nonce = $request->get_header( 'X-WP-Nonce' );
        if ( empty( $nonce ) || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
            return new WP_REST_Response( array( 'error' => 'Security check failed.' ), 403 );
        }

        $rate_check = self::check_rate_limit();
        if ( is_wp_error( $rate_check ) ) {
            return new WP_REST_Response( array( 'error' => $rate_check->get_error_message() ), 429 );
        }

        $settings = get_option( 'curam_chat_settings', array() );
        if ( ( $settings['lead_capture_enabled'] ?? '0' ) !== '1' ) {
            return new WP_REST_Response( array( 'error' => 'Lead capture is not enabled.' ), 403 );
        }

        $params     = $request->get_json_params();
        $name       = isset( $params['name'] ) ? sanitize_text_field( $params['name'] ) : '';
        $email      = isset( $params['email'] ) ? sanitize_email( $params['email'] ) : '';
        $phone      = isset( $params['phone'] ) ? sanitize_text_field( $params['phone'] ) : '';
        $message    = isset( $params['message'] ) ? sanitize_textarea_field( substr( $params['message'], 0, 2000 ) ) : '';
        $history    = isset( $params['history'] ) && is_array( $params['history'] ) ? $params['history'] : array();
        $source_url = isset( $params['source_url'] ) ? esc_url_raw( $params['source_url'] ) : '';

        if ( empty( $name ) ) {
            return new WP_REST_Response( array( 'error' => 'Name is required.' ), 400 );
        }

        if ( empty( $email ) || ! is_email( $email ) ) {
            return new WP_REST_Response( array( 'error' => 'A valid email address is required.' ), 400 );
        }

        $history = self::sanitize_history( $history );

        $nlp_summary = '';
        if ( ! empty( $history ) ) {
            $nlp_summary = Curam_Chat_AI::generate_lead_summary( $history );
        }

        $ip = '';
        if ( ! empty( $_SERVER['REMOTE_ADDR'] ) ) {
            $ip = sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
        }

        global $wpdb;
        $table = $wpdb->prefix . 'curam_chat_leads';

        $inserted = $wpdb->insert(
            $table,
            array(
                'name'        => $name,
                'email'       => $email,
                'phone'       => $phone,
                'message'     => $message,
                'nlp_summary' => $nlp_summary,
                'transcript'  => ! empty( $history ) ? wp_json_encode( $history ) : '',
                'source_url'  => $source_url,
                'status'      => 'new',
                'ip_address'  => $ip,
                'created_at'  => current_time( 'mysql' ),
                'updated_at'  => current_time( 'mysql' ),
            ),
            array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s' )
        );

        if ( false === $inserted ) {
            Curam_Chat_Helpers::log( 'Lead insert failed', 'error', array(
                'db_error' => $wpdb->last_error,
                'email'    => $email,
            ) );
            return new WP_REST_Response( array( 'error' => 'Failed to save lead. Please try again.' ), 500 );
        }

        Curam_Chat_Helpers::log( 'Lead captured', 'info', array(
            'lead_id'     => $wpdb->insert_id,
            'name'        => $name,
            'email'       => $email,
            'has_summary' => ! empty( $nlp_summary ) ? 'yes' : 'no',
        ) );

        $lead_data = array(
            'name'        => $name,
            'email'       => $email,
            'phone'       => $phone,
            'message'     => $message,
            'nlp_summary' => $nlp_summary,
            'transcript'  => $history,
            'source_url'  => $source_url,
        );

        $notification_result = Curam_Chat_Email::send_lead_notification( $lead_data, $settings );

        if ( is_wp_error( $notification_result ) ) {
            Curam_Chat_Helpers::log( 'Lead notification failed: ' . $notification_result->get_error_message(), 'warning', array(
                'lead_id' => $wpdb->insert_id,
            ) );
        }

        return new WP_REST_Response( array(
            'success' => true,
            'message' => 'Thank you! A team member will be in touch soon.',
        ), 200 );
    }

    public static function handle_reindex( WP_REST_Request $request ) {
        $start  = microtime( true );
        $result = Curam_Chat_Indexer::reindex_all();
        $duration = round( microtime( true ) - $start, 1 );

        return new WP_REST_Response( array(
            'success'          => true,
            'indexed'          => $result['indexed'],
            'skipped'          => $result['skipped'],
            'removed'          => $result['removed'],
            'duration_seconds' => $duration,
        ), 200 );
    }

    private static function check_rate_limit() {
        $ip = '';
        if ( ! empty( $_SERVER['REMOTE_ADDR'] ) ) {
            $ip = sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) );
        }

        if ( empty( $ip ) ) {
            return true;
        }

        $ip_hash    = md5( $ip . 'curam_chat_rate' );
        $minute_key = 'curam_chat_rl_m_' . $ip_hash;
        $hour_key   = 'curam_chat_rl_h_' . $ip_hash;

        $minute_count = (int) get_transient( $minute_key );
        $hour_count   = (int) get_transient( $hour_key );

        if ( $minute_count >= self::$rate_limit_minute ) {
            Curam_Chat_Helpers::log( 'Rate limit exceeded (minute)', 'warning', array( 'ip' => $ip ) );
            return new WP_Error( 'rate_limited', 'Please wait a moment before sending another message.' );
        }

        if ( $hour_count >= self::$rate_limit_hour ) {
            Curam_Chat_Helpers::log( 'Rate limit exceeded (hour)', 'warning', array( 'ip' => $ip ) );
            return new WP_Error( 'rate_limited', 'You have reached the maximum number of requests. Please try again later.' );
        }

        if ( $minute_count === 0 ) {
            set_transient( $minute_key, 1, 60 );
        } else {
            set_transient( $minute_key, $minute_count + 1, 60 );
        }

        if ( $hour_count === 0 ) {
            set_transient( $hour_key, 1, 3600 );
        } else {
            set_transient( $hour_key, $hour_count + 1, 3600 );
        }

        return true;
    }

    private static function check_domain_relevance( $message ) {
        $irrelevant_raw = Curam_Chat_Helpers::get_setting( 'irrelevant_keywords', '' );
        $relevant_raw   = Curam_Chat_Helpers::get_setting( 'relevant_keywords', '' );

        if ( empty( $irrelevant_raw ) && empty( $relevant_raw ) ) {
            return true;
        }

        $message_lower = strtolower( $message );

        if ( ! empty( $irrelevant_raw ) ) {
            $irrelevant = array_filter( array_map( 'trim', explode( "\n", strtolower( $irrelevant_raw ) ) ) );
            foreach ( $irrelevant as $keyword ) {
                if ( ! empty( $keyword ) && strpos( $message_lower, $keyword ) !== false ) {
                    $business_name = Curam_Chat_Helpers::get_business_name();
                    Curam_Chat_Helpers::log( 'Domain filter rejected query', 'info', array(
                        'query'   => $message,
                        'matched' => $keyword,
                        'type'    => 'irrelevant',
                    ) );
                    return '<p>That question seems to be outside the scope of what I can help with. I\'m here to answer questions about ' . esc_html( $business_name ) . '\'s services and offerings.</p><p>Feel free to ask me something else, or contact us directly for assistance.</p>';
                }
            }
        }

        if ( ! empty( $relevant_raw ) ) {
            $relevant = array_filter( array_map( 'trim', explode( "\n", strtolower( $relevant_raw ) ) ) );
            if ( ! empty( $relevant ) ) {
                $found = false;
                foreach ( $relevant as $keyword ) {
                    if ( ! empty( $keyword ) && strpos( $message_lower, $keyword ) !== false ) {
                        $found = true;
                        break;
                    }
                }

                if ( ! $found ) {
                    return true;
                }
            }
        }

        return true;
    }

    private static function sanitize_history( $history ) {
        $clean = array();
        foreach ( $history as $entry ) {
            if ( ! is_array( $entry ) ) {
                continue;
            }
            $role    = isset( $entry['role'] ) ? sanitize_text_field( $entry['role'] ) : '';
            $content = isset( $entry['content'] ) ? sanitize_text_field( $entry['content'] ) : '';

            if ( ! in_array( $role, array( 'user', 'assistant' ), true ) ) {
                continue;
            }
            if ( empty( $content ) ) {
                continue;
            }

            $clean[] = array(
                'role'    => $role,
                'content' => $content,
            );
        }

        return array_slice( $clean, -20 );
    }

    private static function format_sources( $results ) {
        $sources = array(
            'page' => array(),
            'post' => array(),
            'pdf'  => array(),
        );

        if ( empty( $results ) ) {
            return $sources;
        }

        foreach ( $results as $result ) {
            $type    = isset( $result['source_type'] ) ? $result['source_type'] : 'page';
            $entry   = array(
                'title'   => isset( $result['title'] ) ? $result['title'] : '',
                'link'    => isset( $result['url'] ) ? $result['url'] : '',
                'type'    => $type,
                'excerpt' => isset( $result['excerpt'] ) ? wp_trim_words( $result['excerpt'], 30, '...' ) : '',
            );

            if ( isset( $sources[ $type ] ) ) {
                $sources[ $type ][] = $entry;
            } else {
                $sources[ $type ] = array( $entry );
            }
        }

        return $sources;
    }
}
