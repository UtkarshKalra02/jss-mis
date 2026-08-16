import { handlers } from "@/auth";

// bcrypt and the Neon driver need Node APIs.
export const runtime = "nodejs";

export const { GET, POST } = handlers;
