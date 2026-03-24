FROM node:alpine
WORKDIR /app
COPY package*.json ./
RUN npm i
COPY . .
EXPOSE 30300
CMD ["node", "server.js"]
