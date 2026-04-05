import { initDb } from "./index";

void initDb()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log("CNothing migrations completed");
    process.exit(0);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("CNothing migration failed", error);
    process.exit(1);
  });
