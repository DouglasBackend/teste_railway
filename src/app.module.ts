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
      useFactory: (config: ConfigService) => {
        const host = config.get('GLOBAL_DB_HOST', 'aws-1-us-east-1.pooler.supabase.com');
        const user = config.get('GLOBAL_DB_USER', 'postgres.pkjfuvoexlwigqjuzjmk');
        const dbName = config.get('GLOBAL_DB_NAME', 'postgres');

        console.log(`[Database] Connecting to ${host} as ${user} (DB: ${dbName})`);

        return {
          type: 'postgres',
          host,
          port: parseInt(config.get('GLOBAL_DB_PORT', '5432')),
          username: user,
          password: config.get('GLOBAL_DB_PASS', 'J98jPeSRKMJusHF@'),
          database: dbName,
          entities: [Usuario],
          synchronize: true,
          logging: false,
          ssl: config.get('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
          extra: config.get('NODE_ENV') === 'production' ? {
            ssl: { rejectUnauthorized: false },
          } : {},
        };
      },
      inject: [ConfigService],
    }),

    // ── Redis / Bull ─────────────────────────────────────────────────────
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST', 'enormous-pigeon-39556.upstash.io'),
          port: parseInt(config.get('REDIS_PORT', '6379')),
          password: config.get('REDIS_PASSWORD', 'AZqEAAIncDEyMzc4N2M3M2NlNWU0MjVkYmZiODExZDlkYzU5ZTcxMnAxMzk1NTY'),
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
