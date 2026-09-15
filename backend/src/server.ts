import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';

import routes from './routes/index.js';
import { errorHandler } from './middleware/error.js';
import { markEndOfDayAbsences } from './controllers/coreController.js';

dotenv.config();

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin'
    }
  })
);

app.use(
  cors({
    origin:
      process.env.FRONTEND_URL?.split(',') ||
      ['http://localhost:5173']
  })
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
// markEndOfDayAbsences() itself checks the database clock and only performs
// the absence finalization during the 23:59 minute, so this remains
// idempotent and independent of the exact second when the server started.
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
      `WITHX API running on http://localhost:${port}`
    )
);
