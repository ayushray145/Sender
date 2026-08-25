FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY server ./server

RUN pnpm install --frozen-lockfile

EXPOSE 8080
ENV PORT=8080
CMD ["pnpm", "--filter", "@fastshare/signaling-server", "start"]

