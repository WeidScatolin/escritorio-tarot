FROM node:24-slim
WORKDIR /app

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
