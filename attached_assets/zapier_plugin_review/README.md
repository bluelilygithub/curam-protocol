# Curam Xero Integration Plugin - Refactored

> **Professional WordPress plugin for Xero invoicing automation**
> 
> Reduced from 3,163 lines to a clean, maintainable structure

[![WordPress](https://img.shields.io/badge/WordPress-5.0+-blue.svg)](https://wordpress.org/)
[![PHP](https://img.shields.io/badge/PHP-7.4+-purple.svg)](https://php.net/)
[![License](https://img.shields.io/badge/License-GPL%20v2-green.svg)](https://www.gnu.org/licenses/gpl-2.0.html)

## 📖 Overview

This plugin integrates WordPress with Xero accounting software, automatically creating invoices via Zapier webhooks when client enquiries are marked as "Invoiced & Assigned". It includes automated payment checking, overdue detection, and comprehensive admin dashboards.

## ✨ Key Features

- **Automatic Invoice Creation** - Triggers Xero invoice creation via Zapier
- **OAuth 2.0 Integration** - Secure Xero API authentication
- **Payment Status Checking** - Automated cron job checks payment status
- **Overdue Detection** - Automatically flags invoices past due date
- **Admin Dashboard** - Beautiful metrics and activity tracking
- **REST API** - Webhooks for Zapier integration
- **Phone Number Cleaning** - Australian format standardization
- **Comprehensive Logging** - Detailed audit trail in email_details field

## 📋 Requirements

- WordPress 5.0 or higher
- PHP 7.4 or higher
- Advanced Custom Fields (ACF) Pro
- Xero account with API access
- Zapier account (for webhook automation)

## 🚀 Quick Start

### 1. Installation

```bash
cd wp-content/plugins/
# Upload or clone this repository
# Rename to: curam-ai-xero/
```

### 2. Configuration

Add to `wp-config.php` (before "That's all, stop editing!"):

```php
// Xero OAuth Credentials
define('XERO_CLIENT_ID', 'your-xero-client-id-here');
define('XERO_CLIENT_SECRET', 'your-xero-client-secret-here');

// Zapier Webhook
define('ZAPIER_WEBHOOK_URL', 'https://hooks.zapier.com/hooks/catch/YOUR_ID/');
define('ZAPIER_SECRET_KEY', 'your-random-32-character-secret-key');
```

### 3. Activation

1. Go to **Plugins → Installed Plugins**
2. Activate "Curam-Ai Xero Integration"
3. Navigate to **Dashboard → Xero**
4. Click **Authorization** and connect to Xero

### 4. Verify Setup

- Visit **Xero → Dashboard** to see metrics
- Check **Xero → Settings** for configuration
- Test with **Xero → Status Checker**

## 📁 File Structure

```
curam-ai-xero/
├── curam-ai_zapier.php              # Main plugin file (70 lines)
│
├── includes/                         # Core functionality
│   ├── class-curam-xero.php         # Main orchestrator
│   ├── class-curam-helpers.php      # Utility functions
│   ├── class-curam-xero-api.php     # Xero API wrapper
│   ├── class-curam-xero-oauth.php   # OAuth flow
│   ├── class-curam-webhook-handler.php  # Zapier webhooks
│   ├── class-curam-rest-api.php     # REST endpoints
│   ├── class-curam-payment-checker.php  # Cron payment checking
│   ├── class-curam-admin-menu.php   # Admin menu
│   ├── class-curam-admin-notices.php    # Status banners
│   └── class-curam-dashboard-functions.php  # Statistics
│
├── admin/views/                      # Admin templates
│   ├── dashboard.php                # Main dashboard
│   ├── authorization.php            # OAuth setup
│   ├── settings.php                 # Configuration
│   ├── status-checker.php           # Payment checker
│   └── sql-testing.php              # Diagnostics
│
└── Documentation/
    ├── REFACTORING_COMPLETE.md      # Refactoring details
    ├── BEFORE_AFTER_COMPARISON.md   # Code comparison
    └── DEPLOYMENT_CHECKLIST.md      # Deployment guide
```

## 🔧 Configuration

### Xero Setup

1. Create app at [Xero Developer Portal](https://developer.xero.com/)
2. Set redirect URI: `https://yoursite.com/wp-admin/admin.php?page=xero-authorization&action=callback`
3. Copy Client ID and Client Secret to `wp-config.php`

### Zapier Setup

1. Create new Zap with "Webhooks by Zapier" trigger
2. Choose "Catch Hook"
3. Copy webhook URL to `wp-config.php`
4. Connect to Xero action: "Create Invoice"
5. Map fields from webhook payload

### Cron Job (Payment Checking)

Automatically scheduled on activation. Configure interval in **Xero → Settings**:

- Default: Every 60 minutes
- Options: 15min, 30min, 1hr, 4hr, 8hr, 24hr

## 🎯 Usage

### Creating an Invoice

1. Create/edit a **Client Enquiry** post
2. Fill required fields:
   - Email (valid email address)
   - Final Value (amount > 0)
   - Products (select at least one)
3. Set **Enquiry Status** to "Invoiced & Assigned"
4. Click **Update**
5. Invoice created automatically via Zapier

### Monitoring Invoices

- **Dashboard** - View statistics and recent activity
- **Status Checker** - Manually trigger payment check
- **Diagnostics** - Run SQL queries for troubleshooting

### Payment Status Updates

Automated cron job checks Xero for:
- **Paid invoices** → Status updated to "Paid"
- **Overdue invoices** → Status updated to "Overdue" with warning
- Email notifications sent (if configured)

## 🔌 API Endpoints

### Invoice Created Callback

```http
POST /wp-json/diamondplate/v1/invoice-created
X-Zapier-Secret: your-secret-key

{
  "post_id": 123,
  "invoice_id": "xero-guid",
  "invoice_number": "INV-001"
}
```

### Payment Received Webhook

```http
POST /wp-json/diamondplate/v1/payment-received
X-Zapier-Secret: your-secret-key

{
  "invoice_id": "xero-guid"
}
```

## 🧪 Testing

### Test Xero Connection

```bash
# Via WP-CLI
wp cron event run xero_check_payment_status

# Via admin interface
Dashboard → Xero → Status Checker → "Check Payments Now"
```

### Test Zapier Webhook

```bash
curl -X POST https://yoursite.com/wp-json/diamondplate/v1/invoice-created \
  -H "X-Zapier-Secret: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"test": true, "post_id": 123}'
```

## 📊 Admin Pages

### Dashboard
- Total invoices created
- Success rate statistics
- Overdue invoices alert
- Recent activity log
- Status breakdown

### Authorization
- OAuth connection status
- Connect/disconnect buttons
- Setup instructions

### Settings
- Webhook configuration
- Payment check interval
- Overdue threshold
- Email notifications
- User selection for alerts

### Status Checker
- Manual payment check trigger
- Last check results
- Configuration validation

### Diagnostics
- SQL query testing
- WordPress database queries
- Xero API testing
- Connection verification

## 🛠️ Development

### Adding a New Feature

```php
// Example: Add new API method
// In includes/class-curam-xero-api.php

public static function get_contacts( $access_token ) {
    $tenant_id = get_option( 'xero_tenant_id' );
    
    $response = wp_remote_get(
        'https://api.xero.com/api.xro/2.0/Contacts',
        array(
            'headers' => array(
                'Authorization' => 'Bearer ' . $access_token,
                'xero-tenant-id' => $tenant_id,
            ),
        )
    );
    
    return json_decode( wp_remote_retrieve_body( $response ), true );
}

// Optional: Backward compatible wrapper
function xero_get_contacts( $access_token ) {
    return Curam_Xero_Api::get_contacts( $access_token );
}
```

### Running Tests

```php
// Unit tests (example)
class Test_Curam_Helpers extends WP_UnitTestCase {
    public function test_phone_cleaning() {
        $result = Curam_Helpers::clean_phone_number('0412 345 678');
        $this->assertEquals('+61412345678', $result);
    }
}
```

## 📝 Changelog

### Version 2.1.0 (Current)
- Complete refactoring: Reduced main file from 3,163 to 70 lines
- Organized into proper class structure
- Improved maintainability and testability
- Full backward compatibility maintained

### Version 2.0.0
- Extracted core classes from main plugin file
- Added proper autoloading structure
- Separated admin views from logic

### Version 1.5
- Added automatic overdue invoice detection
- Introduced payment status checking cron
- Enhanced admin notifications

### Version 1.4
- Changed trigger status to "assigned"
- Improved error handling
- Added validation banners

## 🤝 Contributing

This is a private plugin for Curam AI. Internal contributions welcome:

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes following WordPress Coding Standards
3. Test thoroughly
4. Submit pull request with description

## 📞 Support

- **Documentation**: See markdown files in root directory
- **Issues**: Check error log at `wp-content/debug.log`
- **Questions**: Contact plugin maintainer

## 📄 License

GPL v2 or later

---

## 🎓 Further Reading

- [REFACTORING_COMPLETE.md](REFACTORING_COMPLETE.md) - Detailed refactoring documentation
- [BEFORE_AFTER_COMPARISON.md](BEFORE_AFTER_COMPARISON.md) - Side-by-side comparison
- [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) - Step-by-step deployment guide

---

**Built with ❤️ for Curam AI** | [Website](https://curam-ai.com.au)
