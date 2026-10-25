import { Router } from 'express';

/** Step 18a: public OAuth callback for per-user Google free/busy (GET /api/google/callback). Mounted before /api auth. */
export const googleCallbackRouter = Router();
