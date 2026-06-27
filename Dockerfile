FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Data directory for SQLite file (mounted as a volume in production)
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server/index.js"]
