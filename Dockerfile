FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ca-certificates curl python3 ffmpeg fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js index.html finder.html keys.html style.css app.js ./
# update yt-dlp on every boot, TikTok breaks it often
CMD ["sh", "-c", "yt-dlp -U || true; node server.js"]
