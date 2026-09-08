# Stage 1: Build the client PWA with Node LTS Alpine
FROM node:lts-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm i
COPY . .
RUN npm run build

# Stage 2: Serve statically with minimal Nginx Alpine (< 30 MB)
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 30300
CMD ["nginx", "-g", "daemon off;"]
