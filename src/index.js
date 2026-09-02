import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('src/public'));

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/src/public/index.html');
});

// Health Check Endpoint (used by Docker healthcheck)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🚀 Stratton Candidate Engine API is running on port ${PORT}`);
});
