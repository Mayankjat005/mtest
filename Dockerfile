# ======================================================
# VidLux Token API — Docker Image
# Platform: Render, Koyeb, Railway, any Docker host
# ======================================================

# Playwright base image — Chromium pre-installed, no extra downloads needed
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Skip browser download (already in base image)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production
ENV PORT=3000

# Copy & install deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy app code
COPY server.js ./

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode < 400 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
