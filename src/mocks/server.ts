import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);

// Start the server once when this module is first imported.
// Individual test files must NOT call server.listen() / server.close()
// because they share this singleton — closing it in one afterAll would
// break all subsequent test files in the same bun process.
server.listen({ onUnhandledRequest: "bypass" });
