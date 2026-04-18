FROM node:22-alpine AS build
WORKDIR /app
COPY catalog-service/package.json catalog-service/tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY catalog-service/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY catalog-service/package.json ./
COPY catalog-service/public ./public
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
