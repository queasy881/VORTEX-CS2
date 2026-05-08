FROM node:20-alpine AS client-build
WORKDIR /build/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-alpine AS server-deps
WORKDIR /build/server
COPY server/package.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
COPY --from=server-deps /build/server/node_modules ./node_modules
COPY server/package.json ./package.json
COPY server/index.js ./index.js
COPY server/src ./src
COPY --from=client-build /build/client/dist ./public

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "index.js"]
