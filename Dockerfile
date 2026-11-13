FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src

USER node

EXPOSE 8080

CMD ["node", "src/server.js"]
