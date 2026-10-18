# Optional: container image for the multiplayer server (Fly.io, Railway, any Docker host)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared ./shared
COPY server ./server
COPY client/package.json ./client/package.json
RUN npm ci --workspace server --include-workspace-root=false || npm install --workspace server
RUN npm run build -w server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/server/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
