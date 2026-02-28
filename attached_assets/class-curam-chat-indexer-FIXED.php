<?php
if ( ! defined( 'WPINC' ) ) {
    die;
}

class Curam_Chat_Indexer {

    const MAX_CONTENT_LENGTH = 50000;

    public static function init() {
        add_action( 'save_post', array( __CLASS__, 'handle_save_post' ), 20, 2 );
        add_action( 'before_delete_post', array( __CLASS__, 'handle_delete_post' ) );
        add_action( 'curam_chat_daily_reindex', array( __CLASS__, 'reindex_all' ) );
        add_action( 'wp_ajax_curam_chat_reindex', array( __CLASS__, 'ajax_reindex' ) );
    }

    public static function get_indexable_post_types() {
        $types = array();
        if ( Curam_Chat_Helpers::get_setting( 'index_pages', '1' ) === '1' ) {
            $types[] = 'page';
        }
        if ( Curam_Chat_Helpers::get_setting( 'index_posts', '1' ) === '1' ) {
            $types[] = 'post';
        }
        return $types;
    }

    public static function is_pdf_indexing_enabled() {
        return Curam_Chat_Helpers::get_setting( 'index_pdfs', '0' ) === '1';
    }

    public static function get_excluded_ids() {
        $raw = Curam_Chat_Helpers::get_setting( 'excluded_ids', '' );
        if ( empty( $raw ) ) {
            return array();
        }
        return array_filter( array_map( 'absint', explode( ',', $raw ) ) );
    }

    public static function handle_save_post( $post_id, $post ) {
        if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
            return;
        }
        if ( wp_is_post_revision( $post_id ) ) {
            return;
        }

        $indexable_types = self::get_indexable_post_types();
        if ( empty( $indexable_types ) || ! in_array( $post->post_type, $indexable_types, true ) ) {
            return;
        }

        $excluded = self::get_excluded_ids();
        if ( in_array( $post_id, $excluded, true ) ) {
            return;
        }

