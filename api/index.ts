import { createApiApp } from '../services/app.ts';

// Disable automatic body parsing so multer can stream multipart/form-data file uploads directly
export const config = {
  api: {
    bodyParser: false,
  },
};

const app = createApiApp();

export default app;
