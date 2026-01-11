#!/usr/bin/env python3
"""
Admin Password Reset Script
Run this from the Replit Shell to reset the admin password.

Usage:
    python reset_admin_password.py
"""

import os
import sys
from getpass import getpass

def main():
    print("\n" + "="*50)
    print("  Curam-Ai Admin Password Reset")
    print("="*50 + "\n")
    
    try:
        from werkzeug.security import generate_password_hash
        from database import engine
        from sqlalchemy import text
    except ImportError as e:
        print(f"Error importing required modules: {e}")
        print("Make sure you're running this from the project directory.")
        sys.exit(1)
    
    if not engine:
        print("Error: Database connection not available.")
        print("Make sure DATABASE_URL is configured correctly.")
        sys.exit(1)
    
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT id, username, email FROM users LIMIT 10"))
            users = [dict(row._mapping) for row in result]
    except Exception as e:
        print(f"Error fetching users: {e}")
        sys.exit(1)
    
    if not users:
        print("No admin users found in the database.")
        print("\nWould you like to create a new admin user? (y/n): ", end="")
        if input().strip().lower() == 'y':
            create_new_admin()
        return
    
    print("Existing admin users:")
    for i, user in enumerate(users, 1):
        print(f"  {i}. {user['username']} ({user.get('email', 'no email')})")
    
    print("\nEnter the number of the user to reset (or 0 to create new): ", end="")
    try:
        choice = int(input().strip())
    except ValueError:
        print("Invalid input. Exiting.")
        sys.exit(1)
    
    if choice == 0:
        create_new_admin()
        return
    
    if choice < 1 or choice > len(users):
        print("Invalid selection. Exiting.")
        sys.exit(1)
    
    selected_user = users[choice - 1]
    user_id = selected_user['id']
    username = selected_user['username']
    
    print(f"\nResetting password for: {username}")
    
    new_password = getpass("Enter new password: ")
    confirm_password = getpass("Confirm new password: ")
    
    if new_password != confirm_password:
        print("Passwords do not match. Exiting.")
        sys.exit(1)
    
    if len(new_password) < 8:
        print("Password must be at least 8 characters. Exiting.")
        sys.exit(1)
    
    password_hash = generate_password_hash(new_password)
    
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                UPDATE users 
                SET password_hash = :password_hash, updated_at = NOW()
                WHERE id = :user_id
            """), {"password_hash": password_hash, "user_id": user_id})
            conn.commit()
        
        print(f"\nPassword reset successfully for user: {username}")
        print("You can now log in at /admin/login")
        
    except Exception as e:
        print(f"Error updating password: {e}")
        sys.exit(1)


def create_new_admin():
    """Create a new admin user"""
    from werkzeug.security import generate_password_hash
    from database import engine
    from sqlalchemy import text
    
    print("\n--- Create New Admin User ---")
    
    username = input("Enter username: ").strip()
    if not username:
        print("Username cannot be empty. Exiting.")
        sys.exit(1)
    
    email = input("Enter email (optional): ").strip() or None
    
    new_password = getpass("Enter password: ")
    confirm_password = getpass("Confirm password: ")
    
    if new_password != confirm_password:
        print("Passwords do not match. Exiting.")
        sys.exit(1)
    
    if len(new_password) < 8:
        print("Password must be at least 8 characters. Exiting.")
        sys.exit(1)
    
    password_hash = generate_password_hash(new_password)
    
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO users (username, email, password_hash, is_active)
                VALUES (:username, :email, :password_hash, true)
            """), {
                "username": username,
                "email": email,
                "password_hash": password_hash
            })
            conn.commit()
        
        print(f"\nAdmin user '{username}' created successfully!")
        print("You can now log in at /admin/login")
        
    except Exception as e:
        print(f"Error creating user: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
