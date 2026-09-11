# Kaotikaz — imagen para Coolify (o cualquier host Docker)
FROM node:20-alpine

WORKDIR /app

# Instalar dependencias primero (mejor caché de build)
COPY backend-ejemplo/package*.json ./backend-ejemplo/
RUN cd backend-ejemplo && npm install --omit=dev

# Copiar el resto del sitio (index.html, css/, js/, admin.html…)
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "backend-ejemplo/server.js"]
