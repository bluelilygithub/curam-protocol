FROM node:20-slim

# Install LibreOffice and fonts for Office→PDF conversion
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

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
