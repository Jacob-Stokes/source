FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY tg-bot-runner/package.json tg-bot-runner/tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY tg-bot-runner/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini git curl bash jq python3 sqlite yq
# better-sqlite3 is native; bring node_modules from build stage (compiled)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY tg-bot-runner/package.json ./
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
