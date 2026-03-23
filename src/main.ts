import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as express from 'express';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useWebSocketAdapter(new IoAdapter(app));

  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const uploadDir = process.env.UPLOAD_DIR || 'uploads';
  const staticPath = path.isAbsolute(uploadDir)
    ? uploadDir
    : path.join(process.cwd(), uploadDir);
  app.use('/uploads', express.static(staticPath));

  // Raw body for Stripe webhooks
  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  // console.log(`🚀 KurtCut AI API running on port ${port}`);
  // console.log(`🔌 WebSocket: ws://localhost:${port}/ws`);
  // console.log(`📊 Global DB: kurtcut_db`);
  // console.log(
  //   `🏢 Tenant DBs: kurtcut_{slug} (created on registration)`,
  // );
}
bootstrap();
