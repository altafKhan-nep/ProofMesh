FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages ./packages
RUN pnpm install --frozen-lockfile
COPY apps/api ./apps/api
EXPOSE 4000
CMD ["pnpm", "--filter", "@proofmesh/api", "start"]
