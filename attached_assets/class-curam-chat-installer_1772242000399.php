<?php
if ( ! defined( 'WPINC' ) ) {
    die;
}

class Curam_Chat_Installer {

    const DB_VERSION = '1.5';

    public static function activate() {
        self::create_tables();
        self::set_defaults();

        if ( ! wp_next_scheduled( 'curam_chat_daily_reindex' ) ) {
            wp_schedule_event( strtotime( 'tomorrow 04:00:00' ), 'daily', 'curam_chat_daily_reindex' );
        }

        update_option( 'curam_chat_db_version', self::DB_VERSION );
    }

    public static function maybe_upgrade() {
        $current = get_option( 'curam_chat_db_version', '0' );
        if ( version_compare( $current, self::DB_VERSION, '<' ) ) {
            self::create_tables();

            if ( version_compare( $current, '1.5', '<' ) ) {
                self::clear_pdf_index();
            }

            update_option( 'curam_chat_db_version', self::DB_VERSION );
        }
    }

    private static function clear_pdf_index() {
        global $wpdb;
        $prefix = $wpdb->prefix;

        $pdf_rows = $wpdb->get_results(
            "SELECT id FROM {$prefix}curam_chat_index WHERE source_type = 'pdf'"
        );

        if ( ! empty( $pdf_rows ) ) {
            foreach ( $pdf_rows as $row ) {
                if ( self::is_sqlite() ) {
                    $fts_row = $wpdb->get_row( $wpdb->prepare(
                        "SELECT title, headings_text, content FROM {$prefix}curam_chat_index WHERE id = %d",
                        $row->id
                    ) );
                    if ( $fts_row ) {
                        $wpdb->query( $wpdb->prepare(
                            "INSERT INTO {$prefix}curam_chat_index_fts ({$prefix}curam_chat_index_fts, rowid, title, headings_text, content) VALUES ('delete', %d, %s, %s, %s)",
                            $row->id,
                            $fts_row->title,
                            $fts_row->headings_text,
                            $fts_row->content
                        ) );
                    }
                }
                $wpdb->delete( "{$prefix}curam_chat_index", array( 'id' => $row->id ), array( '%d' ) );
            }

            Curam_Chat_Helpers::log( 'Cleared PDF index entries for re-extraction', 'info', array(
                'cleared' => count( $pdf_rows ),
            ) );
        }
    }

    public static function is_sqlite() {
        global $wpdb;
        if ( defined( 'DB_ENGINE' ) && strtolower( DB_ENGINE ) === 'sqlite' ) {
            return true;
        }
        $result = $wpdb->get_var( "SELECT 'test'" );
        if ( $result === 'test' && class_exists( 'WP_SQLite_DB' ) ) {
            return true;
        }
        if ( file_exists( ABSPATH . 'wp-content/db.php' ) ) {
            $db_content = file_get_contents( ABSPATH . 'wp-content/db.php' );
            if ( stripos( $db_content, 'sqlite' ) !== false ) {
                return true;
            }
        }
        return false;
    }

    private static function create_tables() {
        if ( self::is_sqlite() ) {
            self::create_tables_sqlite();
        } else {
            self::create_tables_mysql();
        }
    }

