# Tag pinned to match the playwright version in apps/server/package.json
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/groupie.db
EXPOSE 3000
CMD ["pnpm", "start"]
