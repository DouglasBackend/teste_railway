// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';

// Entities pt-BR
import { Usuario } from './entities/usuario.entity';

// Modules
import { AuthModule } from './modules/auth/auth.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { QueueModule } from './modules/queue/queue.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { VideosModule } from './modules/videos/videos.module';
import { ClipsModule } from './modules/clips/clips.module';
import { TranscriptionModule } from './modules/transcription/transcription.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { YoutubeModule } from './modules/youtube/youtube.module';
import { RedisModule } from './modules/redis/redis.module';
import { TenantModule } from './modules/tenant/tenant.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    // ── Single PostgreSQL DB (kurtcut_db) ────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('GLOBAL_DB_HOST', 'localhost'),
        port: parseInt(config.get('GLOBAL_DB_PORT', '5432')),
        username: config.get('GLOBAL_DB_USER', 'postgres'),
        password: config.get('GLOBAL_DB_PASS', 'postgres'),
        database: process.env.GLOBAL_DB_NAME || 'clip_gen_db',
        entities: [Usuario],
        synchronize: true, // Auto-create tables for the unified schema
        logging: false,
      }),
      inject: [ConfigService],
    }),

    // ── Redis / Bull ─────────────────────────────────────────────────────
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: parseInt(config.get('REDIS_PORT', '6379')),
          password: config.get('REDIS_PASSWORD') || undefined,
          tls: {}, // Necessário para Upstash/Redis Seguro
          maxRetriesPerRequest: null, // Recomendado para Bull/BullMQ
        },
      }),
      inject: [ConfigService],
    }),

    // Feature modules
    TenantModule,
    RedisModule,
    AuthModule,
    GatewayModule,
    QueueModule,
    ProjectsModule,
    VideosModule,
    ClipsModule,
    TranscriptionModule,
    AnalysisModule,
    YoutubeModule,
  ],
})
export class AppModule {}
