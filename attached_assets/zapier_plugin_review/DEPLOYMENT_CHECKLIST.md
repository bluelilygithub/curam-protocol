# Deployment Checklist for Curam Xero Refactored Plugin

## Pre-Deployment

- [ ] **Backup current plugin files**
  ```bash
  cd wp-content/plugins/
  tar -czf curam-xero-backup-$(date +%Y%m%d).tar.gz curam-ai-xero/
  ```

- [ ] **Backup database**
  ```bash
  wp db export curam-xero-backup-$(date +%Y%m%d).sql
  ```

- [ ] **Note current plugin version**
  - Current: `_____________`
  - New: `2.1.0`

- [ ] **Verify wp-config.php has required constants:**
  ```php
  define('XERO_CLIENT_ID', 'your-client-id');
  define('XERO_CLIENT_SECRET', 'your-client-secret');
  define('ZAPIER_WEBHOOK_URL', 'https://hooks.zapier.com/...');
  define('ZAPIER_SECRET_KEY', 'your-secret-key');
  ```

## Deployment Steps

- [ ] **1. Enable WordPress debug mode (optional but recommended)**
  ```php
  define('WP_DEBUG', true);
  define('WP_DEBUG_LOG', true);
  ```

- [ ] **2. Deactivate current plugin**
  - Go to Plugins → Installed Plugins
  - Deactivate "Curam-Ai Xero Integration"

- [ ] **3. Replace plugin files**
  - Option A: Via FTP/SFTP
    - Delete old `curam-ai-xero/` directory
    - Upload new `curam-xero-refactored/` directory
    - Rename to `curam-ai-xero/`
  
  - Option B: Via SSH
    ```bash
    cd wp-content/plugins/
    rm -rf curam-ai-xero/
    mv curam-xero-refactored/ curam-ai-xero/
    ```

- [ ] **4. Verify file structure**
  ```bash
  ls -la curam-ai-xero/
  # Should see:
  # - curam-ai_zapier.php (main file, ~70 lines)
  # - includes/ (directory with class files)
  # - admin/ (directory with views)
  # - REFACTORING_COMPLETE.md
  ```

- [ ] **5. Activate plugin**
  - Go to Plugins → Installed Plugins
  - Activate "Curam-Ai Xero Integration"

## Post-Deployment Testing

### Critical Tests

- [ ] **Test 1: Plugin activates without errors**
  - Check: No PHP errors in debug.log
  - Check: Xero menu appears in WordPress admin

- [ ] **Test 2: Dashboard loads**
  - Navigate to: Dashboard → Xero
  - Verify: Statistics display correctly
  - Check for: PHP errors, missing data

- [ ] **Test 3: Xero connection status**
  - Navigate to: Xero → Authorization
  - Expected: Should show "Connected" if already authorized
  - If disconnected: Re-authorize using OAuth flow

- [ ] **Test 4: Settings page**
  - Navigate to: Xero → Settings
  - Verify: All settings load correctly
  - Check: Webhook URL displays
  - Test: "Test Xero Connection" button works

- [ ] **Test 5: Status Checker**
  - Navigate to: Xero → Status Checker
  - Click: "Check Payments Now"
  - Expected: Should complete without errors
  - Check: debug.log for payment check results

- [ ] **Test 6: Create test invoice**
  - Create new Client Enquiry post
  - Fill required fields:
    - Email (valid)
    - Final Value (> 0)
    - Products (select at least one)
  - Set status: "Invoiced & Assigned"
  - Save/Update post
  - Expected: Webhook sent to Zapier (check debug.log)

### Connection Tests

- [ ] **Xero OAuth**
  - Status: Connected / Disconnected
  - Action taken: ___________________
  - Result: ________________________

- [ ] **Zapier Webhook**
  - Test button result: Pass / Fail
  - Action taken: ___________________
  - Result: ________________________

- [ ] **Cron Job**
  ```bash
  wp cron event list | grep xero
  ```
  - Scheduled: Yes / No
  - Next run: ____________________

### Functionality Tests

- [ ] **Phone number cleaning**
  ```php
  // Test in functions.php temporarily:
  $test = clean_phone_number('0412 345 678');
  var_dump($test); // Should be: +61412345678
  ```

- [ ] **REST API endpoints**
  ```bash
  # Test authentication
  curl -X POST https://yoursite.com/wp-json/diamondplate/v1/invoice-created \
    -H "X-Zapier-Secret: your-secret-key" \
    -H "Content-Type: application/json" \
    -d '{"test": true}'
  ```

## Rollback Plan (If Needed)

If something goes wrong:

- [ ] **1. Deactivate new plugin**
- [ ] **2. Restore from backup**
  ```bash
  cd wp-content/plugins/
  rm -rf curam-ai-xero/
  tar -xzf curam-xero-backup-YYYYMMDD.tar.gz
  ```
- [ ] **3. Reactivate old version**
- [ ] **4. Document issue for review**

## Sign-Off

### Deployed By
- Name: ___________________________
- Date: ___________________________
- Time: ___________________________

### Testing Completed By
- Name: ___________________________
- Date: ___________________________
- All tests passed: Yes / No

### Issues Encountered
```
[Write any issues here]




```

### Resolution Notes
```
[Write resolution steps here]




```

## Support Contacts

- WordPress Admin: _____________________
- Developer: ___________________________
- Xero Account Admin: __________________

---

**Important:** Keep this checklist with your deployment documentation for future reference.
