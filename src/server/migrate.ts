import { defaultDatabasePath, GameDatabase } from "@server/db";

const db = new GameDatabase();
db.close();
console.log(`Drizzle SQLite migrations applied at ${defaultDatabasePath()}`);
