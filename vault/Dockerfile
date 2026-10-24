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

# Font Customizer pipeline (fontTools) and statement redaction (PyMuPDF, removes text from the PDF itself).
# Only the requirements files are copied, so these layers stay cached until a requirements file changes
# (they used to sit after COPY . . and reran on every deploy).
COPY server/services/fonts/requirements.txt ./server/services/fonts/requirements.txt
COPY server/services/pdfRedact/requirements.txt ./server/services/pdfRedact/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r server/services/fonts/requirements.txt     && pip3 install --no-cache-dir --break-system-packages -r server/services/pdfRedact/requirements.txt

# The four planner apps (own Vite apps, built by scripts/build*Planner.js / buildRouteTracer.js) each need their own
# node_modules. Installed here from their package files alone so the layer is cached until a planner's dependencies change;
# before, the build scripts ran the four installs inside `npm run build` on every deploy. The scripts still install by
# themselves if a folder has no node_modules (so a failure here only loses the speed-up).
COPY room-planner/package*.json ./room-planner/
COPY garden-planner/package*.json ./garden-planner/
COPY route-tracer/package*.json ./route-tracer/
COPY cellar-planner/package*.json ./cellar-planner/
RUN for d in room-planner garden-planner route-tracer cellar-planner; do       (cd "$d" && npm install --include=dev --no-audit --no-fund) &     done; wait || true

# Build frontend
COPY . .
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "server/index.js"]
