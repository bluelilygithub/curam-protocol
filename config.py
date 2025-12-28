"""
Application configuration for Curam-Ai automater.
Environment-based configuration using Flask config pattern.
"""
import os


class Config:
    """Base configuration"""
    
    # Flask settings
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
    
    # Gemini AI settings
    GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
    
    # File upload settings
    FINANCE_UPLOAD_DIR = os.path.join('uploads', 'finance')
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max file size
    ALLOWED_EXTENSIONS = {'pdf', 'jpg', 'jpeg', 'png'}
    
    # Prompt limits
    ENGINEERING_PROMPT_LIMIT = 6000
    ENGINEERING_PROMPT_LIMIT_SHORT = 3200
    TRANSMITTAL_PROMPT_LIMIT = 3200
    
    # Default department
    DEFAULT_DEPARTMENT = "finance"
    
    # Static file settings
    STATIC_FOLDER = 'assets'
    STATIC_URL_PATH = '/assets'


class DevelopmentConfig(Config):
    """Development configuration"""
    DEBUG = True
    TESTING = False


class ProductionConfig(Config):
    """Production configuration"""
    DEBUG = False
    TESTING = False
    
    # In production, require SECRET_KEY from environment
    @property
    def SECRET_KEY(self):
        secret_key = os.environ.get('SECRET_KEY')
        if not secret_key:
            raise ValueError("SECRET_KEY environment variable must be set in production")
        return secret_key


class TestingConfig(Config):
    """Testing configuration"""
    DEBUG = True
    TESTING = True
    
    # Use test database/files
    FINANCE_UPLOAD_DIR = os.path.join('tests', 'uploads', 'finance')


# Configuration dictionary
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}


def get_config(env=None):
    """
    Get configuration object based on environment.
    
    Args:
        env: Environment name ('development', 'production', 'testing')
             If None, uses FLASK_ENV environment variable or 'default'
    
    Returns:
        Configuration class
    """
    if env is None:
        env = os.environ.get('FLASK_ENV', 'default')
    
    return config.get(env, config['default'])

