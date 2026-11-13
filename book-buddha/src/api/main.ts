import { createApi } from "./server.js";

const port = Number(process.env.BOOK_BUDDHA_PORT ?? 3000);
const databasePath = process.env.BOOK_BUDDHA_DATABASE ?? "book-buddha.db";
const { app, repository } = createApi(databasePath);

try {
  await app.listen({ host: "127.0.0.1", port });
} catch (error) {
  repository.close();
  app.log.error(error);
  process.exitCode = 1;
}
