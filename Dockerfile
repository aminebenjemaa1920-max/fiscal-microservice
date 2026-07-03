# Alternative au buildpack Nixpacks : plus fiable pour GraphicsMagick + Ghostscript.
# Railway détecte automatiquement ce Dockerfile s'il est présent.
FROM node:20-slim

# Dépendances système requises par pdf2pic
RUN apt-get update && apt-get install -y --no-install-recommends \
    graphicsmagick \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