    private static function create_tables_mysql() {
        global $wpdb;

        $charset = $wpdb->get_charset_collate();
        $prefix  = $wpdb->prefix;

        $wpdb->query( "CREATE TABLE IF NOT EXISTS {$prefix}curam_chat_index (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            source_type VARCHAR(50) NOT NULL DEFAULT 'page',
            source_id BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
            title VARCHAR(500) NOT NULL DEFAULT '',
            url VARCHAR(2048) NOT NULL DEFAULT '',
            headings_text TEXT,
            content LONGTEXT,
            excerpt TEXT,
            word_count INT UNSIGNED DEFAULT 0,
            content_hash VARCHAR(32) DEFAULT '',
            status VARCHAR(20) DEFAULT 'indexed',
            published_at DATETIME DEFAULT NULL,
            indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY idx_chat_source (source_type, source_id),
            KEY idx_chat_status (status),
            KEY idx_chat_source_type (source_type),
            FULLTEXT KEY ft_chat_content (title, headings_text, content)
        ) {$charset}" );

        $wpdb->query( "CREATE TABLE IF NOT EXISTS {$prefix}curam_chat_synonyms (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            term VARCHAR(200) NOT NULL,
            synonyms TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY idx_synonym_term (term)
        ) {$charset}" );

        $wpdb->query( "CREATE TABLE IF NOT EXISTS {$prefix}curam_chat_search_logs (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            query VARCHAR(500) NOT NULL DEFAULT '',
            search_type VARCHAR(50) DEFAULT 'chat_assistant',
            source_page VARCHAR(500) DEFAULT '',
            ip_address VARCHAR(45) DEFAULT '',
            user_agent VARCHAR(500) DEFAULT '',
            results_count INT UNSIGNED DEFAULT 0,
            source_titles TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_chat_log_created (created_at)
        ) {$charset}" );

        $wpdb->query( "CREATE TABLE IF NOT EXISTS {$prefix}curam_chat_feedback (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            query VARCHAR(500) NOT NULL DEFAULT '',
            response_preview VARCHAR(500) DEFAULT '',
            rating VARCHAR(20) NOT NULL DEFAULT 'helpful',
            comment TEXT,
            ip_address VARCHAR(45) DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_feedback_rating (rating),
            KEY idx_feedback_created (created_at)
        ) {$charset}" );

        $wpdb->query( "CREATE TABLE IF NOT EXISTS {$prefix}curam_chat_leads (
            id BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(200) NOT NULL DEFAULT '',
            email VARCHAR(200) NOT NULL DEFAULT '',
            phone VARCHAR(50) DEFAULT '',
            message TEXT,
            nlp_summary TEXT,
            transcript LONGTEXT,
            source_url VARCHAR(2048) DEFAULT '',
            status VARCHAR(20) NOT NULL DEFAULT 'new',
            ip_address VARCHAR(45) DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_lead_status (status),
            KEY idx_lead_created (created_at),
            KEY idx_lead_email (email)
        ) {$charset}" );
    }

