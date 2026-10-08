FROM node:22.12.0-bookworm@sha256:0e910f435308c36ea60b4cfd7b80208044d77a074d16b768a81901ce938a62dc AS local-test

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates git python3 python-is-python3 \
        xvfb xauth dbus dbus-x11 \
        libgtk-3-0 libgbm1 libnss3 libasound2 libxss1 \
        fonts-noto-cjk fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown node:node /app
COPY --chown=node:node package.json package-lock.json ./
USER node
RUN npm ci --no-audit --no-fund \
    && node node_modules/electron/install.js

ENV ELECTRON_OVERRIDE_DIST_PATH=/app/node_modules/electron/dist

COPY --chown=node:node . .

CMD ["sh", "scripts/docker-test.sh"]

# Standalone Web acceptance: install no Electron binary and run real Chromium.
FROM node:22.12.0-bookworm@sha256:0e910f435308c36ea60b4cfd7b80208044d77a074d16b768a81901ce938a62dc AS web-local-test
WORKDIR /app
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN npm ci --ignore-scripts --no-audit --no-fund && npx playwright install --with-deps chromium
COPY . .
CMD ["sh", "scripts/docker-web-test.sh"]
