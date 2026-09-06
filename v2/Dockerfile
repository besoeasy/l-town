FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY shared/package*.json shared/
COPY server/package*.json server/
COPY client/package*.json client/
RUN npm ci --omit=dev || npm i
COPY . .
RUN npm run build
EXPOSE 30300
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:30300').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/dist/index.js"]
