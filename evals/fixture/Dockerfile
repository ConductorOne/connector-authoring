FROM node:22-alpine
WORKDIR /app
COPY evals/fixture ./evals/fixture
EXPOSE 18080
CMD ["node", "--experimental-strip-types", "evals/fixture/server.ts", "--port", "18080", "--host", "0.0.0.0"]
