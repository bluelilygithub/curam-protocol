"""
Database Seeder Service
Automatically seeds configuration data (sectors, document types, prompts) 
to any environment on startup if tables are empty.
"""

import os
import json
from sqlalchemy import text


def load_fixture(filename):
    """Load a JSON fixture file from the data directory"""
    data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
    filepath = os.path.join(data_dir, filename)
    if os.path.exists(filepath):
        with open(filepath, 'r') as f:
            return json.load(f)
    return None


def seed_sectors(conn):
    """Seed sectors table if empty"""
    result = conn.execute(text("SELECT COUNT(*) FROM sectors"))
    count = result.scalar()
    
    if count == 0:
        sectors = load_fixture('sectors.json')
        if sectors:
            print("Seeding sectors...")
            for sector in sectors:
                conn.execute(text("""
                    INSERT INTO sectors (id, name, slug)
                    VALUES (:id, :name, :slug)
                    ON CONFLICT (id) DO NOTHING
                """), sector)
            conn.commit()
            print(f"  Seeded {len(sectors)} sectors")
            return True
    return False


def seed_document_types(conn):
    """Seed document_types table if empty"""
    result = conn.execute(text("SELECT COUNT(*) FROM document_types"))
    count = result.scalar()
    
    if count == 0:
        doc_types = load_fixture('document_types.json')
        if doc_types:
            print("Seeding document_types...")
            for dt in doc_types:
                conn.execute(text("""
                    INSERT INTO document_types (id, sector_id, name, slug)
                    VALUES (:id, :sector_id, :name, :slug)
                    ON CONFLICT (id) DO NOTHING
                """), dt)
            conn.commit()
            print(f"  Seeded {len(doc_types)} document types")
            return True
    return False


def seed_prompts(conn):
    """Seed prompt_templates from prompts.json if empty"""
    result = conn.execute(text("SELECT COUNT(*) FROM prompt_templates"))
    count = result.scalar()
    
    if count == 0:
        prompts = load_fixture('prompts.json')
        if prompts:
            print("Seeding prompt_templates...")
            for prompt in prompts:
                conn.execute(text("""
                    INSERT INTO prompt_templates (id, name, scope, doc_type, prompt_text, priority, is_active)
                    VALUES (:id, :name, :scope, :doc_type, :prompt_text, :priority, :is_active)
                    ON CONFLICT (id) DO NOTHING
                """), prompt)
            conn.commit()
            print(f"  Seeded {len(prompts)} prompts")
            return True
    return False


def run_seeder(engine):
    """Run all seeders if tables are empty"""
    if not engine:
        print("No database engine available for seeding")
        return
    
    try:
        with engine.connect() as conn:
            sectors_seeded = seed_sectors(conn)
            doc_types_seeded = seed_document_types(conn)
            prompts_seeded = seed_prompts(conn)
            
            if sectors_seeded or doc_types_seeded or prompts_seeded:
                print("Database seeding complete!")
    except Exception as e:
        print(f"Error during database seeding: {e}")
