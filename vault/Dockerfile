# App image: starts from the prebuilt base (apt, Python, Chromium, node_modules for the app and the four planners),
# so a deploy only copies code and runs the Vite builds. The base is built by .github/workflows/base-image.yml.
# See docs/deploy-speed.md. If the base is ever behind package.json (a deploy that races the base build), the
# `npm install` below catches the root app up; the planner build scripts install their own missing modules.
FROM ghcr.io/bluelilygithub/curam-vault-base:latest

WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "server/index.js"]
