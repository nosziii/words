FROM node:22-alpine

WORKDIR /app

COPY package.json /app/package.json
RUN npm install --omit=dev

COPY server.js /app/server.js
COPY index.html /app/index.html
COPY app.js /app/app.js
COPY style.css /app/style.css
COPY wordds.csv /app/wordds.csv

EXPOSE 3000

CMD ["npm", "start"]
