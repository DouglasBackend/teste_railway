import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import { Projeto } from '../../entities/projeto.entity';
import { Video } from '../../entities/video.entity';
import { Corte } from '../../entities/corte.entity';
import { Legenda } from '../../entities/legenda.entity';
import { ContaYoutube } from '../../entities/conta_youtube.entity';

@Injectable()
export class TenantDbManager implements OnModuleDestroy {
  private dataSources = new Map<string, DataSource>();
  private initPromises = new Map<string, Promise<DataSource>>();

  constructor(private configService: ConfigService) {}

  async getTenantDataSource(usuarioId: string): Promise<DataSource> {
    const secret = process.env.SECRET_TENANT;
    const dbName = `${secret}${usuarioId.replace(/-/g, '_')}`;

    if (this.dataSources.has(dbName)) {
      const existing = this.dataSources.get(dbName);
      if (existing && existing.isInitialized) return existing;
    }

    if (this.initPromises.has(dbName)) {
      return this.initPromises.get(dbName)!;
    }

    const initPromise = (async () => {
      const host =
        this.configService.get<string>('GLOBAL_DB_HOST') || 'localhost';
      const port = this.configService.get<number>('GLOBAL_DB_PORT') || 5432;
      const username =
        this.configService.get<string>('GLOBAL_DB_USER') || 'postgres';
      const password =
        this.configService.get<string>('GLOBAL_DB_PASS') || 'postgres';

      // ── Auto-create tenant database if it doesn't exist ──────────────────
      // Connect to the default 'postgres' admin database first, check if the
      // tenant DB exists, and create it if not. This prevents the
      // "database does not exist" error on first access for a new user.
      const adminDs = new DataSource({
        type: 'postgres',
        host,
        port,
        username,
        password,
        database: 'postgres',
      });

      try {
        await adminDs.initialize();
        const exists = await adminDs.query(
          `SELECT 1 FROM pg_database WHERE datname = $1`,
          [dbName],
        );
        if (exists.length === 0) {
          // Identifiers cannot be parameterised in PostgreSQL DDL — dbName is
          // derived from SECRET_TENANT + uuid (alphanumeric + underscores only),
          // so it is safe to interpolate directly.
          await adminDs.query(`CREATE DATABASE "${dbName}"`);
        }
      } finally {
        if (adminDs.isInitialized) await adminDs.destroy();
      }

      const dataSource = new DataSource({
        type: 'postgres',
        host,
        port,
        username,
        password,
        database: dbName,
        entities: [Projeto, Video, Corte, Legenda, ContaYoutube],
        synchronize: true, // Auto-cria tabelas em dev
      });

      await dataSource.initialize();
      this.dataSources.set(dbName, dataSource);
      return dataSource;
    })();

    this.initPromises.set(dbName, initPromise);

    try {
      return await initPromise;
    } finally {
      this.initPromises.delete(dbName);
    }
  }

  async onModuleDestroy() {
    for (const [name, ds] of this.dataSources.entries()) {
      if (ds.isInitialized) {
        await ds.destroy();
      }
    }
    this.dataSources.clear();
  }
}
