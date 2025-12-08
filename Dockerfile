# Use Python 3.11 as specified in runtime.txt
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies if needed
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Expose port (Railway will set PORT env var)
EXPOSE 5000

# Run with gunicorn (matching Procfile)
CMD ["gunicorn", "-w", "4", "-t", "120", "--bind", "0.0.0.0:${PORT:-5000}", "main:app"]

