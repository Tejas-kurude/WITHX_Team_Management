import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';

import routes from './routes/index.js';
import { errorHandler } from './middleware/error.js';
import { markEndOfDayAbsences } from './controllers/coreController.js';
import { runAutoMigrations } from './config/migrate.js';

dotenv.config();

// Run schema verification / auto-migrations on startup
void runAutoMigrations();

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin'
    }
  })
);

// The installed CORS typings are currently incompatible with the Express
// typings in this project, even though the middleware is valid at runtime.
// Cast only this middleware to avoid changing the existing CORS behaviour.
app.use(
  cors({
    origin:
      process.env.FRONTEND_URL?.split(',').map((value) => value.trim()) ||
      ['http://localhost:5173']
  }) as any
);

app.use(
  express.json({
    limit: '8mb'
  })
);

app.use(
  '/uploads',
  express.static(
    path.resolve(
      process.cwd(),
      'uploads'
    )
  )
);

app.use(morgan('dev'));

app.get(
  '/api/health',
  (_req, res) =>
    res.json({
      status: 'ok',
      service: 'WITHX Management API'
    })
);

app.use('/api', routes);

app.use(errorHandler);

// Run the end-of-day attendance finalizer once per minute.
// markEndOfDayAbsences() uses the PostgreSQL clock and only writes ABSENT
// records during the 23:59 minute, so repeated calls are safe.
const endOfDayAttendanceTimer = setInterval(() => {
  void markEndOfDayAbsences();
}, 60_000);

endOfDayAttendanceTimer.unref?.();

const port =
  Number(process.env.PORT || 5000);

app.listen(
  port,
  () =>
    console.log(
      `WITHX API running on port ${port}`
    )
);
