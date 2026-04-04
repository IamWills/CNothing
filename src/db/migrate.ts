import { initDb } from "./index";

void initDb()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log("KeyService migrations completed");
    process.exit(0);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("KeyService migration failed", error);
    process.exit(1);
  });
