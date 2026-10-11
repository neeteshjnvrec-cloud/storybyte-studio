# The video worker: Node 22 + ffmpeg + Devanagari/Latin fonts + edge-tts.
# Built and deployed as a Cloud Run Job (see docs/SETUP.md).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core fonts-lohit-deva fonts-dejavu-core \
      python3 python3-pip ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages edge-tts \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY src ./src
COPY assets ./assets

ENV NODE_ENV=production
CMD ["node", "src/run.js"]
