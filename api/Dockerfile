FROM node:20-alpine

WORKDIR /app

# Build tools for mysql2 native bindings
RUN apk add --no-cache python3 make g++

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["npm", "start"]
