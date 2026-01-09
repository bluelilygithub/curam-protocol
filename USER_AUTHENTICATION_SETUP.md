# User Authentication Setup Guide

**Date:** January 2025  
**Status:** ✅ Ready to Use

---

## Overview

The admin panel now uses **database-backed authentication** with password hashing instead of environment variables. Passwords are securely hashed using Werkzeug's PBKDF2 implementation (part of Flask).

---

## Setup Instructions

### Step 1: Create the Users Table

Run the SQL script to create the `users` table:

**Via Railway Dashboard:**
1. Go to your Railway project
2. Click on your PostgreSQL service
3. Click "Query" tab
4. Copy and paste the contents of `database_setup_users.sql`
5. Click "Run"

**Via Railway CLI:**
```bash
railway run psql < database_setup_users.sql
```

**Via Local Connection:**
```bash
psql $DATABASE_URL -f database_setup_users.sql
```

### Step 2: Create Your First Admin User

**Option A: Using the Helper Script (Recommended)**
```bash
python create_admin_user.py
```

This will prompt you for:
- Username (defaults to "admin")
- Email (optional)
- Full Name (optional)
- Password (min 8 characters)
- Password confirmation

**Option B: Using Python Directly**
```python
python -c "from database import create_admin_user; create_admin_user('admin', 'your_secure_password', 'your@email.com', 'Admin User')"
```

**Option C: Manual SQL Insert (Advanced)**
1. Generate password hash:
   ```python
   python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('your_password'))"
   ```
2. Insert into database:
   ```sql
   INSERT INTO users (username, password_hash, full_name, is_active, is_admin)
   VALUES ('admin', '<generated_hash>', 'Admin User', true, true);
   ```

### Step 3: Login

1. Go to `/admin`
2. Login with your username and password
3. You should now be authenticated via the database

---

## Features

### ✅ Password Hashing
- Uses Werkzeug's `pbkdf2:sha256` with 600,000 iterations
- Secure password storage (never stored in plain text)

### ✅ Fallback Authentication
- If users table doesn't exist or is empty, system falls back to environment variables (`ADMIN_USERNAME`, `ADMIN_PASSWORD`)
- This allows gradual migration

### ✅ Password Change Form
- Accessible from admin dashboard sidebar
- Located at `/admin/change-password`
- Validates current password before allowing change
- Requires minimum 8 characters
- Updates `updated_at` timestamp

### ✅ User Management Functions
All functions are in `database.py`:
- `get_user_by_username(username)` - Get user by username
- `verify_user_password(username, password)` - Verify login credentials
- `update_user_password(username, new_password)` - Change password
- `update_user_last_login(username)` - Track last login time
- `create_admin_user(username, password, email, full_name)` - Create new admin user

---

## How to Change Your Password

### Via Admin Panel (Recommended)

1. **Login** to `/admin`
2. **Click "Change Password"** in the sidebar (under Documentation)
3. **Fill in the form:**
   - Current Password
   - New Password (min 8 characters)
   - Confirm New Password
4. **Click "Update Password"**
5. **Success!** Your password is now updated

### Via Database (Advanced)

If you need to reset a forgotten password:

1. Generate new hash:
   ```python
   python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('new_password'))"
   ```
2. Update in database:
   ```sql
   UPDATE users 
   SET password_hash = '<new_hash>', updated_at = CURRENT_TIMESTAMP 
   WHERE username = 'admin';
   ```

---

## Database Schema

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    full_name VARCHAR(200),
    is_active BOOLEAN DEFAULT true,
    is_admin BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);
```

---

## Migration from Environment Variables

If you're currently using environment variables (`ADMIN_USERNAME`, `ADMIN_PASSWORD`):

1. ✅ **Keep environment variables** - They serve as fallback
2. ✅ **Create users table** - Run `database_setup_users.sql`
3. ✅ **Create admin user** - Use `create_admin_user.py` or Python script
4. ✅ **Test login** - Login via database authentication
5. ✅ **Change password** - Use the admin panel password change form
6. ⚠️  **Optional:** Remove environment variables after confirming database auth works

---

## Security Notes

### ✅ Current Implementation
- Password hashing with PBKDF2-SHA256 (600k iterations)
- Passwords never stored in plain text
- Session-based authentication
- Password change requires current password verification

### 🔒 Recommended for Production
- Use strong passwords (20+ characters recommended)
- Consider adding rate limiting on login attempts
- Consider adding 2FA for additional security
- Monitor `last_login` for suspicious activity
- Regularly rotate passwords

---

## Troubleshooting

### "Invalid credentials" when login
- **Check:** User exists in database: `SELECT * FROM users WHERE username = 'admin';`
- **Check:** Password is correct (use helper script to create user again)
- **Check:** User is active: `SELECT * FROM users WHERE username = 'admin' AND is_active = true;`

### "Failed to update password"
- **Check:** Current password is correct
- **Check:** Database connection is working
- **Check:** User exists and is active in database

### "Table users does not exist"
- **Solution:** Run `database_setup_users.sql` to create the table

### Fallback to environment variables not working
- **Check:** `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables are set
- **Check:** Railway variables are configured correctly

---

## Files Modified/Created

### Created Files
- `database_setup_users.sql` - SQL script to create users table
- `create_admin_user.py` - Helper script to create admin user
- `templates/admin/change_password.html` - Password change form
- `USER_AUTHENTICATION_SETUP.md` - This documentation

### Modified Files
- `database.py` - Added user management functions
- `routes/admin_routes.py` - Updated to use database authentication, added password change route
- `templates/admin/base.html` - Added "Change Password" link to sidebar
- `templates/admin/dashboard.html` - Already displays logged-in username

---

## Next Steps (Optional)

Future enhancements you might consider:
- Multiple user support (different roles/permissions)
- Password reset via email
- Two-factor authentication (2FA)
- User activity logging
- Password strength requirements
- Account lockout after failed attempts
