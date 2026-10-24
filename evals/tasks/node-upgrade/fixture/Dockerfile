FROM node:24-slim
WORKDIR /app
COPY . .
RUN npm ci && npm run build
EXPOSE 2424
CMD ["npm", "run", "preview"]
