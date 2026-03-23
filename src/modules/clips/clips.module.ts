import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';
import { RemotionRendererService } from './remotion-renderer.service';
import { GatewayModule } from '../gateway/gateway.module';
import { CLIP_EXPORT_QUEUE } from '../queue/queue.constants';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({ name: CLIP_EXPORT_QUEUE }),
    GatewayModule,
    TenantModule,
  ],
  controllers: [ClipsController],
  providers: [ClipsService, RemotionRendererService],
  exports: [ClipsService],
})
export class ClipsModule { }
