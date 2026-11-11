FROM node:24-slim
WORKDIR /app

# ffmpeg: converte o mp3 do TTS em ogg/opus (nota de voz). --no-install-recommends mantém a imagem enxuta.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY assets ./assets

ENV NODE_ENV=production
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3100
CMD ["node", "--import", "tsx", "src/index.ts"]
