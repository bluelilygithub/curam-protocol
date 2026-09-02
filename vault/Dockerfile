FROM node:20-slim

# System deps — LibreOffice, ffmpeg, Python3 for guitar audio pipeline
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    python3 \
    python3-pip \
    python3-venv \
    libsndfile1 \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

# Python audio pipeline (CPU-only torch to keep image lean)
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --include=dev

# Build frontend
COPY . .
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "server/index.js"]
