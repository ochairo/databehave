FROM docker.io/library/node:24-bookworm-slim@sha256:ba6b7d0ee561d9d49deb99e2b93c98632cc287b6cca1a6b18d66127054efa4dc

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
COPY scripts/install-actionlint.mjs /tmp/install-actionlint.mjs
RUN node /tmp/install-actionlint.mjs /usr/local/bin \
    && rm /tmp/install-actionlint.mjs \
    && npm install --global pnpm@10.33.4 typescript-language-server@5.0.0 \
    && npx --yes playwright@1.64.0 install --with-deps chromium \
    && chmod -R a+rX /opt/playwright-browsers \
    && npm cache clean --force

USER 1000:1000
CMD ["sleep", "infinity"]