        if ( $post->post_status === 'publish' ) {
            self::index_post( $post );
        } else {
            self::remove_from_index( $post_id, $post->post_type );
        }
    }

    public static function handle_delete_post( $post_id ) {
        $post = get_post( $post_id );
        if ( ! $post ) {
            return;
        }
        self::remove_from_index( $post_id, $post->post_type );
    }

    public static function index_post( $post ) {
        global $wpdb;
        $prefix = $wpdb->prefix;

        $post_id   = $post->ID;
        $post_type = $post->post_type;
        $title     = $post->post_title;
        $url       = get_permalink( $post_id );

        $raw_content = $post->post_content;
        $rendered    = apply_filters( 'the_content', $raw_content );

        $acf_content = '';
        if ( function_exists( 'get_field' ) ) {
            $acf_content = self::extract_acf_content( $post_id );
            Curam_Chat_Helpers::log( 'INDEX ACF extraction', 'debug', array(
                'post_id'        => $post_id,
                'acf_length'     => strlen( $acf_content ),
                'acf_preview'    => substr( wp_strip_all_tags( $acf_content ), 0, 200 ),
                'has_acf'        => ! empty( $acf_content ) ? 'yes' : 'no',
            ) );
        } else {
            Curam_Chat_Helpers::log( 'INDEX ACF not available (get_field missing)', 'debug', array( 'post_id' => $post_id ) );
        }

        $combined = $rendered . ' ' . $acf_content;

        $headings = self::extract_headings( $combined );
        $headings_text = implode( ' ', $headings );

        $stripped = wp_strip_all_tags( $combined );
        $stripped = html_entity_decode( $stripped, ENT_QUOTES, 'UTF-8' );
        $stripped = preg_replace( '/\s+/', ' ', $stripped );
        $stripped = trim( $stripped );

        if ( strlen( $stripped ) > self::MAX_CONTENT_LENGTH ) {
            $stripped = substr( $stripped, 0, self::MAX_CONTENT_LENGTH );
        }

        $word_count   = str_word_count( $stripped );
        $content_hash = md5( $title . $stripped );
        $excerpt      = wp_trim_words( $stripped, 55, '...' );
        $published_at = $post->post_date;

        Curam_Chat_Helpers::log( 'INDEX post content assembled', 'debug', array(
            'post_id'          => $post_id,
            'title'            => $title,
            'post_content_len' => strlen( $raw_content ),
            'rendered_len'     => strlen( $rendered ),
            'acf_len'          => strlen( $acf_content ),
            'combined_len'     => strlen( $stripped ),
            'word_count'       => $word_count,
            'headings_count'   => count( $headings ),
            'content_preview'  => substr( $stripped, 0, 200 ),
        ) );

        $existing = $wpdb->get_row( $wpdb->prepare(
            "SELECT id, content_hash FROM {$prefix}curam_chat_index WHERE source_type = %s AND source_id = %d",
            $post_type,
            $post_id
        ) );

        if ( $existing && $existing->content_hash === $content_hash ) {
            Curam_Chat_Helpers::log( 'Content unchanged, skipping index', 'debug', array(
                'post_id' => $post_id,
                'type'    => $post_type,
            ) );
            return false;
        }

        $now = current_time( 'mysql' );

        if ( $existing ) {
            $wpdb->update(
                "{$prefix}curam_chat_index",
                array(
                    'title'         => $title,
                    'url'           => $url,
                    'headings_text' => $headings_text,
                    'content'       => $stripped,
                    'excerpt'       => $excerpt,
                    'word_count'    => $word_count,
                    'content_hash'  => $content_hash,
                    'status'        => 'indexed',
                    'published_at'  => $published_at,
                    'updated_at'    => $now,
                ),
                array( 'id' => $existing->id ),
                array( '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s', '%s' ),
                array( '%d' )
            );
            $row_id = $existing->id;

            self::update_fts_row( $row_id, $title, $headings_text, $stripped );

            Curam_Chat_Helpers::log( 'Updated index entry', 'info', array(
                'post_id' => $post_id,
                'type'    => $post_type,
                'row_id'  => $row_id,
            ) );
        } else {
            $wpdb->insert(
                "{$prefix}curam_chat_index",
                array(
                    'source_type'   => $post_type,
                    'source_id'     => $post_id,
                    'title'         => $title,
                    'url'           => $url,
                    'headings_text' => $headings_text,
                    'content'       => $stripped,
                    'excerpt'       => $excerpt,
                    'word_count'    => $word_count,
                    'content_hash'  => $content_hash,
                    'status'        => 'indexed',
                    'published_at'  => $published_at,
                    'indexed_at'    => $now,
                    'updated_at'    => $now,
                ),
                array( '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s', '%s', '%s' )
            );
            $row_id = $wpdb->insert_id;

            self::insert_fts_row( $row_id, $title, $headings_text, $stripped );

            Curam_Chat_Helpers::log( 'Inserted index entry', 'info', array(
                'post_id' => $post_id,
                'type'    => $post_type,
                'row_id'  => $row_id,
            ) );
        }

        return true;
    }

    public static function remove_from_index( $post_id, $post_type ) {
        global $wpdb;
        $prefix = $wpdb->prefix;

        $existing = $wpdb->get_row( $wpdb->prepare(
            "SELECT id FROM {$prefix}curam_chat_index WHERE source_type = %s AND source_id = %d",
            $post_type,
            $post_id
        ) );

        if ( ! $existing ) {
            return;
        }

        self::delete_fts_row( $existing->id );

        $wpdb->delete(
            "{$prefix}curam_chat_index",
            array(
                'source_type' => $post_type,
                'source_id'   => $post_id,
            ),
            array( '%s', '%d' )
        );

        Curam_Chat_Helpers::log( 'Removed from index', 'info', array(
            'post_id' => $post_id,
            'type'    => $post_type,
        ) );
    }

    public static function reindex_all() {
        global $wpdb;
        $prefix = $wpdb->prefix;

        Curam_Chat_Helpers::log( 'Starting full re-index', 'info' );

        $post_types = self::get_indexable_post_types();
        if ( empty( $post_types ) ) {
            Curam_Chat_Helpers::log( 'No post types configured for indexing', 'info' );
            return array( 'indexed' => 0, 'skipped' => 0, 'removed' => 0 );
        }

        $excluded = self::get_excluded_ids();

        $type_placeholders = implode( ',', array_fill( 0, count( $post_types ), '%s' ) );
        $args = $post_types;

        $query = "SELECT ID FROM {$wpdb->posts} WHERE post_type IN ($type_placeholders) AND post_status = 'publish'";

        if ( ! empty( $excluded ) ) {
            $id_placeholders = implode( ',', array_fill( 0, count( $excluded ), '%d' ) );
            $query .= " AND ID NOT IN ($id_placeholders)";
            $args  = array_merge( $args, $excluded );
        }

        $post_ids = $wpdb->get_col( $wpdb->prepare( $query, $args ) );

        $indexed  = 0;
        $skipped  = 0;

        foreach ( $post_ids as $pid ) {
            $post = get_post( (int) $pid );
            if ( ! $post ) {
                continue;
            }
            $result = self::index_post( $post );
            if ( $result ) {
                $indexed++;
            } else {
                $skipped++;
            }
        }

        $existing_source_ids = $wpdb->get_results(
            "SELECT id, source_type, source_id FROM {$prefix}curam_chat_index"
        );

        $removed = 0;
        foreach ( $existing_source_ids as $row ) {
            if ( $row->source_type === 'pdf' ) {
                continue;
            }

            $still_valid = false;
            if ( in_array( $row->source_type, $post_types, true ) ) {
                $source_id = (int) $row->source_id;
                if ( in_array( $source_id, array_map( 'intval', $post_ids ), true ) ) {
                    $still_valid = true;
                }
            }

            if ( ! $still_valid ) {
                self::delete_fts_row( $row->id );
                $wpdb->delete( "{$prefix}curam_chat_index", array( 'id' => $row->id ), array( '%d' ) );
                $removed++;
            }
        }

        $pdf_result  = self::index_pdfs();
        $pdf_indexed = $pdf_result['indexed'];
        $pdf_failed  = $pdf_result['failed'];
        $pdf_removed = $pdf_result['removed'] ?? 0;
        $removed    += $pdf_removed;

        self::build_word_dictionary();

        Curam_Chat_Helpers::log( 'Full re-index complete', 'info', array(
            'indexed'      => $indexed,
            'skipped'      => $skipped,
            'removed'      => $removed,
            'pdf_indexed'  => $pdf_indexed,
            'pdf_excluded' => $pdf_result['excluded'] ?? 0,
            'pdf_removed'  => $pdf_removed,
            'pdf_failed'   => $pdf_failed,
        ) );

        return array(
            'indexed'      => $indexed + $pdf_indexed,
            'skipped'      => $skipped,
            'removed'      => $removed,
            'pdf_indexed'  => $pdf_indexed,
            'pdf_excluded' => $pdf_result['excluded'] ?? 0,
            'pdf_removed'  => $pdf_removed,
            'pdf_failed'   => $pdf_failed,
        );
    }

    public static function ajax_reindex() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_send_json_error( array( 'message' => 'Unauthorized' ), 403 );
            return;
        }

        check_ajax_referer( 'curam_chat_admin_nonce', 'nonce' );

        $result = self::reindex_all();

        $pdf_info = '';
        $has_pdf_activity = ! empty( $result['pdf_indexed'] ) || ! empty( $result['pdf_failed'] )
                         || ! empty( $result['pdf_excluded'] ) || ! empty( $result['pdf_removed'] );
        if ( $has_pdf_activity ) {
            $pdf_parts = array();
            if ( ! empty( $result['pdf_indexed'] ) ) {
                $pdf_parts[] = sprintf( '%d indexed', $result['pdf_indexed'] );
            }
            if ( ! empty( $result['pdf_excluded'] ) ) {
                $pdf_parts[] = sprintf( '%d excluded', $result['pdf_excluded'] );
            }
            if ( ! empty( $result['pdf_removed'] ) ) {
                $pdf_parts[] = sprintf( '%d removed', $result['pdf_removed'] );
            }
            if ( ! empty( $result['pdf_failed'] ) ) {
                $pdf_parts[] = sprintf( '%d failed', $result['pdf_failed'] );
            }
            if ( ! empty( $pdf_parts ) ) {
                $pdf_info = ' PDFs: ' . implode( ', ', $pdf_parts ) . '.';
            }
        }

        wp_send_json_success( array(
            'message' => sprintf(
                'Re-index complete: %d indexed, %d unchanged, %d removed.%s',
                $result['indexed'],
                $result['skipped'],
                $result['removed'],
                $pdf_info
            ),
            'stats' => $result,
        ) );
    }

    public static function get_index_stats() {
        global $wpdb;
        $prefix = $wpdb->prefix;

        $total = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$prefix}curam_chat_index" );

        $by_type = $wpdb->get_results(
            "SELECT source_type, COUNT(*) as count FROM {$prefix}curam_chat_index GROUP BY source_type"
        );

        $last_indexed = $wpdb->get_var(
            "SELECT MAX(updated_at) FROM {$prefix}curam_chat_index"
        );

        $stats = array(
            'total'        => $total,
            'by_type'      => array(),
            'last_indexed' => $last_indexed,
        );

        foreach ( $by_type as $row ) {
            $stats['by_type'][ $row->source_type ] = (int) $row->count;
        }

        return $stats;
    }

    public static function build_word_dictionary() {
        global $wpdb;
        $prefix = $wpdb->prefix;

        $rows = $wpdb->get_results(
            "SELECT title, headings_text FROM {$prefix}curam_chat_index WHERE status = 'indexed'"
        );

        $words = array();
        foreach ( $rows as $row ) {
            $text = strtolower( $row->title . ' ' . $row->headings_text );
            $text = preg_replace( '/[^\w\s\'-]/u', ' ', $text );
            $tokens = preg_split( '/\s+/', $text, -1, PREG_SPLIT_NO_EMPTY );
            foreach ( $tokens as $token ) {
                $token = trim( $token, "'-" );
                if ( strlen( $token ) >= 3 ) {
                    $words[ $token ] = true;
                }
            }
        }

        $dictionary = array_keys( $words );
        update_option( 'curam_chat_word_dictionary', $dictionary, false );

        Curam_Chat_Helpers::log( 'Word dictionary rebuilt', 'info', array(
            'word_count' => count( $dictionary ),
        ) );

        return $dictionary;
    }

    private static function extract_acf_content( $post_id ) {
        $parts = array();

        $format_blocks = get_field( 'format_blocks', $post_id );
        if ( is_array( $format_blocks ) ) {
            foreach ( $format_blocks as $block ) {
                self::collect_acf_text( $block, $parts );
            }
        }

        $all_fields = get_fields( $post_id );
        if ( is_array( $all_fields ) ) {
            foreach ( $all_fields as $key => $value ) {
                if ( $key === 'format_blocks' ) {
                    continue;
                }
                self::collect_acf_text( array( $key => $value ), $parts );
            }
        }

        return implode( ' ', $parts );
    }

    private static function collect_acf_text( $data, &$parts ) {
        if ( ! is_array( $data ) ) {
            if ( is_string( $data ) && strlen( $data ) > 2 && strlen( $data ) < 100000 ) {
                if ( preg_match( '/^(https?:\/\/|#|[0-9a-f]{6,8}$|\d+px)/i', $data ) ) {
                    return;
                }
                if ( strip_tags( $data ) !== $data ) {
                    $parts[] = $data;
                } elseif ( strlen( $data ) > 5 ) {
                    $parts[] = $data;
                }
            }
            return;
        }

        foreach ( $data as $key => $value ) {
            if ( is_string( $key ) && in_array( $key, array(
                'block_id', 'block_class', 'acf_fc_layout',
                'background_color', 'background_image', 'bkgnd_image',
                'display_block', 'fade_effect', 'margin_top', 'margin_bottom',
                'block_width', 'number_of_colums', 'button_position',
                'panel_width', 'text_alignment', 'text_color',
            ), true ) ) {
                continue;
            }

            if ( is_array( $value ) ) {
                if ( isset( $value['url'] ) && isset( $value['alt'] ) ) {
                    if ( ! empty( $value['alt'] ) ) {
                        $parts[] = $value['alt'];
                    }
                    continue;
                }
                self::collect_acf_text( $value, $parts );
            } elseif ( is_string( $value ) && strlen( $value ) > 2 && strlen( $value ) < 100000 ) {
                if ( preg_match( '/^(https?:\/\/|#[0-9a-fA-F]|[0-9a-f]{6,8}$|\d+px)/i', $value ) ) {
                    continue;
                }
                if ( strip_tags( $value ) !== $value ) {
                    $parts[] = $value;
                } elseif ( strlen( $value ) > 5 ) {
                    $parts[] = $value;
                }
            }
        }
    }

    private static function extract_headings( $html ) {
        $headings = array();
        if ( preg_match_all( '/<h[1-3][^>]*>(.*?)<\/h[1-3]>/is', $html, $matches ) ) {
            foreach ( $matches[1] as $heading ) {
                $clean = wp_strip_all_tags( $heading );
                $clean = trim( $clean );
                if ( ! empty( $clean ) ) {
                    $headings[] = $clean;
                }
            }
        }
        return $headings;
    }

    private static function extract_pdf_headings( $text ) {
        $headings = array();
        $lines = explode( "\n", $text );
        $line_count = count( $lines );

        foreach ( $lines as $i => $line ) {
            $trimmed = trim( $line );
            if ( empty( $trimmed ) ) {
                continue;
            }

            $word_count = str_word_count( $trimmed );
            if ( $word_count > 15 ) {
                continue;
            }

            $is_heading = false;

            if ( $trimmed === strtoupper( $trimmed ) && preg_match( '/[A-Z]/', $trimmed ) && $word_count >= 1 ) {
                $is_heading = true;
            }

            if ( preg_match( '/^\d+(\.\d+)*[\.\)]\s+[A-Z]/', $trimmed ) && $word_count <= 12 ) {
                $is_heading = true;
            }

            if ( preg_match( "/^[A-Z][a-zA-Z0-9'\s\-&,:()]+$/", $trimmed ) && $word_count >= 2 && $word_count <= 10 ) {
                $prev_blank = ( $i > 0 && trim( $lines[ $i - 1 ] ) === '' );
                $next_blank = ( $i < $line_count - 1 && trim( $lines[ $i + 1 ] ) === '' );
                $next_longer = ( $i < $line_count - 1 && strlen( trim( $lines[ $i + 1 ] ) ) > strlen( $trimmed ) * 1.5 );

                if ( $prev_blank || $next_blank || $next_longer ) {
                    $is_heading = true;
                }
            }

            if ( preg_match( '/^(Part|Section|Chapter|Article|Schedule|Appendix|Annex)\s+/i', $trimmed ) && $word_count <= 10 ) {
                $is_heading = true;
            }

            if ( $is_heading ) {
                $clean = preg_replace( '/^\d+(\.\d+)*[\.\)]\s+/', '', $trimmed );
                $clean = trim( $clean );
                if ( strlen( $clean ) >= 3 && ! in_array( $clean, $headings, true ) ) {
                    $headings[] = $clean;
                }
            }
        }

        return $headings;
    }

    private static function insert_fts_row( $rowid, $title, $headings_text, $content ) {
        if ( ! Curam_Chat_Installer::is_sqlite() ) {
            return;
        }
        global $wpdb;
        $prefix = $wpdb->prefix;

        $result = $wpdb->query( $wpdb->prepare(
            "INSERT INTO {$prefix}curam_chat_index_fts (rowid, title, headings_text, content) VALUES (%d, %s, %s, %s)",
            $rowid,
            $title,
            $headings_text,
            $content
        ) );

        Curam_Chat_Helpers::log( 'FTS row inserted', 'debug', array(
            'rowid'           => $rowid,
            'title_len'       => strlen( $title ),
            'headings_len'    => strlen( $headings_text ),
            'content_len'     => strlen( $content ),
            'insert_result'   => $result !== false ? 'OK' : 'FAILED',
            'db_error'        => $wpdb->last_error ?: 'none',
        ) );
    }

    private static function update_fts_row( $rowid, $title, $headings_text, $content ) {
        if ( ! Curam_Chat_Installer::is_sqlite() ) {
            return;
        }
        self::delete_fts_row( $rowid );
        self::insert_fts_row( $rowid, $title, $headings_text, $content );
    }

    private static function delete_fts_row( $rowid ) {
        if ( ! Curam_Chat_Installer::is_sqlite() ) {
            return;
        }
        global $wpdb;
        $prefix = $wpdb->prefix;

        $row = $wpdb->get_row( $wpdb->prepare(
            "SELECT title, headings_text, content FROM {$prefix}curam_chat_index WHERE id = %d",
            $rowid
        ) );

        if ( $row ) {
            $wpdb->query( $wpdb->prepare(
                "INSERT INTO {$prefix}curam_chat_index_fts ({$prefix}curam_chat_index_fts, rowid, title, headings_text, content) VALUES ('delete', %d, %s, %s, %s)",
                $rowid,
                $row->title,
                $row->headings_text,
                $row->content
            ) );
        }
    }

    public static function index_pdfs() {
        $pdf_enabled = self::is_pdf_indexing_enabled();

        Curam_Chat_Helpers::log( '=== PDF INDEXING START ===', 'info', array(
            'pdf_indexing_enabled' => $pdf_enabled ? 'YES' : 'NO',
            'setting_value'        => Curam_Chat_Helpers::get_setting( 'index_pdfs', '0' ),
        ) );

        if ( ! $pdf_enabled ) {
            Curam_Chat_Helpers::log( 'PDF indexing is DISABLED in settings. Enable it at Settings > Curam AI Chat > Content Indexing > Index PDFs', 'info' );
            $removed = self::cleanup_stale_pdfs( array() );
            return array( 'indexed' => 0, 'skipped' => 0, 'excluded' => 0, 'removed' => $removed, 'failed' => 0 );
        }

        global $wpdb;
        $prefix = $wpdb->prefix;

        $smalot_status = self::check_smalot_availability();
        Curam_Chat_Helpers::log( 'PDF extraction tools available', 'info', array(
            'smalot_pdfparser' => $smalot_status['available'] ? 'YES (' . $smalot_status['path'] . ')' : 'NO - ' . $smalot_status['reason'],
            'pdftotext_cli'    => function_exists( 'exec' ) ? 'checking...' : 'NO (exec disabled)',
            'php_fallback'     => 'YES (always available)',
        ) );

        $pdf_attachments = get_posts( array(
            'post_type'      => 'attachment',
            'post_mime_type' => 'application/pdf',
            'post_status'    => 'inherit',
            'posts_per_page' => -1,
            'fields'         => 'ids',
        ) );

        if ( empty( $pdf_attachments ) ) {
            Curam_Chat_Helpers::log( 'No PDF attachments found in media library', 'info' );
            $removed = self::cleanup_stale_pdfs( array() );
            return array( 'indexed' => 0, 'skipped' => 0, 'excluded' => 0, 'removed' => $removed, 'failed' => 0 );
        }

        Curam_Chat_Helpers::log( 'Found PDF attachments in media library', 'info', array(
            'count' => count( $pdf_attachments ),
            'ids'   => implode( ', ', array_slice( $pdf_attachments, 0, 20 ) ),
        ) );

        $excluded = self::get_excluded_ids();
        $indexed  = 0;
        $skipped  = 0;
        $failed   = 0;
        $indexed_titles = array();

        $excluded_folders = self::get_excluded_pdf_folders();
        $excluded_files   = self::get_excluded_pdf_files();

        Curam_Chat_Helpers::log( 'PDF exclusion rules loaded', 'info', array(
            'excluded_id_count'     => count( $excluded ),
            'excluded_folder_rules' => implode( ' | ', $excluded_folders ),
            'excluded_file_rules'   => implode( ' | ', $excluded_files ),
        ) );

        $valid_pdf_ids    = array();
        $excluded_count   = 0;
        $rule_hit_counts  = array();
        $rule_examples    = array();

        foreach ( $pdf_attachments as $attachment_id ) {
            if ( in_array( $attachment_id, $excluded, true ) ) {
                $excluded_count++;
                $rule = 'excluded_id:' . $attachment_id;
                $rule_hit_counts[ $rule ] = ( $rule_hit_counts[ $rule ] ?? 0 ) + 1;
                continue;
            }

            $file_path = get_attached_file( $attachment_id );
            $matched_rule = $file_path ? self::get_exclusion_rule( $file_path, $excluded_folders, $excluded_files ) : null;
            if ( $matched_rule ) {
                $excluded_count++;
                $rule_hit_counts[ $matched_rule ] = ( $rule_hit_counts[ $matched_rule ] ?? 0 ) + 1;
                if ( ( $rule_hit_counts[ $matched_rule ] ?? 0 ) <= 3 ) {
                    $rule_examples[ $matched_rule ][] = basename( $file_path );
                }
                continue;
            }

            $valid_pdf_ids[] = (int) $attachment_id;

            Curam_Chat_Helpers::log( 'Processing PDF', 'info', array(
                'attachment_id' => $attachment_id,
                'title'         => get_the_title( $attachment_id ),
                'file'          => $file_path ? basename( $file_path ) : 'UNKNOWN',
                'file_exists'   => $file_path && file_exists( $file_path ) ? 'YES' : 'NO',
                'file_size'     => $file_path && file_exists( $file_path ) ? round( filesize( $file_path ) / 1024, 1 ) . ' KB' : 'N/A',
            ) );

            $result = self::index_single_pdf( $attachment_id );
            if ( $result === true ) {
                $indexed++;
                $title = get_the_title( $attachment_id );
                if ( empty( $title ) ) {
                    $title = basename( get_attached_file( $attachment_id ), '.pdf' );
                }
                $indexed_titles[] = $title;
            } elseif ( $result === false ) {
                $skipped++;
            } else {
                $failed++;
            }
        }

        $removed = self::cleanup_stale_pdfs( $valid_pdf_ids );

        if ( ! empty( $rule_hit_counts ) ) {
            $rule_summary = array();
            foreach ( $rule_hit_counts as $rule => $count ) {
                $examples = isset( $rule_examples[ $rule ] ) ? implode( ', ', $rule_examples[ $rule ] ) : '';
                $rule_summary[] = $rule . ' (' . $count . ' PDFs' . ( $examples ? ', e.g. ' . $examples : '' ) . ')';
            }
            Curam_Chat_Helpers::log( 'PDF exclusion breakdown', 'info', array(
                'rules_triggered' => implode( ' | ', $rule_summary ),
            ) );
        }

        Curam_Chat_Helpers::log( '=== PDF INDEXING COMPLETE ===', 'info', array(
            'indexed'        => $indexed,
            'skipped'        => $skipped,
            'excluded'       => $excluded_count,
            'removed'        => $removed,
            'failed'         => $failed,
            'indexed_titles' => $indexed_titles,
        ) );

        return array(
            'indexed'  => $indexed,
            'skipped'  => $skipped,
            'excluded' => $excluded_count,
            'removed'  => $removed,
            'failed'   => $failed,
        );
    }

    private static function check_smalot_availability() {
        $paths_to_check = array(
            __DIR__ . '/smalot/alt_autoload.php',
            __DIR__ . '/smalot/autoload.php',
            __DIR__ . '/../vendor/autoload.php',
            dirname( __DIR__ ) . '/vendor/autoload.php',
            ABSPATH . 'vendor/autoload.php',
        );

        if ( defined( 'CURAM_CHAT_PATH' ) ) {
            $paths_to_check[] = CURAM_CHAT_PATH . 'vendor/autoload.php';
            $paths_to_check[] = CURAM_CHAT_PATH . 'includes/smalot/alt_autoload.php';
            $paths_to_check[] = CURAM_CHAT_PATH . 'includes/smalot/autoload.php';
        }

        foreach ( $paths_to_check as $path ) {
            if ( file_exists( $path ) ) {
                return array( 'available' => true, 'path' => $path, 'reason' => '' );
            }
        }

        return array(
            'available' => false,
            'path'      => '',
            'reason'    => 'Autoloader not found. Checked: ' . implode( ', ', array_map( 'basename', $paths_to_check ) ),
        );
    }

    private static function find_smalot_autoloader() {
        $paths_to_check = array(
            __DIR__ . '/smalot/alt_autoload.php',
            __DIR__ . '/smalot/autoload.php',
            __DIR__ . '/../vendor/autoload.php',
            dirname( __DIR__ ) . '/vendor/autoload.php',
            ABSPATH . 'vendor/autoload.php',
        );

        if ( defined( 'CURAM_CHAT_PATH' ) ) {
            $paths_to_check[] = CURAM_CHAT_PATH . 'vendor/autoload.php';
            $paths_to_check[] = CURAM_CHAT_PATH . 'includes/smalot/alt_autoload.php';
            $paths_to_check[] = CURAM_CHAT_PATH . 'includes/smalot/autoload.php';
        }

        foreach ( $paths_to_check as $path ) {
            if ( file_exists( $path ) ) {
                return $path;
            }
        }

        return false;
    }

    private static function index_single_pdf( $attachment_id ) {
        global $wpdb;
        $prefix = $wpdb->prefix;

        $file_path = get_attached_file( $attachment_id );
        if ( ! $file_path || ! file_exists( $file_path ) ) {
            Curam_Chat_Helpers::log( 'PDF FAILED: file not found', 'warning', array(
                'attachment_id' => $attachment_id,
                'path'          => $file_path ?: 'NULL',
            ) );
            return 'failed';
        }

        $title = get_the_title( $attachment_id );
        if ( empty( $title ) ) {
            $title = basename( $file_path, '.pdf' );
        }

        $url = wp_get_attachment_url( $attachment_id );

        Curam_Chat_Helpers::log( 'PDF extracting text', 'info', array(
            'attachment_id' => $attachment_id,
            'title'         => $title,
            'file'          => basename( $file_path ),
            'size_kb'       => round( filesize( $file_path ) / 1024, 1 ),
        ) );

        $text = self::extract_pdf_text( $file_path );

        if ( empty( $text ) ) {
            Curam_Chat_Helpers::log( 'PDF FAILED: text extraction returned empty', 'warning', array(
                'attachment_id' => $attachment_id,
                'title'         => $title,
                'file'          => basename( $file_path ),
            ) );
            return 'failed';
        }

        $pdf_headings = self::extract_pdf_headings( $text );
        $headings_text = implode( ' ', $pdf_headings );

        Curam_Chat_Helpers::log( 'PDF headings extracted', 'info', array(
            'attachment_id'  => $attachment_id,
            'title'          => $title,
            'headings_count' => count( $pdf_headings ),
            'headings'       => implode( ' | ', array_slice( $pdf_headings, 0, 10 ) ),
        ) );

        $text_clean = preg_replace( '/\s+/', ' ', $text );
        $text_clean = trim( $text_clean );

        if ( strlen( $text_clean ) > self::MAX_CONTENT_LENGTH ) {
            $text_clean = substr( $text_clean, 0, self::MAX_CONTENT_LENGTH );
        }

        $word_count   = str_word_count( $text_clean );
        $content_hash = md5( $title . $text_clean );
        $excerpt      = wp_trim_words( $text_clean, 55, '...' );

        $target_phrase = 'alternative dispute resolution';
        $has_adr = stripos( $text_clean, $target_phrase ) !== false;
        Curam_Chat_Helpers::log( 'PDF content check for target phrase', 'info', array(
            'attachment_id'   => $attachment_id,
            'title'           => $title,
            'word_count'      => $word_count,
            'content_length'  => strlen( $text_clean ),
            'has_ADR_phrase'  => $has_adr ? 'YES - FOUND' : 'no',
            'headings_text'   => substr( $headings_text, 0, 300 ),
            'content_preview' => substr( $text_clean, 0, 500 ),
        ) );

        $existing = $wpdb->get_row( $wpdb->prepare(
            "SELECT id, content_hash, word_count FROM {$prefix}curam_chat_index WHERE source_type = 'pdf' AND source_id = %d",
            $attachment_id
        ) );

        $min_word_count  = 50;
        $has_bad_content = $existing && (int) $existing->word_count < $min_word_count;

        if ( $existing && $existing->content_hash === $content_hash && ! $has_bad_content ) {
            Curam_Chat_Helpers::log( 'PDF unchanged, skipping', 'debug', array(
                'attachment_id' => $attachment_id,
                'title'         => $title,
            ) );
            return false;
        }

        if ( $has_bad_content ) {
            Curam_Chat_Helpers::log( 'PDF re-extracting due to low word count', 'info', array(
                'attachment_id'    => $attachment_id,
                'title'            => $title,
                'stored_words'     => (int) $existing->word_count,
                'new_words'        => $word_count,
            ) );
        }

        $now = current_time( 'mysql' );

        if ( $existing ) {
            $update_result = $wpdb->update(
                "{$prefix}curam_chat_index",
                array(
                    'title'         => $title,
                    'url'           => $url,
                    'headings_text' => $headings_text,
                    'content'       => $text_clean,
                    'excerpt'       => $excerpt,
                    'word_count'    => $word_count,
                    'content_hash'  => $content_hash,
                    'status'        => 'indexed',
                    'updated_at'    => $now,
                ),
                array( 'id' => $existing->id ),
                array( '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s' ),
                array( '%d' )
            );
            self::update_fts_row( $existing->id, $title, $headings_text, $text_clean );

            Curam_Chat_Helpers::log( 'PDF index UPDATED', 'info', array(
                'attachment_id'  => $attachment_id,
                'title'          => $title,
                'word_count'     => $word_count,
                'row_id'         => $existing->id,
                'update_result'  => $update_result !== false ? 'OK' : 'FAILED',
                'db_error'       => $wpdb->last_error ?: 'none',
                'headings_count' => count( $pdf_headings ),
            ) );
        } else {
            $insert_result = $wpdb->insert(
                "{$prefix}curam_chat_index",
                array(
                    'source_type'   => 'pdf',
                    'source_id'     => $attachment_id,
                    'title'         => $title,
                    'url'           => $url,
                    'headings_text' => $headings_text,
                    'content'       => $text_clean,
                    'excerpt'       => $excerpt,
                    'word_count'    => $word_count,
                    'content_hash'  => $content_hash,
                    'status'        => 'indexed',
                    'published_at'  => $now,
                    'indexed_at'    => $now,
                    'updated_at'    => $now,
                ),
                array( '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s', '%s', '%s' )
            );
            $row_id = $wpdb->insert_id;
            self::insert_fts_row( $row_id, $title, $headings_text, $text_clean );

            Curam_Chat_Helpers::log( 'PDF index INSERTED', 'info', array(
                'attachment_id'  => $attachment_id,
                'title'          => $title,
                'word_count'     => $word_count,
                'row_id'         => $row_id,
                'insert_result'  => $insert_result !== false ? 'OK' : 'FAILED',
                'db_error'       => $wpdb->last_error ?: 'none',
                'headings_count' => count( $pdf_headings ),
                'fts_populated'  => Curam_Chat_Installer::is_sqlite() ? 'yes' : 'n/a (MySQL)',
            ) );
        }

        return true;
    }

    public static function extract_pdf_text( $file_path ) {
        Curam_Chat_Helpers::log( 'PDF text extraction starting', 'info', array(
            'file'   => basename( $file_path ),
            'path'   => $file_path,
            'exists' => file_exists( $file_path ) ? 'YES' : 'NO',
            'size'   => file_exists( $file_path ) ? round( filesize( $file_path ) / 1024, 1 ) . ' KB' : 'N/A',
        ) );

        $text = self::extract_pdf_via_pdftotext( $file_path );
        if ( ! empty( $text ) ) {
            Curam_Chat_Helpers::log( 'PDF extracted via pdftotext (method 1)', 'info', array(
                'file'   => basename( $file_path ),
                'length' => strlen( $text ),
                'words'  => str_word_count( $text ),
            ) );
        } else {
            Curam_Chat_Helpers::log( 'pdftotext extraction returned empty, trying smalot', 'debug', array(
                'file' => basename( $file_path ),
            ) );
        }

        if ( empty( $text ) ) {
            $text = self::extract_via_smalot( $file_path );
            if ( ! empty( $text ) ) {
                Curam_Chat_Helpers::log( 'PDF extracted via smalot (method 2)', 'info', array(
                    'file'   => basename( $file_path ),
                    'length' => strlen( $text ),
                    'words'  => str_word_count( $text ),
                ) );
            } else {
                Curam_Chat_Helpers::log( 'smalot extraction returned empty, trying PHP fallback', 'debug', array(
                    'file' => basename( $file_path ),
                ) );
            }
        }

        if ( empty( $text ) ) {
            $text = self::extract_pdf_via_php( $file_path );
            if ( ! empty( $text ) ) {
                Curam_Chat_Helpers::log( 'PDF extracted via PHP fallback (method 3)', 'info', array(
                    'file'   => basename( $file_path ),
                    'length' => strlen( $text ),
                    'words'  => str_word_count( $text ),
                ) );
            }
        }

        if ( empty( $text ) ) {
            Curam_Chat_Helpers::log( 'PDF EXTRACTION FAILED - all 3 methods returned empty', 'warning', array(
                'file' => basename( $file_path ),
            ) );
            return '';
        }

        $text = self::clean_pdf_text( $text );

        Curam_Chat_Helpers::log( 'PDF text extraction complete', 'info', array(
            'file'    => basename( $file_path ),
            'length'  => strlen( $text ),
            'words'   => str_word_count( $text ),
            'preview' => substr( $text, 0, 300 ),
        ) );

        return $text;
    }

    private static function clean_pdf_text( $text ) {
        $text = preg_replace( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', ' ', $text );
        $text = preg_replace( '/\xEF\xBB\xBF/', '', $text );
        $text = preg_replace( '/[ \t]+/', ' ', $text );
        $text = preg_replace( '/\n{3,}/', "\n\n", $text );
        $text = trim( $text );
        if ( ! mb_check_encoding( $text, 'UTF-8' ) ) {
            $text = mb_convert_encoding( $text, 'UTF-8', 'auto' );
        }
        return $text;
    }

    private static function extract_via_smalot( $file_path ) {
        $autoloader = self::find_smalot_autoloader();

        if ( ! $autoloader ) {
            Curam_Chat_Helpers::log( 'Smalot autoloader NOT FOUND at any expected location', 'warning', array(
                'includes_dir' => __DIR__,
                'plugin_dir'   => defined( 'CURAM_CHAT_PATH' ) ? CURAM_CHAT_PATH : 'not defined',
                'checked_paths' => implode( ', ', array(
                    __DIR__ . '/smalot/alt_autoload.php',
                    __DIR__ . '/smalot/autoload.php',
                    __DIR__ . '/../vendor/autoload.php',
                    dirname( __DIR__ ) . '/vendor/autoload.php',
                ) ),
            ) );
            return '';
        }

        Curam_Chat_Helpers::log( 'Loading smalot autoloader', 'info', array(
            'path' => $autoloader,
        ) );

        require_once $autoloader;

        if ( ! class_exists( '\Smalot\PdfParser\Parser' ) ) {
            Curam_Chat_Helpers::log( 'Smalot Parser class NOT FOUND after loading autoloader', 'warning', array(
                'autoloader_path' => $autoloader,
            ) );
            return '';
        }

        Curam_Chat_Helpers::log( 'Smalot Parser class loaded successfully', 'info' );

        try {
            $parser = new \Smalot\PdfParser\Parser();
            $pdf    = $parser->parseFile( $file_path );

            $pages = $pdf->getPages();
            Curam_Chat_Helpers::log( 'Smalot parsed PDF', 'info', array(
                'file'       => basename( $file_path ),
                'page_count' => count( $pages ),
            ) );

            $text = $pdf->getText();

            Curam_Chat_Helpers::log( 'Smalot getText result', 'info', array(
                'file'    => basename( $file_path ),
                'length'  => strlen( $text ),
                'words'   => str_word_count( $text ),
                'empty'   => empty( $text ) ? 'YES - PROBLEM' : 'no',
                'preview' => substr( $text, 0, 300 ),
            ) );

            return $text ?: '';
        } catch ( \Exception $e ) {
            Curam_Chat_Helpers::log( 'Smalot extraction EXCEPTION', 'warning', array(
                'file'    => basename( $file_path ),
                'error'   => $e->getMessage(),
                'class'   => get_class( $e ),
            ) );
            return '';
        }
    }

    private static function extract_pdf_via_pdftotext( $file_path ) {
        if ( ! function_exists( 'exec' ) ) {
            Curam_Chat_Helpers::log( 'pdftotext skipped: exec() disabled', 'debug' );
            return '';
        }

        $check = array();
        if ( PHP_OS_FAMILY === 'Windows' ) {
            @exec( 'where pdftotext 2>NUL', $check );
        } else {
            @exec( 'which pdftotext 2>/dev/null', $check );
        }
        if ( empty( $check ) ) {
            Curam_Chat_Helpers::log( 'pdftotext not installed on server', 'debug' );
            return '';
        }

        $file_size = @filesize( $file_path );
        if ( $file_size > 50 * 1024 * 1024 ) {
            Curam_Chat_Helpers::log( 'PDF too large for pdftotext', 'warning', array(
                'file' => basename( $file_path ),
                'size' => round( $file_size / 1024 / 1024, 1 ) . 'MB',
            ) );
            return '';
        }

        $escaped_path = escapeshellarg( $file_path );
        $output = array();
        $return_code = 0;

        $redirect = PHP_OS_FAMILY === 'Windows' ? '2>NUL' : '2>/dev/null';
        @exec( 'pdftotext -layout ' . $escaped_path . ' - ' . $redirect, $output, $return_code );

        if ( $return_code !== 0 || empty( $output ) ) {
            Curam_Chat_Helpers::log( 'pdftotext returned error or empty', 'debug', array(
                'file'        => basename( $file_path ),
                'return_code' => $return_code,
                'output_lines' => count( $output ),
            ) );
            return '';
        }

        $text = implode( "\n", $output );
        $text = trim( $text );

        Curam_Chat_Helpers::log( 'pdftotext extraction result', 'debug', array(
            'file'   => basename( $file_path ),
            'length' => strlen( $text ),
            'words'  => str_word_count( $text ),
        ) );

        return $text;
    }

    private static function extract_pdf_via_php( $file_path ) {
        $content = @file_get_contents( $file_path );
        if ( empty( $content ) ) {
            return '';
        }

        $text = '';

        if ( preg_match_all( '/stream\s*\n(.*?)\nendstream/s', $content, $matches ) ) {
            foreach ( $matches[1] as $stream_data ) {
                $decoded = @gzuncompress( $stream_data );
                if ( $decoded === false ) {
                    $decoded = $stream_data;
                }

                if ( preg_match_all( '/\((.*?)\)/s', $decoded, $text_matches ) ) {
                    $text .= implode( ' ', $text_matches[1] ) . ' ';
                }

                if ( preg_match_all( '/\[((?:\(.*?\)|<.*?>|[\d.\s\-]+)+)\]\s*TJ/s', $decoded, $tj_matches ) ) {
                    foreach ( $tj_matches[1] as $tj_content ) {
                        if ( preg_match_all( '/\((.*?)\)/s', $tj_content, $inner ) ) {
                            $text .= implode( '', $inner[1] ) . ' ';
                        }
                    }
                }
            }
        }

        $text = preg_replace( '/[^\x20-\x7E\n\r\t]/', '', $text );
        $text = preg_replace( '/\s+/', ' ', $text );
        $text = trim( $text );

        if ( strlen( $text ) < 20 ) {
            Curam_Chat_Helpers::log( 'PHP PDF fallback: insufficient text', 'debug', array(
                'file'   => basename( $file_path ),
                'length' => strlen( $text ),
            ) );
            return '';
        }

        Curam_Chat_Helpers::log( 'PHP PDF fallback extraction result', 'debug', array(
            'file'   => basename( $file_path ),
            'length' => strlen( $text ),
            'words'  => str_word_count( $text ),
        ) );

        return $text;
    }

    private static function get_excluded_pdf_folders() {
        $raw = Curam_Chat_Helpers::get_setting( 'excluded_pdf_folders', '' );
        if ( empty( $raw ) ) {
            return array();
        }
        $folders = array_filter( array_map( 'trim', explode( "\n", $raw ) ) );
        return array_map( function( $f ) {
            return trim( $f, '/' );
        }, $folders );
    }

    private static function get_excluded_pdf_files() {
        $raw = Curam_Chat_Helpers::get_setting( 'excluded_pdf_files', '' );
        if ( empty( $raw ) ) {
            return array();
        }
        return array_filter( array_map( 'trim', explode( "\n", $raw ) ) );
    }

    private static function get_exclusion_rule( $file_path, $excluded_folders, $excluded_files ) {
        $file_path = wp_normalize_path( $file_path );
        $filename  = basename( $file_path );

        foreach ( $excluded_files as $excluded_file ) {
            if ( strcasecmp( $filename, $excluded_file ) === 0 ) {
                return 'file:' . $excluded_file;
            }
        }

        $upload_dir = wp_upload_dir();
        $base_dir   = trailingslashit( wp_normalize_path( $upload_dir['basedir'] ) );

        if ( strpos( $file_path, $base_dir ) !== 0 ) {
            return null;
        }

        $relative      = substr( $file_path, strlen( $base_dir ) );
        $relative_dir  = strtolower( dirname( $relative ) );
        $segments      = explode( '/', $relative_dir );

        foreach ( $excluded_folders as $folder ) {
            $folder_lower = strtolower( $folder );

            if ( strpos( '/' . $relative_dir . '/', '/' . $folder_lower . '/' ) !== false ) {
                return 'folder:' . $folder;
            }

            foreach ( $segments as $segment ) {
                if ( $segment === $folder_lower ) {
                    return 'folder:' . $folder;
                }
            }
        }

        return null;
    }

    private static function is_pdf_excluded( $file_path, $excluded_folders, $excluded_files ) {
        return self::get_exclusion_rule( $file_path, $excluded_folders, $excluded_files ) !== null;
    }

    private static function cleanup_stale_pdfs( $valid_pdf_ids ) {
        global $wpdb;
        $prefix = $wpdb->prefix;

        $existing_pdfs = $wpdb->get_results(
            "SELECT id, source_id FROM {$prefix}curam_chat_index WHERE source_type = 'pdf'"
        );

        $removed = 0;
        foreach ( $existing_pdfs as $row ) {
            if ( ! in_array( (int) $row->source_id, $valid_pdf_ids, true ) ) {
                self::delete_fts_row( $row->id );
                $wpdb->delete( "{$prefix}curam_chat_index", array( 'id' => $row->id ), array( '%d' ) );
                $removed++;
            }
        }

        return $removed;
    }

    public static function verify_pdf_in_index( $search_term = 'alternative dispute resolution' ) {
        global $wpdb;
        $prefix = $wpdb->prefix;

        $pdfs = $wpdb->get_results(
            "SELECT id, source_id, title, word_count, headings_text, status, content_hash,
                    LENGTH(content) as content_length
             FROM {$prefix}curam_chat_index
             WHERE source_type = 'pdf'"
        );

        Curam_Chat_Helpers::log( '=== PDF INDEX VERIFICATION ===', 'info', array(
            'total_pdfs_in_index' => count( $pdfs ),
            'search_term'         => $search_term,
        ) );

        foreach ( $pdfs as $pdf ) {
            $content = $wpdb->get_var( $wpdb->prepare(
                "SELECT content FROM {$prefix}curam_chat_index WHERE id = %d",
                $pdf->id
            ) );

            $has_term = stripos( $content, $search_term ) !== false;

            Curam_Chat_Helpers::log( 'PDF in index', 'info', array(
                'row_id'         => $pdf->id,
                'source_id'      => $pdf->source_id,
                'title'          => $pdf->title,
                'status'         => $pdf->status,
                'word_count'     => $pdf->word_count,
                'content_length' => $pdf->content_length,
                'has_headings'   => ! empty( $pdf->headings_text ) ? 'YES: ' . substr( $pdf->headings_text, 0, 200 ) : 'NO (empty)',
                'contains_term'  => $has_term ? 'YES - FOUND "' . $search_term . '"' : 'NO - term not in content',
                'content_preview' => substr( $content, 0, 200 ),
            ) );

            if ( Curam_Chat_Installer::is_sqlite() ) {
                $fts_check = $wpdb->get_var( $wpdb->prepare(
                    "SELECT COUNT(*) FROM {$prefix}curam_chat_index_fts WHERE rowid = %d",
                    $pdf->id
                ) );
                Curam_Chat_Helpers::log( 'FTS row check for PDF', 'info', array(
                    'row_id'       => $pdf->id,
                    'title'        => $pdf->title,
                    'fts_row_exists' => $fts_check > 0 ? 'YES' : 'NO - MISSING (search will not find this PDF)',
                ) );
            }
        }

        return $pdfs;
    }
}
