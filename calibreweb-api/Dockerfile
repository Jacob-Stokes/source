FROM oven/bun:1-alpine

WORKDIR /app

COPY calibreweb-api/package.json ./
RUN bun install --frozen-lockfile

COPY calibreweb-api/src/ ./src/

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
