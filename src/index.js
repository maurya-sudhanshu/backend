import express from 'express';
import cors from 'cors';
import { db } from './db/index.js';
import { env } from './env.js';

const app = express();
const port = env.PORT;

app.use(cors());
app.use(express.json());

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});
