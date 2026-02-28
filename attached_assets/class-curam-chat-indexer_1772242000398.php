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

    private static function insert_fts_row( $rowid, $title, $headings_text, $content ) {
        if ( ! Curam_Chat_Installer::is_sqlite() ) {
            return;
        }
        global $wpdb;
        $prefix = $wpdb->prefix;

        $wpdb->query( $wpdb->prepare(
            "INSERT INTO {$prefix}curam_chat_index_fts (rowid, title, headings_text, content) VALUES (%d, %s, %s, %s)",
            $rowid,
            $title,
            $headings_text,
            $content
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
        if ( ! self::is_pdf_indexing_enabled() ) {
            $removed = self::cleanup_stale_pdfs( array() );
            return array( 'indexed' => 0, 'skipped' => 0, 'excluded' => 0, 'removed' => $removed, 'failed' => 0 );
        }

        global $wpdb;
        $prefix = $wpdb->prefix;

        Curam_Chat_Helpers::log( 'Starting PDF indexing', 'info' );

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

        Curam_Chat_Helpers::log( 'Found PDF attachments', 'info', array(
            'count' => count( $pdf_attachments ),
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

        Curam_Chat_Helpers::log( 'PDF indexing complete', 'info', array(
            'indexed'  => $indexed,
            'skipped'  => $skipped,
            'excluded' => $excluded_count,
            'removed'  => $removed,
            'failed'   => $failed,
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

    private static function index_single_pdf( $attachment_id ) {
        global $wpdb;
        $prefix = $wpdb->prefix;

        $file_path = get_attached_file( $attachment_id );
        if ( ! $file_path || ! file_exists( $file_path ) ) {
            Curam_Chat_Helpers::log( 'PDF file not found', 'warning', array(
                'attachment_id' => $attachment_id,
                'path'          => $file_path,
            ) );
            return 'failed';
        }

        $title = get_the_title( $attachment_id );
        if ( empty( $title ) ) {
            $title = basename( $file_path, '.pdf' );
        }

        $url = wp_get_attachment_url( $attachment_id );

        $text = self::extract_pdf_text( $file_path );
        if ( empty( $text ) ) {
            Curam_Chat_Helpers::log( 'PDF text extraction returned empty', 'warning', array(
                'attachment_id' => $attachment_id,
                'title'         => $title,
            ) );
            return 'failed';
        }

        if ( strlen( $text ) > self::MAX_CONTENT_LENGTH ) {
            $text = substr( $text, 0, self::MAX_CONTENT_LENGTH );
        }

        $word_count   = str_word_count( $text );
        $content_hash = md5( $title . $text );
        $excerpt      = wp_trim_words( $text, 55, '...' );

        $existing = $wpdb->get_row( $wpdb->prepare(
            "SELECT id, content_hash, word_count FROM {$prefix}curam_chat_index WHERE source_type = 'pdf' AND source_id = %d",
            $attachment_id
        ) );

        $min_word_count  = 50;
        $has_bad_content = $existing && (int) $existing->word_count < $min_word_count;

        if ( $existing && $existing->content_hash === $content_hash && ! $has_bad_content ) {
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
            $wpdb->update(
                "{$prefix}curam_chat_index",
                array(
                    'title'         => $title,
                    'url'           => $url,
                    'headings_text' => '',
                    'content'       => $text,
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
            self::update_fts_row( $existing->id, $title, '', $text );

            Curam_Chat_Helpers::log( 'Updated PDF index entry', 'info', array(
                'attachment_id' => $attachment_id,
                'title'         => $title,
                'word_count'    => $word_count,
            ) );
        } else {
            $wpdb->insert(
                "{$prefix}curam_chat_index",
                array(
                    'source_type'   => 'pdf',
                    'source_id'     => $attachment_id,
                    'title'         => $title,
                    'url'           => $url,
                    'headings_text' => '',
                    'content'       => $text,
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
            self::insert_fts_row( $row_id, $title, '', $text );

            Curam_Chat_Helpers::log( 'Inserted PDF index entry', 'info', array(
                'attachment_id' => $attachment_id,
                'title'         => $title,
                'word_count'    => $word_count,
                'row_id'        => $row_id,
            ) );
        }

        return true;
    }

    public static function extract_pdf_text( $file_path ) {
        $text = self::extract_pdf_via_pdftotext( $file_path );
        if ( empty( $text ) ) {
            $text = self::extract_via_smalot( $file_path );
        }
        if ( empty( $text ) ) {
            $text = self::extract_pdf_via_php( $file_path );
        }

        if ( empty( $text ) ) {
            Curam_Chat_Helpers::log( 'PDF extraction failed (all methods)', 'warning', array(
                'file' => basename( $file_path ),
            ) );
            return '';
        }

        $text = self::clean_pdf_text( $text );

        Curam_Chat_Helpers::log( 'PDF text extracted', 'debug', array(
            'file'   => basename( $file_path ),
            'length' => strlen( $text ),
            'words'  => str_word_count( $text ),
            'sample' => substr( $text, 0, 200 ),
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
        $autoloader = __DIR__ . '/smalot/alt_autoload.php';

        if ( ! file_exists( $autoloader ) ) {
            Curam_Chat_Helpers::log( 'Smalot autoloader not found', 'debug', array(
                'path' => $autoloader,
            ) );
            return '';
        }

        require_once $autoloader;

        try {
            $parser = new \Smalot\PdfParser\Parser();
            $pdf    = $parser->parseFile( $file_path );
            $text   = $pdf->getText();

            if ( ! empty( $text ) ) {
                Curam_Chat_Helpers::log( 'PDF extracted via smalot', 'debug', array(
                    'file'   => basename( $file_path ),
                    'length' => strlen( $text ),
                ) );
            }

            return $text ?: '';
        } catch ( \Exception $e ) {
            Curam_Chat_Helpers::log( 'Smalot extraction error', 'warning', array(
                'file'    => basename( $file_path ),
                'message' => $e->getMessage(),
            ) );
            return '';
        }
    }

    private static function extract_pdf_via_pdftotext( $file_path ) {
        if ( ! function_exists( 'exec' ) ) {
            return '';
        }

        $check = array();
        if ( PHP_OS_FAMILY === 'Windows' ) {
            @exec( 'where pdftotext 2>NUL', $check );
        } else {
            @exec( 'which pdftotext 2>/dev/null', $check );
        }
        if ( empty( $check ) ) {
            return '';
        }

        $file_size = @filesize( $file_path );
        if ( $file_size > 50 * 1024 * 1024 ) {
            Curam_Chat_Helpers::log( 'PDF too large for extraction', 'warning', array(
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
            return '';
        }

        $text = implode( "\n", $output );
        $text = preg_replace( '/\s+/', ' ', $text );
        $text = trim( $text );

        Curam_Chat_Helpers::log( 'PDF extracted via pdftotext', 'debug', array(
            'file'   => basename( $file_path ),
            'length' => strlen( $text ),
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
            Curam_Chat_Helpers::log( 'PHP PDF extraction insufficient text', 'debug', array(
                'file'   => basename( $file_path ),
                'length' => strlen( $text ),
            ) );
            return '';
        }

        Curam_Chat_Helpers::log( 'PDF extracted via PHP fallback', 'debug', array(
            'file'   => basename( $file_path ),
            'length' => strlen( $text ),
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

            // Full relative path prefix match: e.g. "2024/03" matches "2024/03/doc.pdf"
            if ( strpos( '/' . $relative_dir . '/', '/' . $folder_lower . '/' ) !== false ) {
                return 'folder:' . $folder;
            }

            // Single segment match: e.g. "private" matches any subfolder named "private"
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
}
