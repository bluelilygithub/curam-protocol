#!/usr/bin/env python3
"""
Helper script to create an admin user in the database
Run this after creating the users table with database_setup_users.sql

Usage:
    python create_admin_user.py
"""

import sys
import getpass
from database import create_admin_user

def main():
    print("=" * 60)
    print("Create Admin User")
    print("=" * 60)
    print()
    
    username = input("Username [admin]: ").strip() or "admin"
    email = input("Email (optional): ").strip() or None
    full_name = input("Full Name (optional): ").strip() or None
    
    password = getpass.getpass("Password: ")
    if not password:
        print("❌ Error: Password cannot be empty!")
        sys.exit(1)
    
    if len(password) < 8:
        print("⚠️  Warning: Password is less than 8 characters!")
        confirm = input("Continue anyway? (y/N): ").strip().lower()
        if confirm != 'y':
            print("Cancelled.")
            sys.exit(0)
    
    confirm_password = getpass.getpass("Confirm Password: ")
    if password != confirm_password:
        print("❌ Error: Passwords do not match!")
        sys.exit(1)
    
    print()
    print(f"Creating user '{username}'...")
    
    if create_admin_user(username, password, email, full_name):
        print(f"✅ Success! Admin user '{username}' created.")
        print()
        print("You can now login at /admin with:")
        print(f"  Username: {username}")
        print(f"  Password: {'*' * len(password)}")
    else:
        print(f"❌ Error: Failed to create user '{username}'")
        print("   This might mean the user already exists.")
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nCancelled.")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
