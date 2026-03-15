# Stage 1 — Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2 — Serve
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=builder /app/public/assets /usr/share/nginx/html/brand-assets


# Nginx config for SPA routing (all routes -> index.html)
RUN printf 'server {\n\
  listen 5173;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  include /etc/nginx/mime.types;\n\
  default_type application/octet-stream;\n\
  location /brand-assets/ { alias /usr/share/nginx/html/brand-assets/; }\n\
  location / { try_files $uri $uri/ /index.html; }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 5173