    private static function create_tables_sqlite() {
        global $wpdb;
        $prefix = $wpdb->prefix;

        $wpdb->query( "CREATE TABLE IF NOT EXISTS {$prefix}curam_chat_index (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_type TEXT NOT NULL DEFAULT 'page',
            source_id INTEGER NOT NULL DEFAULT 0,
            title TEXT NOT NULL DEFAULT '',
            url TEXT NOT NULL DEFAULT '',
            headings_text TEXT DEFAULT '',
            content TEXT DEFAULT '',
            excerpt TEXT DEFAULT '',
            word_count INTEGER DEFAULT 0,
            content_hash TEXT DEFAULT '',
            status TEXT DEFAULT 'indexed',
            published_at TEXT DEFAULT NULL,
            indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )" );

        $wpdb->query( "CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_source ON {$prefix}curam_chat_index (source_type, source_id)" );
        $wpdb->query( "CREATE INDEX IF NOT EXISTS idx_chat_status ON {$prefix}curam_chat_index (status)" );
        $wpdb->query( "CREATE INDEX IF NOT EXISTS idx_chat_source_type ON {$prefix}curam_chat_index (source_type)" );

        $wpdb->query( "CREATE VIRTUAL TABLE IF NOT EXISTS {$prefix}curam_chat_index_fts USING fts5(
            title,
            headings_text,
            content,
            content='',
            tokenize='porter unicode61'
        )" );

        $wpdb->query( "CREATE TABLE IF NOT EXISTS {$prefix}curam_chat_synonyms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            term TEXT NOT NULL UNIQUE,
            synonyms TEXT NOT NULL DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )" );

        $wpdb->query( "CREATE TABLE IF NOT EXISTS {$prefix}curam_chat_search_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query TEXT NOT NULL DEFAULT '',
            search_type TEXT DEFAULT 'chat_assistant',
            source_page TEXT DEFAULT '',
            ip_address TEXT DEFAULT '',
            user_agent TEXT DEFAULT '',
            results_count INTEGER DEFAULT 0,
            source_titles TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )" );

        $wpdb->query( "CREATE INDEX IF NOT EXISTS idx_chat_log_created ON {$prefix}curam_chat_search_logs (created_at)" );

        $wpdb->query( "CREATE TABLE IF NOT EXISTS {$prefix}curam_chat_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query TEXT NOT NULL DEFAULT '',
            response_preview TEXT DEFAULT '',
            rating TEXT NOT NULL DEFAULT 'helpful',
            comment TEXT DEFAULT '',
            ip_address TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )" );

        $wpdb->query( "CREATE INDEX IF NOT EXISTS idx_feedback_rating ON {$prefix}curam_chat_feedback (rating)" );
        $wpdb->query( "CREATE INDEX IF NOT EXISTS idx_feedback_created ON {$prefix}curam_chat_feedback (created_at)" );

        $wpdb->query( "CREATE TABLE IF NOT EXISTS {$prefix}curam_chat_leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '',
            phone TEXT DEFAULT '',
            message TEXT DEFAULT '',
            nlp_summary TEXT DEFAULT '',
            transcript TEXT DEFAULT '',
            source_url TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'new',
            ip_address TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )" );

        $wpdb->query( "CREATE INDEX IF NOT EXISTS idx_lead_status ON {$prefix}curam_chat_leads (status)" );
        $wpdb->query( "CREATE INDEX IF NOT EXISTS idx_lead_created ON {$prefix}curam_chat_leads (created_at)" );
        $wpdb->query( "CREATE INDEX IF NOT EXISTS idx_lead_email ON {$prefix}curam_chat_leads (email)" );
    }

    private static function set_defaults() {
        $existing = get_option( 'curam_chat_settings', false );
        if ( $existing !== false ) {
            return;
        }

        $defaults = array(
            'business_name'        => '',
            'business_description' => '',
            'gemini_api_key'       => '',
            'widget_title'         => 'AI Assistant',
            'widget_greeting'      => 'Hi! How can I help you today?',
            'widget_intro'         => 'Ask me anything about our services.',
            'widget_placeholder'   => 'Type your question...',
            'widget_enabled'       => '1',
            'voice_enabled'        => '1',
            'email_enabled'        => '1',
            'index_pages'          => '1',
            'index_posts'          => '1',
            'excluded_ids'         => '',
            'relevant_keywords'    => '',
            'irrelevant_keywords'  => "recipe\ncooking\nweather\nsports\ncelebrity\nmovie\ngame\nrestaurant\nhotel\ntravel\nvacation\nmusic\nfashion\nbitcoin\ncrypto\nstock\nforex\ndating\npets\ngardening\nmars\nvenus\nplanet\nspace\nrelationship\nlove\nmarriage\nnovel\nfiction\npoem\nsong\nalbum\ntv show\nnetflix",
            'guardrails'           => '',
            'primary_colour'       => '#0B1221',
            'accent_colour'        => '#D4AF37',
            'button_position'      => 'right',
            'button_vertical'      => 'middle',
            'panel_width'          => '450',
            'debug_logging'        => '0',
            'starter_questions'    => "What services do you offer?\nHow much does it cost?\nHow do I get started?",
            'feedback_enabled'     => '1',
            'index_pdfs'           => '0',
            'excluded_pdf_folders' => '',
            'excluded_pdf_files'   => '',
            'lead_capture_enabled' => '1',
            'sales_rep_email'      => '',
            'sales_rep_phone'      => '',
            'lead_threshold'       => '3',
        );

        update_option( 'curam_chat_settings', $defaults );
    }
}
