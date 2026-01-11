"""
Gunicorn Production Configuration

Optimized for document processing workloads:
- Multiple workers for concurrent request handling
- Connection keep-alive for better throughput
- Timeout settings tuned for AI API calls
"""

import multiprocessing
import os

workers = int(os.environ.get('GUNICORN_WORKERS', min(4, multiprocessing.cpu_count() * 2 + 1)))

worker_class = 'sync'

bind = '0.0.0.0:5000'

timeout = 300

keepalive = 5

max_requests = 1000
max_requests_jitter = 50

accesslog = '-'
errorlog = '-'
loglevel = 'info'

capture_output = True
enable_stdio_inheritance = True

preload_app = True

graceful_timeout = 30

proc_name = 'curam-ai'
