import { defaultDatabasePath, GameDatabase } from "./db";

const db = new GameDatabase();
db.close();
console.log(`SQLite migrations applied at ${defaultDatabasePath()}`);
