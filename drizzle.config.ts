import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db-schema.ts",
  out: "./migrations/drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.GAMES_DB_PATH ?? "data/games.sqlite",
  },
});
