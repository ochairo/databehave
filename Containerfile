FROM docker.io/library/node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370

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
