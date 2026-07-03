# Image Node avec les outils Poppler (pdftoppm) + Ghostscript pour la conversion PDF.
FROM node:20-slim

# poppler-utils fournit pdftoppm ; ghostscript aide au rendu de certains PDF.
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
