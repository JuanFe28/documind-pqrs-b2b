# ==============================================================================
# Dockerfile para Backend Express (Node.js 20 Alpine) - Tercer Corte
# ==============================================================================
FROM node:20-alpine AS base

WORKDIR /app

# Instalar dependencias necesarias para compilación nativa si aplica
RUN apk add --no-cache tzdata
ENV TZ=America/Bogota

# Copiar manifiestos e instalar dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar el código fuente del backend
COPY . .

# Crear directorio para subidas temporales
RUN mkdir -p uploads && chown -R node:node /app

USER node

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

CMD ["node", "server.js"]
