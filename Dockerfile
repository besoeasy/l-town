FROM node:lts
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm i
COPY . .
RUN npm run build
EXPOSE 30300
USER node
CMD ["node", "server.js"]
