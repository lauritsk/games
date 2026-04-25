import { defaultDatabasePath, GameDatabase } from "@server/db";

const db = new GameDatabase();
db.close();
console.log(`SQLite migrations applied at ${defaultDatabasePath()}`);
