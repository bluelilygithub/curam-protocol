FROM node:20-slim

# System deps — LibreOffice, ffmpeg, qpdf (PDF Tools password protect/remove),
# poppler-utils (Contract Review — server-side PDF page rasterization for the
# OCR fallback, server/services/contractReview/pdfRasterize.js), Python3 for
# guitar audio pipeline
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    qpdf \
    poppler-utils \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    python3 \
    python3-pip \
    python3-venv \
    libsndfile1 \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

# Python audio pipeline — pure Python, no compiler or GPU libs required
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt \
    && yt-dlp -U || true

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --include=dev

# Playwright Chromium for the Browser Agent (server/services/browserAgent/) —
# --with-deps pulls the OS libs Chromium needs on top of node:20-slim.
RUN npx playwright install --with-deps chromium

# Build frontend
COPY . .
RUN npm run build

# Font Customizer pipeline (fontTools) — needs the actual repo present, hence after COPY . .
RUN pip3 install --no-cache-dir --break-system-packages -r server/services/fonts/requirements.txt

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "server/index.js"]
